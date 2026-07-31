/**
 * ACP `AgentSideConnection` wrapper.
 *
 * Phase 3 implements `initialize`, `session/new`, and `session/cancel`
 * against {@link LioraHarness}. `prompt` is wired in step 3.4. `initialize`
 * advertises the terminal-auth method (see {@link TERMINAL_AUTH_METHOD}).
 */

import { randomUUID } from 'node:crypto';

import {
  RequestError,
  type Agent,
  type AgentCapabilities,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type ClientCapabilities,
  type AgentSideConnection,
  type Implementation,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
} from '@agentclientprotocol/sdk';
import type { LioraHarness, Session } from '@superliora/sdk';
import { log } from '@superliora/sdk';
import { LocalKaos, type Kaos } from '@superliora/kaos';

import { TERMINAL_AUTH_METHOD, buildTerminalAuthMethod } from '#/auth-methods';
import { AcpKaos } from '#/kaos-acp';
import { AcpSession, type TelemetryTrackFn } from '#/session/index';
import { buildSessionConfigOptions } from '#/config-options';
import { availableCommandsUpdateNotification } from '#/convert/events-map';
import { acpMcpServersToConfigs } from '#/mcp';
import { DEFAULT_MODE_ID } from '#/modes';
import { resolveCurrentModelId, resolveCurrentThinkingEnabled } from './server-config-resolve';
import { setupSessionFromExisting } from './server-existing-session';
import { sessionSummaryToSessionInfo } from './server-session-info';
import {
  createSlashCommandsResolver,
  harnessIsAuthed,
  type ResolvedSlashCommands,
  type SlashCommandsResolver,
} from './server-slash';
import { negotiateVersion, type AcpVersionSpec } from '#/version';

export type { SlashCommandsSnapshot } from './server-slash';
export { runAcpServer, runAcpServerWithStream } from './server-run';

/**
 * Agent-side ACP handler. Routes `initialize` + `session/new` + `session/cancel`
 * into {@link LioraHarness}; refuses methods that are not yet wired with a
 * JSON-RPC "method not found" error so clients see a structured failure
 * rather than a silent hang.
 *
 * The harness is captured eagerly so Phase 3 routes `session/new`,
 * `session/cancel` (and Phase 3.4: `session/prompt`) into it without
 * changing the public constructor. The {@link AgentSideConnection} (if
 * supplied) is forwarded to every {@link AcpSession} so the session can
 * push `session/update` chunks back to the client.
 */
export class AcpServer implements Agent {
  private negotiated: AcpVersionSpec | undefined;
  private clientCapabilities: ClientCapabilities | undefined;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly agentInfo: Implementation | undefined;
  private readonly terminalAuthEnv: Readonly<Record<string, string>> | undefined;
  private readonly terminalAuthLegacyCommand: string | undefined;
  private readonly resolveSlashCommands: (
    session: Session,
  ) => Promise<ResolvedSlashCommands>;
  private innerKaos: Kaos | undefined = undefined;

  constructor(
    private readonly harness: LioraHarness,
    private readonly conn?: AgentSideConnection | undefined,
    opts?: {
      agentInfo?: Implementation;
      terminalAuthEnv?: Readonly<Record<string, string>>;
      terminalAuthLegacyCommand?: string;
      slashCommands?: SlashCommandsResolver;
    },
  ) {
    this.agentInfo = opts?.agentInfo;
    this.terminalAuthEnv = opts?.terminalAuthEnv;
    this.terminalAuthLegacyCommand = opts?.terminalAuthLegacyCommand;
    this.resolveSlashCommands = createSlashCommandsResolver(opts?.slashCommands);
  }

  get negotiatedVersion(): AcpVersionSpec | undefined {
    return this.negotiated;
  }

  get clientCaps(): ClientCapabilities | undefined {
    return this.clientCapabilities;
  }

