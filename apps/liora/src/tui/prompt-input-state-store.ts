/**
 * Durable prompt-input state for crash/resume recovery.
 *
 * Goal queue already lives on disk (`upcoming-goals.json`). The in-memory
 * prompt queue, Ctrl-X stash, and editor draft did not — a hard kill mid-turn
 * dropped everything the user still expected to send. This store mirrors that
 * goal-queue pattern under `<sessionDir>/prompt-input-state.json`.
 *
 * Media attachment ids and structured PromptParts are intentionally omitted:
 * they point at process-local image store state that cannot be resurrected
 * after a restart. Text (and bash mode) is always enough to re-submit.
 */

import { z } from 'zod';

import { readJsonFile, writeJsonFile } from '#/utils/persistence';

import type { QueuedMessage } from './types';
import type { PromptStashEntry } from './utils/prompt-stash';

export const PROMPT_INPUT_STATE_FILE = 'prompt-input-state.json';
const PROMPT_INPUT_STATE_VERSION = 1 as const;
const DRAFT_PERSIST_DEBOUNCE_MS = 250;
const MAX_TEXT_LENGTH = 200_000;
const MAX_QUEUE_ITEMS = 200;
const MAX_STASH_ITEMS = 50;

const modeSchema = z.enum(['prompt', 'bash']);

const queuedMessageSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  displayText: z.string().max(MAX_TEXT_LENGTH).optional(),
  agentId: z.string().max(200).optional(),
  mode: modeSchema.optional(),
});

const stashEntrySchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  mode: modeSchema,
});

const draftSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  mode: modeSchema,
});

const fileSchema = z.object({
  version: z.literal(PROMPT_INPUT_STATE_VERSION),
  updatedAt: z.string(),
  messages: z.array(queuedMessageSchema).max(MAX_QUEUE_ITEMS),
  stash: z.array(stashEntrySchema).max(MAX_STASH_ITEMS),
  draft: draftSchema.nullable(),
  lastUserInput: z.string().max(MAX_TEXT_LENGTH).optional(),
});

export type PromptInputStateSnapshot = z.infer<typeof fileSchema>;

export interface PromptInputSession {
  readonly id: string;
  readonly summary?: {
    readonly sessionDir?: string;
  };
}

export interface PersistablePromptInputState {
  readonly messages: readonly QueuedMessage[];
  readonly stash: readonly PromptStashEntry[];
  readonly draft: PromptStashEntry | null;
  readonly lastUserInput?: string | undefined;
}

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const writeLocks = new Map<string, Promise<void>>();

export function promptInputStatePath(session: PromptInputSession): string | undefined {
  const sessionDir = session.summary?.sessionDir?.trim();
  if (sessionDir === undefined || sessionDir.length === 0) return undefined;
  return `${sessionDir.replace(/\/+$/, '')}/${PROMPT_INPUT_STATE_FILE}`;
}

export async function readPromptInputState(
  session: PromptInputSession,
): Promise<PromptInputStateSnapshot> {
  const filePath = promptInputStatePath(session);
  if (filePath === undefined) return emptySnapshot();
  try {
    return await readJsonFile(filePath, fileSchema, emptySnapshot());
  } catch {
    // Corrupt / unexpected schema: treat as empty so resume still works.
    return emptySnapshot();
  }
}

export async function writePromptInputState(
  session: PromptInputSession,
  state: PersistablePromptInputState,
): Promise<void> {
  const filePath = promptInputStatePath(session);
  if (filePath === undefined) return;

  const snapshot: PromptInputStateSnapshot = {
    version: PROMPT_INPUT_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    messages: state.messages.slice(0, MAX_QUEUE_ITEMS).map(serializeQueuedMessage),
    stash: state.stash.slice(-MAX_STASH_ITEMS).map(serializeStashEntry),
    draft: serializeDraft(state.draft),
    ...(state.lastUserInput !== undefined && state.lastUserInput.length > 0
      ? { lastUserInput: truncate(state.lastUserInput) }
      : {}),
  };

  await withWriteLock(filePath, async () => {
    await writeJsonFile(filePath, fileSchema, snapshot);
  });
}

/** Immediate persist (queue / stash mutations). */
export function persistPromptInputState(
  session: PromptInputSession | undefined,
  state: PersistablePromptInputState,
): void {
  if (session === undefined) return;
  const filePath = promptInputStatePath(session);
  if (filePath === undefined) return;
  // Cancel a pending draft-only debounce so the full snapshot wins.
  const pending = draftTimers.get(filePath);
  if (pending !== undefined) {
    clearTimeout(pending);
    draftTimers.delete(filePath);
  }
  void writePromptInputState(session, state).catch(() => {
    // Best-effort: never block the input path on disk errors.
  });
}

/** Debounced persist for editor draft keystrokes. */
export function schedulePersistPromptInputDraft(
  session: PromptInputSession | undefined,
  state: PersistablePromptInputState,
): void {
  if (session === undefined) return;
  const filePath = promptInputStatePath(session);
  if (filePath === undefined) return;
  const previous = draftTimers.get(filePath);
  if (previous !== undefined) clearTimeout(previous);
  const timer = setTimeout(() => {
    draftTimers.delete(filePath);
    void writePromptInputState(session, state).catch(() => {});
  }, DRAFT_PERSIST_DEBOUNCE_MS);
  draftTimers.set(filePath, timer);
}

export function queuedMessagesFromSnapshot(
  snapshot: PromptInputStateSnapshot,
): QueuedMessage[] {
  return snapshot.messages.map((item) => ({
    text: item.text,
    ...(item.displayText !== undefined ? { displayText: item.displayText } : {}),
    ...(item.agentId !== undefined ? { agentId: item.agentId } : {}),
    ...(item.mode !== undefined ? { mode: item.mode } : {}),
  }));
}

export function stashEntriesFromSnapshot(
  snapshot: PromptInputStateSnapshot,
): PromptStashEntry[] {
  return snapshot.stash.map((entry) => ({
    text: entry.text,
    mode: entry.mode,
  }));
}

function emptySnapshot(): PromptInputStateSnapshot {
  return {
    version: PROMPT_INPUT_STATE_VERSION,
    updatedAt: new Date(0).toISOString(),
    messages: [],
    stash: [],
    draft: null,
  };
}

function serializeQueuedMessage(item: QueuedMessage): z.infer<typeof queuedMessageSchema> {
  return {
    text: truncate(item.text),
    ...(item.displayText !== undefined ? { displayText: truncate(item.displayText) } : {}),
    ...(item.agentId !== undefined ? { agentId: item.agentId.slice(0, 200) } : {}),
    ...(item.mode !== undefined ? { mode: item.mode } : {}),
  };
}

function serializeStashEntry(entry: PromptStashEntry): z.infer<typeof stashEntrySchema> {
  return {
    text: truncate(entry.text),
    mode: entry.mode,
  };
}

function serializeDraft(draft: PromptStashEntry | null): z.infer<typeof draftSchema> | null {
  if (draft === null) return null;
  // Empty draft: drop so resume does not force a blank mode change.
  if (draft.text.length === 0) return null;
  return { text: truncate(draft.text), mode: draft.mode };
}

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH);
}

async function withWriteLock(filePath: string, work: () => Promise<void>): Promise<void> {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const lock = run.then(
    () => undefined,
    () => undefined,
  );
  writeLocks.set(filePath, lock);
  try {
    await run;
  } finally {
    if (writeLocks.get(filePath) === lock) {
      writeLocks.delete(filePath);
    }
  }
}
