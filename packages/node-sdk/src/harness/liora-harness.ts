import type { Kaos } from '@superliora/kaos';
import {
  ErrorCodes,
  LioraError,
  withTelemetryContext,
  type RuntimeDegradedEvent,
  type SessionTrace,
} from '@superliora/agent-core';

import type { QuestionHandler } from '#/session/events';
import { Session } from '#/session/session';
import type { LioraAuthFacade } from '#/auth';
import type { SDKRpcClientBase } from '#/rpc/rpc';
import type {
  ConfigDiagnostics,
  CreateSessionOptions,
  DeleteConfigFieldPath,
  ExportSessionInput,
  ExportSessionResult,
  ForkSessionInput,
  GetConfigOptions,
  IndependentSessionActivity,
  IndependentSessionFact,
  Unsubscribe,
  LioraConfig,
  LioraConfigPatch,
  KimiHostIdentity,
  ListSessionsOptions,
  RenameSessionInput,
  ResumeSessionInput,
  ReloadSessionInput,
  SessionSummary,
  TelemetryClient,
  TelemetryContextPatch,
  TelemetryProperties,
} from '#/session/types';

export interface LioraHarnessRuntimeOptions {
  readonly identity?: KimiHostIdentity;
  readonly uiMode?: string;
  readonly homeDir: string;
  readonly configPath: string;
  readonly auth: LioraAuthFacade;
  readonly telemetry: TelemetryClient;
  readonly ensureConfigFile: () => Promise<void>;
  readonly onClose: () => void | Promise<void>;
  readonly beforeClose?: () => void | Promise<void>;
  readonly subscribeIndependentSessionActivity?: (sessionId: string, listener: (activity: IndependentSessionActivity) => void) => Unsubscribe;
  readonly setIndependentSessionQuestionHandler?: (sessionId: string, handler: QuestionHandler | undefined) => void;
  readonly getIndependentSessionRecord?: (sessionId: string, independentId: string) => IndependentSessionFact | undefined;
  readonly sessionStartedProperties?: TelemetryProperties;
}

export class LioraHarness {
  readonly homeDir: string;
  readonly configPath: string;
  readonly auth: LioraAuthFacade;

  private readonly identity: KimiHostIdentity | undefined;
  private readonly uiMode: string;
  private readonly telemetry: TelemetryClient;
  private readonly activeSessions = new Map<string, Session>();
  private readonly ensureConfigFileImpl: () => Promise<void>;
  private readonly closeImpl: () => void | Promise<void>;
  private readonly subscribeIndependentSessionActivity: LioraHarnessRuntimeOptions['subscribeIndependentSessionActivity'];
  private readonly setIndependentQuestionHandler: LioraHarnessRuntimeOptions['setIndependentSessionQuestionHandler'];
  private readonly getIndependentSessionRecord: LioraHarnessRuntimeOptions['getIndependentSessionRecord'];
  private readonly activitySubscriptions = new Set<Unsubscribe>();
  private readonly beforeCloseImpl: (() => void | Promise<void>) | undefined;
  private readonly sessionStartedProperties: TelemetryProperties;

  constructor(
    private readonly rpc: SDKRpcClientBase,
    options: LioraHarnessRuntimeOptions,
  ) {
    this.identity = options.identity;
    this.uiMode = options.uiMode ?? DEFAULT_SESSION_STARTED_UI_MODE;
    this.homeDir = options.homeDir;
    this.configPath = options.configPath;
    this.telemetry = options.telemetry;
    this.auth = options.auth;
    this.ensureConfigFileImpl = options.ensureConfigFile;
    this.closeImpl = options.onClose;
    this.beforeCloseImpl = options.beforeClose;
    this.subscribeIndependentSessionActivity = options.subscribeIndependentSessionActivity;
    this.getIndependentSessionRecord = options.getIndependentSessionRecord;
    this.setIndependentQuestionHandler = options.setIndependentSessionQuestionHandler;
    this.sessionStartedProperties = options.sessionStartedProperties ?? {};
  }

  get sessions(): ReadonlyMap<string, Session> {
    return this.activeSessions;
  }

  get interactiveAgentId(): string {
    return this.rpc.interactiveAgentId;
  }

