import { SESSION_STATE_VERSION, type AgentMeta, type SessionMeta } from '#/session/lifecycle/session-types';
import {
  customMetadataWithoutGoal,
  isRecord,
  persistAgentHomedirsUnknown,
  resolveAgentHomedir,
} from '#/session/store/session-store-helpers';

/** List-cache cap; matches the TUI draft store. */
export const LAST_PROMPT_MAX_CHARS = 200_000;

export function truncateLastPrompt(value: string): string {
  if (value.length <= LAST_PROMPT_MAX_CHARS) return value;
  return value.slice(0, LAST_PROMPT_MAX_CHARS);
}

export function prepareSessionMetaForWrite(meta: SessionMeta, sessionDir?: string): SessionMeta {
  return {
    ...meta,
    version: SESSION_STATE_VERSION,
    lastPrompt:
      typeof meta.lastPrompt === 'string' ? truncateLastPrompt(meta.lastPrompt) : meta.lastPrompt,
    custom: customMetadataWithoutGoal(meta.custom),
    ...(sessionDir === undefined
      ? {}
      : { agents: persistAgentHomedirsUnknown(meta.agents, sessionDir) as SessionMeta['agents'] }),
  };
}

export function resolveSessionMetaHomedirs(meta: SessionMeta, sessionDir: string): SessionMeta {
  const agents: Record<string, AgentMeta> = {};
  for (const [id, agent] of Object.entries(meta.agents)) {
    agents[id] = { ...agent, homedir: resolveAgentHomedir(sessionDir, agent.homedir) };
  }
  return { ...meta, agents };
}

/** Preserve unknown top-level keys (legacy / test fixtures) while stamping format rules. */
export function prepareSessionStateRecord(
  value: Record<string, unknown>,
  sessionDir?: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...value,
    version: SESSION_STATE_VERSION,
  };
  if (typeof next['lastPrompt'] === 'string') {
    next['lastPrompt'] = truncateLastPrompt(next['lastPrompt']);
  }
  if (isRecord(next['custom'])) {
    next['custom'] = customMetadataWithoutGoal(next['custom']);
  }
  if (sessionDir !== undefined && isRecord(next['agents'])) {
    next['agents'] = persistAgentHomedirsUnknown(next['agents'], sessionDir);
  }
  return next;
}
