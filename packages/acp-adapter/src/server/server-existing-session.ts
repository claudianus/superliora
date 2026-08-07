import {
  RequestError,
  type AgentSideConnection,
  type ClientCapabilities,
  type McpServer,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk';
import type { Kaos } from '@superliora/kaos';
import type { LioraHarness, Session } from '@superliora/sdk';

import { buildSessionConfigOptions } from '#/config-options';
import { AcpKaos } from '#/kaos-acp';
import { acpMcpServersToConfigs } from '#/mcp';
import { DEFAULT_MODE_ID } from '#/modes';
import { resolveCurrentModelId, resolveCurrentThinkingEnabled } from './server-config-resolve';
import { harnessIsAuthed } from './server-slash';
import { AcpSession, type TelemetryTrackFn } from '#/session/index';

export interface ExistingSessionSetupDeps {
  readonly harness: LioraHarness;
  readonly conn: AgentSideConnection | undefined;
  readonly clientCapabilities: ClientCapabilities | undefined;
  readonly maybeBuildAcpKaos: (sessionId: string) => Promise<AcpKaos | undefined>;
  readonly ensureInnerKaos: () => Promise<Kaos>;
  readonly makeTelemetryTrack: () => TelemetryTrackFn | undefined;
  readonly registerSession: (sessionId: string, acpSession: AcpSession) => void;
}

export interface ExistingSessionSetupParams {
  readonly cwd: string;
  readonly sessionId: string;
  readonly mcpServers?: ReadonlyArray<McpServer>;
  readonly mode: 'load' | 'resume';
}

export interface ExistingSessionSetupResult {
  readonly session: Session;
  readonly acpSession: AcpSession;
  readonly configOptions: SessionConfigOption[];
}

/**
 * Shared setup for `session/load` and `session/resume`: gates auth,
 * checks the connection, resolves MCP servers, asks the harness to
 * resume the on-disk session, computes the current model/thinking
 * projection (with a resume-state fallback), constructs the
 * {@link AcpSession}, registers it under `session.id`, and builds
 * the unified `configOptions:` surface (PLAN D11) that both handlers
 * return.
 */
export async function setupSessionFromExisting(
  deps: ExistingSessionSetupDeps,
  params: ExistingSessionSetupParams,
): Promise<ExistingSessionSetupResult> {
  if (!(await harnessIsAuthed(deps.harness))) {
    throw RequestError.authRequired();
  }
  if (!deps.conn) {
    throw RequestError.internalError(undefined, 'AcpServer is missing its AgentSideConnection');
  }
  const mcpServers = acpMcpServersToConfigs(params.mcpServers);
  const acpKaos = await deps.maybeBuildAcpKaos(params.sessionId);
  const persistenceKaos = acpKaos === undefined ? undefined : await deps.ensureInnerKaos();
  let session: Session;
  try {
    session = await deps.harness.resumeSession({
      id: params.sessionId,
      kaos: acpKaos,
      persistenceKaos,
      sessionStartedProperties: { mode: params.mode },
      // @ts-expect-error — mcpServers is a kernel-only field that the SDK forwards via spread.
      mcpServers,
    });
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === 'session.not_found') {
      throw RequestError.invalidParams(
        { sessionId: params.sessionId },
        `Unknown sessionId: ${params.sessionId}`,
      );
    }
    throw error;
  }
  const resumeState = session.getResumeState?.();
  const resumedModelAlias = resumeState?.agents?.['main']?.config?.modelAlias;
  const currentModelId =
    typeof resumedModelAlias === 'string' && resumedModelAlias.length > 0
      ? resumedModelAlias
      : await resolveCurrentModelId(deps.harness);
  const resumedThinkingLevel = resumeState?.agents?.['main']?.config?.thinkingLevel;
  const currentThinkingEnabled =
    typeof resumedThinkingLevel === 'string'
      ? resumedThinkingLevel.trim().toLowerCase() !== 'off' &&
        resumedThinkingLevel.trim().length > 0
      : await resolveCurrentThinkingEnabled(deps.harness);
  const acpSession = new AcpSession(
    deps.conn,
    session,
    deps.clientCapabilities,
    deps.makeTelemetryTrack(),
    currentModelId,
    deps.harness,
    currentThinkingEnabled,
  );
  deps.registerSession(session.id, acpSession);
  const configOptions = await buildSessionConfigOptions(
    deps.harness,
    currentModelId,
    currentThinkingEnabled,
    DEFAULT_MODE_ID,
  );
  return { session, acpSession, configOptions };
}