  withInteractiveAgent<T>(agentId: string, fn: () => T): T {
    return this.rpc.withInteractiveAgent(agentId, fn);
  }

  track(event: string, properties?: TelemetryProperties): void {
    this.telemetry.track(event, properties);
  }

  setTelemetryContext(patch: TelemetryContextPatch): void {
    this.telemetry.setContext?.(patch);
  }

  /**
   * Emergency synchronous flush of every active in-process session's pending
   * state to disk (agent mirrors + wire-log records, fsync'd). For crash
   * paths only (signal handlers, `uncaughtExceptionMonitor`); never throws.
   * No-op for remote-transport harnesses without an in-process core.
   */
  emergencyFlushSync(): void {
    try {
      this.rpc.emergencyFlushSync();
    } catch {
      // Best-effort — the process is dying.
    }
  }

  /** Volatile Never-Halt signal for non-TUI hosts (headless prompt, server, SDK). */
  broadcastRuntimeDegraded(event: RuntimeDegradedEvent): void {
    try {
      this.rpc.broadcastRuntimeDegraded(event);
    } catch {
      // Best-effort — degraded surfacing must not abort the host loop.
    }
  }

  setIndependentSessionQuestionHandler(sessionId: string, handler: QuestionHandler | undefined): void {
    this.setIndependentQuestionHandler?.(sessionId, handler);
  }

  onIndependentSessionActivity(sessionId: string, listener: (activity: IndependentSessionActivity) => void): Unsubscribe {
    const unsubscribe = this.subscribeIndependentSessionActivity?.(sessionId, listener) ?? (() => {});
    const dispose = (): void => {
      this.activitySubscriptions.delete(dispose);
      unsubscribe();
    };
    this.activitySubscriptions.add(dispose);
    return dispose;
  }

