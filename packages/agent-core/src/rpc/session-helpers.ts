/**
 * Session utility helpers — extracted from core-impl.ts.
 *
 * Small, stateless functions used by LioraCore for session creation,
 * resume payload assembly, and telemetry metadata.
 */

import { randomUUID } from 'node:crypto';

import { ErrorCodes, LioraError } from '#/errors/index';
import type { Logger } from '../logging/types';
import { Agent } from '../agent';
import {
  limitReplayRecordsByTurn,
  RESUME_REPLAY_TURN_LIMIT,
} from '../agent/replay';
import type { Session } from '../session';
import { SessionAPIImpl } from '../session/rpc';
import { normalizeWorkDir } from '../session/store/index';
import type { TelemetryProperties } from '../telemetry';
import type { ClientTelemetryInfo, SessionSummary } from './core-api';
import type { ResumedAgentState, ResumeSessionResult } from './resumed';

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

export function requiredWorkDir(operation: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LioraError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, `${operation} requires workDir`);
  }
  return normalizeWorkDir(value);
}

export function createSessionId(): string {
  return `session_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

export function withAdditionalDirs<T>(
  result: T,
  session: Session,
): T & { readonly additionalDirs: readonly string[] } {
  return {
    ...result,
    additionalDirs: session.getAdditionalDirs(),
  };
}

export async function resumeSessionResult(
  summary: SessionSummary,
  session: Session,
  warning?: string,
): Promise<ResumeSessionResult> {
  const api = new SessionAPIImpl(session);
  const agents: Record<string, ResumedAgentState> = {};
  // Resume latency scales with subagent count: these six reads per agent used
  // to run sequentially (6N round-trips before the UI showed the session).
  // Fetch each agent's API slice concurrently.
  const resumed = await Promise.all(
    [...session.agents.entries()].map(async ([agentId, entry]) => {
      if (!(entry instanceof Agent)) return undefined;
      const agent = entry;
      const [config, context, permission, plan, usage, tools] = await Promise.all([
        api.getConfig({ agentId }),
        api.getContext({ agentId }),
        api.getPermission({ agentId }),
        api.getPlan({ agentId }),
        api.getUsage({ agentId }),
        api.getTools({ agentId }),
      ]);
      const replay = limitReplayRecordsByTurn(
        agent.replayBuilder.buildResult(),
        RESUME_REPLAY_TURN_LIMIT,
      );
      // Cap the in-memory builder to the payload window without aliasing the
      // returned array (keepOnly must not clear the payload view).
      agent.replayBuilder.keepOnly(replay);
      const state: ResumedAgentState = {
        type: agent.type,
        config,
        context,
        replay,
        permission,
        plan,
        usage,
        tools,
        toolStore: agent.tools.storeData(),
        background: agent.background.list(false),
      };
      return [agentId, state] as const;
    }),
  );
  for (const pair of resumed) {
    if (pair !== undefined) {
      agents[pair[0]] = pair[1];
    }
  }
  return withAdditionalDirs(
    {
      ...summary,
      sessionMetadata: api.getSessionMetadata({}),
      agents,
      warning,
    },
    session,
  );
}

// ---------------------------------------------------------------------------
// Telemetry helpers
// ---------------------------------------------------------------------------

export function telemetryErrorReason(error: unknown): string {
  if (error instanceof LioraError) return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name;
  return typeof error;
}

export function clientTelemetryProperties(client: ClientTelemetryInfo | undefined): TelemetryProperties {
  if (client === undefined) return {};
  return {
    client_id: client.id ?? null,
    client_name: client.name ?? null,
    client_version: client.version ?? null,
    ui_mode: client.uiMode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function warnIfLogFlushFails(
  exportLog: Logger,
  message: string,
  flush: () => Promise<boolean>,
): Promise<void> {
  try {
    if (await flush()) return;
    exportLog.warn(message);
  } catch (error) {
    exportLog.warn(message, { error });
  }
  try {
    await flush();
  } catch {}
}