  /** @internal — for tests/inspection only. */
  getSession(sessionId: string): AcpSession | undefined {
    return this.sessions.get(sessionId);
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.negotiated = negotiateVersion(params.protocolVersion);
    this.clientCapabilities = params.clientCapabilities;

    const agentCapabilities: AgentCapabilities = {
      loadSession: true,
      promptCapabilities: {
        image: true,
        audio: false,
        embeddedContext: true,
      },
      mcpCapabilities: {
        http: true,
        sse: true,
      },
      sessionCapabilities: {
        list: {},
        resume: {},
      },
    };

    return {
      protocolVersion: this.negotiated.protocolVersion,
      agentCapabilities,
      authMethods: [
        this.terminalAuthEnv !== undefined || this.terminalAuthLegacyCommand !== undefined
          ? buildTerminalAuthMethod({
              env: this.terminalAuthEnv,
              legacyCommand: this.terminalAuthLegacyCommand,
            })
          : TERMINAL_AUTH_METHOD,
      ],
      ...(this.agentInfo ? { agentInfo: this.agentInfo } : {}),
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    if (!(await harnessIsAuthed(this.harness))) {
      throw RequestError.authRequired();
    }
    const mcpServers = acpMcpServersToConfigs(params.mcpServers);
    if (!this.conn) {
      throw RequestError.internalError(undefined, 'AcpServer is missing its AgentSideConnection');
    }
    const sessionId = `session_${randomUUID()}`;
    const acpKaos = await this.maybeBuildAcpKaos(sessionId);
    const persistenceKaos = acpKaos === undefined ? undefined : await this.ensureInnerKaos();
    const session = await this.harness.createSession({
      id: sessionId,
      workDir: params.cwd,
      kaos: acpKaos,
      persistenceKaos,
      sessionStartedProperties: { mode: 'new' },
      // @ts-expect-error — `mcpServers` is a kernel-side extension the SDK forwards via spread.
      mcpServers,
    });
    const currentModelId = await resolveCurrentModelId(this.harness);
    const currentThinkingEnabled = await resolveCurrentThinkingEnabled(this.harness);
    const acpSession = new AcpSession(
      this.conn,
      session,
      this.clientCapabilities,
      this.makeTelemetryTrack(),
      currentModelId,
      this.harness,
      currentThinkingEnabled,
    );
    this.sessions.set(session.id, acpSession);
    const configOptions = await buildSessionConfigOptions(
      this.harness,
      currentModelId,
      currentThinkingEnabled,
      DEFAULT_MODE_ID,
    );
    this.scheduleAvailableCommandsUpdate(session.id);
    return {
      sessionId: session.id,
      configOptions,
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { session, acpSession, configOptions } = await setupSessionFromExisting(
      this.existingSessionDeps(),
      {
        cwd: params.cwd,
        sessionId: params.sessionId,
        mcpServers: params.mcpServers,
        mode: 'load',
      },
    );
    await acpSession.replayHistory();
    this.scheduleAvailableCommandsUpdate(session.id);
    return { configOptions };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const { session, configOptions } = await setupSessionFromExisting(
      this.existingSessionDeps(),
      {
        cwd: params.cwd,
        sessionId: params.sessionId,
        mcpServers: params.mcpServers,
        mode: 'resume',
      },
    );
    this.scheduleAvailableCommandsUpdate(session.id);
    return { configOptions };
  }

  async authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse | void> {
    if (params.methodId !== 'login') {
      throw RequestError.invalidParams(
        { methodId: params.methodId },
        `Unknown auth method: ${params.methodId}`,
      );
    }
    if (!(await harnessIsAuthed(this.harness))) {
      throw RequestError.authRequired();
    }
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const acpSession = this.sessions.get(params.sessionId);
    if (!acpSession) {
      throw RequestError.invalidParams(undefined, `Unknown sessionId: ${params.sessionId}`);
    }
    return acpSession.prompt(params.prompt);
  }

  async cancel(params: CancelNotification): Promise<void> {
    const acpSession = this.sessions.get(params.sessionId);
    if (!acpSession) {
      log.warn('acp: cancel for unknown sessionId', { sessionId: params.sessionId });
      return;
    }
    try {
      await acpSession.cancel();
    } catch (error) {
      log.warn('acp: error while cancelling session', {
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
    const acpSession = this.sessions.get(params.sessionId);
    if (!acpSession) {
      throw RequestError.invalidParams(
        { sessionId: params.sessionId },
        `Unknown sessionId: ${params.sessionId}`,
      );
    }
    await acpSession.setMode(params.modeId);
  }

  async unstable_setSessionModel(
    params: SetSessionModelRequest,
  ): Promise<SetSessionModelResponse | void> {
    const acpSession = this.sessions.get(params.sessionId);
    if (!acpSession) {
      throw RequestError.invalidParams(
        { sessionId: params.sessionId },
        `Unknown sessionId: ${params.sessionId}`,
      );
    }
    await acpSession.setModel(params.modelId);
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const acpSession = this.sessions.get(params.sessionId);
    if (!acpSession) {
      throw RequestError.invalidParams(
        { sessionId: params.sessionId },
        `Unknown sessionId: ${params.sessionId}`,
      );
    }
    const value = (params as { value: unknown }).value;
    switch (params.configId) {
      case 'model':
        await acpSession.setModel(String(value));
        break;
      case 'mode':
        await acpSession.setMode(String(value));
        break;
      case 'thinking':
        await acpSession.setThinking(value === 'on');
        break;
      default:
        throw RequestError.invalidParams(
          { configId: params.configId },
          `Unknown configId: ${params.configId}`,
        );
    }
    return {
      configOptions: await buildSessionConfigOptions(
        this.harness,
        acpSession.currentModelId,
        acpSession.currentThinkingEnabled,
        acpSession.currentModeId,
      ),
    };
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? undefined;
    const summaries = await this.harness.listSessions(
      cwd === undefined ? {} : { workDir: cwd },
    );
    const sessions = summaries.map((summary) => sessionSummaryToSessionInfo(summary));
    return { sessions, nextCursor: null };
  }

  async extMethod(
    method: string,
    _params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    throw RequestError.methodNotFound(method);
  }

  async extNotification(method: string, _params: Record<string, unknown>): Promise<void> {
    throw RequestError.methodNotFound(method);
  }

  private existingSessionDeps() {
    return {
      harness: this.harness,
      conn: this.conn,
      clientCapabilities: this.clientCapabilities,
      maybeBuildAcpKaos: (sessionId: string) => this.maybeBuildAcpKaos(sessionId),
      ensureInnerKaos: () => this.ensureInnerKaos(),
      makeTelemetryTrack: () => this.makeTelemetryTrack(),
      registerSession: (sessionId: string, acpSession: AcpSession) => {
        this.sessions.set(sessionId, acpSession);
      },
    };
  }

  private async maybeBuildAcpKaos(sessionId: string): Promise<AcpKaos | undefined> {
    const fs = this.clientCapabilities?.fs;
    if (!fs?.readTextFile && !fs?.writeTextFile) {
      return undefined;
    }
    if (!this.conn) {
      return undefined;
    }
    const innerKaos = await this.ensureInnerKaos();
    return new AcpKaos(this.conn, sessionId, innerKaos);
  }

  private async ensureInnerKaos(): Promise<Kaos> {
    this.innerKaos ??= await LocalKaos.create();
    return this.innerKaos;
  }

  private makeTelemetryTrack(): TelemetryTrackFn | undefined {
    const harness = this.harness;
    if (typeof harness.track !== 'function') return undefined;
    return (event, properties) => {
      harness.track(event, properties as Parameters<typeof harness.track>[1]);
    };
  }

  private scheduleAvailableCommandsUpdate(sessionId: string): void {
    setTimeout(() => {
      void this.emitAvailableCommandsUpdate(sessionId);
    }, 0);
  }

  private async emitAvailableCommandsUpdate(sessionId: string): Promise<void> {
    if (!this.conn) return;
    const acpSession = this.sessions.get(sessionId);
    if (!acpSession) return;
    try {
      const { commands, skillCommandMap } = await this.resolveSlashCommands(
        acpSession.session,
      );
      if (typeof acpSession.setAvailableCommands === 'function') {
        acpSession.setAvailableCommands(commands, skillCommandMap);
      } else if (typeof acpSession.setSkillCommandMap === 'function') {
        acpSession.setSkillCommandMap(skillCommandMap);
      }
      await this.conn.sessionUpdate(
        availableCommandsUpdateNotification(sessionId, commands),
      );
    } catch (error) {
      log.warn('acp: failed to push available_commands_update', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
