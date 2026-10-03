/**
 * Durable prompt-input state for crash/resume recovery.
 *
 * The prompt queue, Ctrl-X stash, and editor draft are stored under
 * `<sessionDir>/ui/draft.json`. Queued PromptParts carry their media content
 * or durable URLs across session switches and restarts; process-local preview
 * ids are not persisted.
 */

import { z } from 'zod';

import { readJsonFilePrefer, unlinkIfExists, writeJsonFile } from '#/utils/persistence';

import type { QueuedMessage } from './types';
import type { PromptStashEntry } from './utils/prompt-stash';
import {
  LEGACY_PROMPT_INPUT_STATE_FILE,
  PROMPT_INPUT_STATE_FILE,
  sessionUiFilePath,
} from './utils/session/session-ui-paths';

export { PROMPT_INPUT_STATE_FILE };

const PROMPT_INPUT_STATE_VERSION = 1 as const;
const DRAFT_PERSIST_DEBOUNCE_MS = 250;
const MAX_TEXT_LENGTH = 200_000;
const MAX_QUEUE_ITEMS = 200;
const MAX_STASH_ITEMS = 50;

const modeSchema = z.enum(['prompt', 'bash']);

const mediaUrlSchema = z.object({ url: z.string(), id: z.string().optional() });
const promptPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image_url'), imageUrl: mediaUrlSchema }),
  z.object({ type: z.literal('audio_url'), audioUrl: mediaUrlSchema }),
  z.object({ type: z.literal('video_url'), videoUrl: mediaUrlSchema }),
  z.object({ type: z.literal('file_url'), fileUrl: mediaUrlSchema.extend({ filename: z.string().optional() }) }),
]);

const queuedMessageSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  displayText: z.string().max(MAX_TEXT_LENGTH).optional(),
  agentId: z.string().max(200).optional(),
  mode: modeSchema.optional(),
  parts: z.array(promptPartSchema).optional(),
  combinedDisplayTexts: z.array(z.string().max(MAX_TEXT_LENGTH)).optional(),
  /** Older queue snapshots may contain placeholders without their media. */
  hadAttachments: z.boolean().optional(),
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
/**
 * Last full snapshot written per file. The keystroke path persists only the
 * draft and merges with this at read time, so typing does not re-serialize
 * the whole queue (up to 200 × 200 KB) every 250 ms.
 */
const lastWrittenSnapshots = new Map<string, PromptInputStateSnapshot>();

export function promptInputStatePath(session: PromptInputSession): string | undefined {
  return sessionUiSidecarPath(session, PROMPT_INPUT_STATE_FILE);
}

function promptInputLegacyPath(session: PromptInputSession): string | undefined {
  return sessionUiSidecarPath(session, LEGACY_PROMPT_INPUT_STATE_FILE);
}

function sessionUiSidecarPath(
  session: PromptInputSession,
  relative: string,
): string | undefined {
  const sessionDir = session.summary?.sessionDir?.trim();
  if (sessionDir === undefined || sessionDir.length === 0) return undefined;
  return sessionUiFilePath(sessionDir, relative);
}

export async function readPromptInputState(
  session: PromptInputSession,
): Promise<PromptInputStateSnapshot> {
  const filePath = promptInputStatePath(session);
  if (filePath === undefined) return emptySnapshot();
  try {
    const legacyPath = promptInputLegacyPath(session);
    return await readJsonFilePrefer(
      filePath,
      legacyPath ?? filePath,
      fileSchema,
      emptySnapshot(),
    );
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
    lastWrittenSnapshots.set(filePath, snapshot);
    const legacyPath = promptInputLegacyPath(session);
    if (legacyPath !== undefined) await unlinkIfExists(legacyPath);
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
    // Keystroke path: reuse the queue/stash/lastUserInput from the last full
    // snapshot instead of re-serializing the live (potentially huge) queue
    // arrays on every 250 ms pause. `persistPromptInputState` mutates state
    // between keystrokes and refreshes the cache, so a stale merge window is
    // limited to a single debounce tick.
    const base = lastWrittenSnapshots.get(filePath);
    const draft = state.draft;
    const draftSerialized =
      draft === null
        ? null
        : draft.text.length === 0
          ? null
          : { text: truncate(draft.text), mode: draft.mode };
    if (base === undefined) {
      void writePromptInputState(session, state).catch(() => {});
      return;
    }
    const snapshot: PromptInputStateSnapshot = {
      ...base,
      updatedAt: new Date().toISOString(),
      draft: draftSerialized,
    };
    void withWriteLock(filePath, async () => {
      await writeJsonFile(filePath, fileSchema, snapshot);
      lastWrittenSnapshots.set(filePath, snapshot);
    }).catch(() => {});
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
    ...(item.parts !== undefined ? { parts: item.parts } : {}),
    ...(item.combinedDisplayTexts !== undefined ? { combinedDisplayTexts: item.combinedDisplayTexts } : {}),
    ...(item.hadAttachments === true ? { hadAttachments: true } : {}),
  }));
}

/** Count of restored queue items whose attachments were lost to the restart. */
export function countRestoredAttachmentLosses(snapshot: PromptInputStateSnapshot): number {
  return snapshot.messages.filter((item) => item.hadAttachments === true && item.parts === undefined).length;
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
  const hadAttachments = item.parts === undefined &&
    (item.hadAttachments === true || (item.imageAttachmentIds?.length ?? 0) > 0);
  return {
    text: truncate(item.text),
    ...(item.displayText !== undefined ? { displayText: truncate(item.displayText) } : {}),
    ...(item.agentId !== undefined ? { agentId: item.agentId.slice(0, 200) } : {}),
    ...(item.mode !== undefined ? { mode: item.mode } : {}),
    ...(item.parts !== undefined ? { parts: [...item.parts] } : {}),
    ...(item.combinedDisplayTexts !== undefined ? { combinedDisplayTexts: [...item.combinedDisplayTexts] } : {}),
    ...(hadAttachments ? { hadAttachments: true } : {}),
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
