import { join, relative, isAbsolute } from 'pathe';
import { readFile, readdir, rm, stat } from 'node:fs/promises';

import { z } from 'zod';

import { ErrorCodes, LioraError } from '#/errors/index';
import type { JsonObject, SessionSummary } from '#/rpc/core-api';
import { normalizeWorkDir } from '#/session/store/workdir-key';
import { FileSystemAgentRecordPersistence, type AgentRecordOf } from '../../agent/records';

export const SessionSummaryStateSchema = z.object({
  archived: z.boolean().optional(),
  customTitle: z.string().optional(),
  isCustomTitle: z.boolean().optional(),
  lastPrompt: z.string().optional(),
  title: z.string().optional(),
  workDir: z.string().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const FORKED_SESSION_DROPPED_FILES = ['upcoming-goals.json'] as const;

export type SessionSummaryState = z.infer<typeof SessionSummaryStateSchema>;

function metadataFromState(state: SessionSummaryState | undefined): JsonObject | undefined {
  if (state === undefined || state.custom === undefined) return undefined;
  return state.custom as JsonObject;
}

function forkCustomMetadata(source: unknown, metadata: JsonObject | undefined): Record<string, unknown> {
  return {
    ...customMetadataWithoutGoal(source),
    ...customMetadataWithoutGoal(metadata),
  };
}

async function dropForkedSessionFiles(sessionDir: string): Promise<void> {
  await Promise.all(
    FORKED_SESSION_DROPPED_FILES.map((fileName) => rm(join(sessionDir, fileName), { force: true })),
  );
}

async function appendForkedMarkers(state: Record<string, unknown>): Promise<void> {
  const record: AgentRecordOf<'forked'> = { type: 'forked', time: Date.now() };

  const agents = state['agents'];
  if (!isRecord(agents)) return;

  const paths = new Set<string>();
  for (const agentMeta of Object.values(agents)) {
    if (!isRecord(agentMeta)) continue;
    const homedir = agentMeta['homedir'];
    if (typeof homedir !== 'string') continue;
    paths.add(join(homedir, 'wire.jsonl'));
  }

  await Promise.all([...paths].map(async (path) => {
    const persistence = new FileSystemAgentRecordPersistence(path);
    persistence.append(record);
    await persistence.flush();
  }));
}

function customMetadataWithoutGoal(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const custom: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'goal') continue;
    custom[key] = entry;
  }
  return custom;
}

async function latestAgentWireMtime(sessionDir: string): Promise<number | undefined> {
  const agentsDir = join(sessionDir, 'agents');
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let latest = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wireInfo = await statIfExists(join(agentsDir, entry.name, 'wire.jsonl'));
    latest = Math.max(latest, wireInfo?.mtimeMs ?? 0);
  }
  return latest > 0 ? latest : undefined;
}

function titleFromState(state: SessionSummaryState | undefined): string | undefined {
  if (state === undefined) return undefined;
  if (typeof state.isCustomTitle === 'boolean' && typeof state.title === 'string') {
    return state.title;
  }
  if (typeof state.customTitle === 'string') return state.customTitle;
  return typeof state.title === 'string' ? state.title : undefined;
}

async function readOptionalState(sessionDir: string): Promise<SessionSummaryState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(sessionDir, 'state.json'), 'utf-8')) as unknown;
    const result = SessionSummaryStateSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRequiredWorkDir(workDir: string): string {
  if (workDir.trim() === '') {
    throw new LioraError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, 'listSessions requires workDir');
  }
  return normalizeWorkDir(workDir);
}

function normalizeOptionalSessionId(sessionId: string | undefined): string | undefined {
  return sessionId === undefined ? undefined : sessionId.trim();
}

function normalizeForkTitle(title: string | undefined, fallback: unknown): string {
  if (title !== undefined) {
    const normalized = title.trim();
    if (normalized.length === 0) {
      throw new LioraError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    return normalized;
  }
  return typeof fallback === 'string' && fallback.trim().length > 0 ? fallback : 'New Session';
}

function rewriteAgentHomedirs(value: unknown, sourceDir: string, targetDir: string): unknown {
  if (!isRecord(value)) return {};

  const agents: Record<string, unknown> = {};
  for (const [agentId, agentMeta] of Object.entries(value)) {
    if (!isRecord(agentMeta)) {
      agents[agentId] = agentMeta;
      continue;
    }
    const homedir = agentMeta['homedir'];
    agents[agentId] = {
      ...agentMeta,
      homedir:
        typeof homedir === 'string' ? remapSessionPath(homedir, sourceDir, targetDir) : homedir,
    };
  }
  return agents;
}

function remapSessionPath(value: string, sourceDir: string, targetDir: string): string {
  const rel = relative(sourceDir, value);
  if (rel === '') return targetDir;
  if (rel.startsWith('..') || isAbsolute(rel)) return value;
  return join(targetDir, rel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function statIfExists(path: string): Promise<{ readonly mtimeMs: number } | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function timestampOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertSafeSessionId(id: string): void {
  if (isSafeSessionId(id)) return;
  throw new LioraError(ErrorCodes.SESSION_ID_INVALID, 'Session id contains unsupported path characters');
}

function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

function compareSessionSummary(a: SessionSummary, b: SessionSummary): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