  async getIndependentSessionTrace(sessionId: string, independentId: string, agentId = 'main'): Promise<SessionTrace> {
    const record = this.getIndependentSessionRecord?.(sessionId, independentId);
    if (record?.sessionId === undefined) throw new Error('Independent session has not been admitted');
    const active = this.activeSessions.get(record.sessionId);
    const worker = active ?? await this.resumeSession({ id: record.sessionId, role: 'worker' });
    try {
      return await this.withInteractiveAgent(agentId, () => worker.getSessionTrace());
    } finally {
      // Reading a live worker must not cancel it; only release a replay handle.
      if (active === undefined) await worker.close();
    }
  }

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const { kaos, persistenceKaos, sessionStartedProperties, ...coreOptions } = options;
    const summary =
      kaos === undefined && persistenceKaos === undefined
        ? await this.rpc.createSession(coreOptions)
        : await this.rpc.createSessionWithKaos(coreOptions, kaos ?? persistenceKaos as Kaos, persistenceKaos);
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, false, sessionStartedProperties);
    this.trackSessionEvent(session.id, 'session_new');
    return session;
  }

  async resumeSession(input: ResumeSessionInput): Promise<Session> {
    const id = normalizeSessionId(input.id);
    const active = this.activeSessions.get(id);
    const { kaos, persistenceKaos, sessionStartedProperties, ...resumeInput } = input;
    if (active !== undefined) {
      if (input.workerAncestry !== undefined || input.role !== undefined || kaos !== undefined || persistenceKaos !== undefined) {
        const summary = kaos === undefined && persistenceKaos === undefined
          ? await this.rpc.resumeSession({ ...resumeInput, id })
          : await this.rpc.resumeSessionWithKaos({ ...resumeInput, id }, kaos ?? persistenceKaos as Kaos, persistenceKaos);
        // Reflect the refreshed summary so callers see updated state (e.g.
        // additionalDirs, metadata) after a kaos-backed resume.
        active.updateSummary(summary);
      }
      return active;
    }

    const summary =
      kaos === undefined && persistenceKaos === undefined
        ? await this.rpc.resumeSession({ ...resumeInput, id })
        : await this.rpc.resumeSessionWithKaos({ ...resumeInput, id }, kaos ?? persistenceKaos as Kaos, persistenceKaos);
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true, sessionStartedProperties);
    this.trackSessionEvent(session.id, 'session_resume');
    return session;
  }

  async reloadSession(input: ReloadSessionInput): Promise<Session> {
    const id = normalizeSessionId(input.id);
    const active = this.activeSessions.get(id);
    if (active !== undefined) {
      await active.reloadSession();
      this.trackSessionEvent(active.id, 'session_reload');
      return active;
    }

    const summary = await this.rpc.reloadSession({
      sessionId: id,
    });
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true);
    this.trackSessionEvent(session.id, 'session_reload');
    return session;
  }

  async forkSession(input: ForkSessionInput): Promise<Session> {
    const summary = await this.rpc.forkSession({
      id: normalizeSessionId(input.id),
      forkId: input.forkId,
      title: input.title,
      metadata: input.metadata,
      worktree: input.worktree,
    });
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true);
    this.trackSessionEvent(session.id, 'session_fork');
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.activeSessions.get(id);
  }

  async closeSession(id: string): Promise<void> {
    await this.activeSessions.get(id)?.close();
  }

  async renameSession(input: RenameSessionInput): Promise<void> {
    await this.rpc.renameSession(input);
    this.activeSessions.get(input.id)?.emitMetaUpdated({ title: input.title });
  }

  async exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    const result = await this.rpc.exportSession({
      ...input,
      version: input.version ?? this.identity?.version,
    });
    this.trackSessionEvent(input.id, 'export');
    return result;
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<readonly SessionSummary[]> {
    return this.rpc.listSessions(options);
  }

  async getConfig(options: GetConfigOptions = {}): Promise<LioraConfig> {
    return this.rpc.getConfig(options);
  }

  /** Warnings from the most recent config.toml load; empty when the config is fully valid. */
  async getConfigDiagnostics(): Promise<ConfigDiagnostics> {
    return this.rpc.getConfigDiagnostics();
  }


  async ensureConfigFile(): Promise<void> {
    await this.ensureConfigFileImpl();
  }

  async setConfig(patch: LioraConfigPatch): Promise<LioraConfig> {
    return this.rpc.setConfig(patch);
  }

  async deleteConfigFields(paths: readonly DeleteConfigFieldPath[]): Promise<LioraConfig> {
    return this.rpc.deleteConfigFields(paths);
  }


  async removeProvider(providerId: string): Promise<LioraConfig> {
    return this.rpc.removeProvider(providerId);
  }

  async close(): Promise<void> {
    // Stop detached admissions/executions before closing their session handles.
    await this.beforeCloseImpl?.();
    for (const dispose of this.activitySubscriptions) dispose();
    // Use allSettled so one session's close failure does not prevent the
    // remaining sessions from shutting down. Snapshot the array first because
    // each session.close() mutates activeSessions via the onClose callback.
    const sessions = [...this.activeSessions.values()];
    const results = await Promise.allSettled(sessions.map((session) => session.close()));
    const firstRejection = results.find((r) => r.status === 'rejected');
    await this.closeImpl();
    if (firstRejection !== undefined && firstRejection.status === 'rejected') {
      throw firstRejection.reason;
    }
  }

  private trackSessionEvent(eventSessionId: string, event: string): void {
    withTelemetryContext(this.telemetry, { sessionId: eventSessionId }).track(event);
  }

  private trackSessionStarted(
    eventSessionId: string,
    resumed: boolean,
    sessionScoped?: TelemetryProperties,
  ): void {
    withTelemetryContext(this.telemetry, { sessionId: eventSessionId }).track('session_started', {
      ...this.sessionStartedProperties,
      ...sessionScoped,
      // Canonical fields are owned by the harness and must win over any
      // caller-supplied sessionStartedProperties that happen to share a key.
      // SDK-local sessions have no per-connection client id; keep the key
      // explicit so session_started has the same schema as daemon clients.
      client_id: null,
      client_name: this.identity?.userAgentProduct ?? null,
      client_version: this.identity?.version ?? null,
      ui_mode: this.uiMode,
      resumed,
    });
  }
}


const DEFAULT_SESSION_STARTED_UI_MODE = 'shell';

function normalizeSessionId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new LioraError(ErrorCodes.SESSION_ID_EMPTY, 'Session id cannot be empty.');
  }
  return normalized;
}
