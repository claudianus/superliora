/**
 * Durable per-session prompt queue sidecar for the daemon path.
 *
 * `PromptService` kept its queue in memory only, so a daemon restart dropped
 * every queued prompt the user still expected to run. This store mirrors the
 * CLI's `prompt-input-state` pattern: one JSON sidecar per session
 * (`<sessionDir>/prompt-queue.json`), atomic tmp→rename writes, tolerant
 * reads (missing / corrupt / wrong-version → empty).
 *
 * Only *queued* prompts are persisted. The active prompt is intentionally
 * excluded — its turn was in flight when the process died, and replaying a
 * half-observed turn is worse than surfacing the transcript as-is.
 */

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PromptSubmission } from '@superliora/protocol';

import type { PromptState } from './promptState';

export const PROMPT_QUEUE_FILE = 'prompt-queue.json';

const QUEUE_SCHEMA_VERSION = 1 as const;
/** Cap persisted entries per session; the oldest are kept on overflow. */
export const MAX_PERSISTED_QUEUE_ITEMS = 100;
/** Per-text-part cap so one huge paste cannot bloat the sidecar. */
const MAX_PART_TEXT_LENGTH = 200_000;

interface PersistedPromptRecord {
  readonly agentId: string;
  readonly promptId: string;
  readonly userMessageId: string;
  readonly body: PromptSubmission;
  readonly createdAt: string;
}

interface PromptQueueFile {
  readonly version: typeof QUEUE_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly prompts: readonly PersistedPromptRecord[];
}

function toRecord(state: PromptState): PersistedPromptRecord {
  return {
    agentId: state.agentId,
    promptId: state.promptId,
    userMessageId: state.userMessageId,
    body: truncateBody(state.body),
    createdAt: state.createdAt,
  };
}

function fromRecord(record: PersistedPromptRecord): PromptState | undefined {
  if (
    typeof record.agentId !== 'string' ||
    typeof record.promptId !== 'string' ||
    typeof record.userMessageId !== 'string' ||
    typeof record.createdAt !== 'string' ||
    !isPromptSubmission(record.body)
  ) {
    return undefined;
  }
  return {
    agentId: record.agentId,
    promptId: record.promptId,
    userMessageId: record.userMessageId,
    body: record.body,
    createdAt: record.createdAt,
    turnId: null,
    completed: false,
    aborted: false,
  };
}

function isPromptSubmission(value: unknown): value is PromptSubmission {
  if (typeof value !== 'object' || value === null) return false;
  const content = (value as { content?: unknown }).content;
  return Array.isArray(content) && content.length > 0;
}

function truncateBody(body: PromptSubmission): PromptSubmission {
  return {
    ...body,
    content: body.content.map((part) => {
      if (part.type !== 'text') return part;
      if (part.text.length <= MAX_PART_TEXT_LENGTH) return part;
      return { ...part, text: part.text.slice(0, MAX_PART_TEXT_LENGTH) };
    }),
  };
}

/**
 * Load persisted queued prompts for a session. Never throws — a missing,
 * corrupt, or unparseable sidecar reads as an empty queue so resume still
 * works.
 */
export async function readQueuedPrompts(sessionDir: string): Promise<PromptState[]> {
  let raw: string;
  try {
    raw = await readFile(join(sessionDir, PROMPT_QUEUE_FILE), 'utf-8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  const file = parsed as Partial<PromptQueueFile> | null;
  if (
    typeof file !== 'object' ||
    file === null ||
    file.version !== QUEUE_SCHEMA_VERSION ||
    !Array.isArray(file.prompts)
  ) {
    return [];
  }
  const states: PromptState[] = [];
  for (const record of file.prompts) {
    const state = fromRecord(record as PersistedPromptRecord);
    if (state !== undefined) states.push(state);
  }
  return states;
}

/**
 * Persist the full queued set for a session (all agent lanes, FIFO order).
 * Atomic tmp→rename; failures are swallowed by the caller — persistence is
 * best-effort and must never break the submit path.
 */
export async function writeQueuedPrompts(
  sessionDir: string,
  states: readonly PromptState[],
): Promise<void> {
  if (states.length === 0) {
    await clearQueuedPrompts(sessionDir);
    return;
  }
  const file: PromptQueueFile = {
    version: QUEUE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    prompts: states.slice(0, MAX_PERSISTED_QUEUE_ITEMS).map(toRecord),
  };
  const filePath = join(sessionDir, PROMPT_QUEUE_FILE);
  // Persist only into an existing session directory. The daemon always has
  // one; inventing directories from a stale or fabricated path would be a
  // filesystem side effect the queue layer has no business performing.
  try {
    await stat(sessionDir);
  } catch {
    return;
  }
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(file), 'utf-8');
  await rename(tmpPath, filePath);
}

/** Remove the sidecar when the queue drains. Missing file is fine. */
export async function clearQueuedPrompts(sessionDir: string): Promise<void> {
  try {
    await rm(join(sessionDir, PROMPT_QUEUE_FILE), { force: true });
  } catch {
    // Best-effort — an undeletable sidecar must not break the drain path.
  }
}
