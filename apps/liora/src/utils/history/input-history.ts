/**
 * User input history persistence — JSONL file with `{"content": "..."}` per line.
 *
 * Semantics:
 * - One JSON object per line (`InputHistoryEntry { content }`)
 * - Append-only writes
 * - Skip empty entries
 * - Skip when same as last entry (consecutive deduplication)
 * - Tolerate corrupt lines: log + skip, do not abort load
 */

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { appendJsonlLine, readJsonlFile } from '#/utils/persistence';

export interface InputHistoryEntry {
  content: string;
}

const InputHistoryEntrySchema: z.ZodType<InputHistoryEntry> = z.object({
  content: z.string(),
});

export async function loadInputHistory(file: string): Promise<InputHistoryEntry[]> {
  return readJsonlFile(file, InputHistoryEntrySchema);
}

/**
 * Append an entry to the history file. Returns true if written, false if
 * skipped (empty or equal to `lastContent`).
 */
export async function appendInputHistory(
  file: string,
  text: string,
  lastContent?: string,
): Promise<boolean> {
  const content = text.trim();
  if (content.length === 0) return false;
  if (content === lastContent) return false;
  await appendJsonlLine(file, InputHistoryEntrySchema, { content });
  return true;
}

/** Maximum entries retained in the global (cross-workdir) history file. */
const GLOBAL_HISTORY_MAX_ENTRIES = 500;

/**
 * Load the global (cross-workdir) history file. Shares the JSONL format and
 * schema used for workdir-specific history.
 */
export async function loadGlobalInputHistory(file: string): Promise<InputHistoryEntry[]> {
  return readJsonlFile(file, InputHistoryEntrySchema);
}

/**
 * Append an entry to the global history file, then trim the file down to the
 * most recent {@link GLOBAL_HISTORY_MAX_ENTRIES} entries so it stays bounded.
 * Returns true if written, false if skipped (empty).
 */
export async function appendGlobalInputHistory(file: string, text: string): Promise<boolean> {
  const content = text.trim();
  if (content.length === 0) return false;
  await appendJsonlLine(file, InputHistoryEntrySchema, { content });
  await trimGlobalHistoryFile(file);
  return true;
}

/** Keep only the most recent `GLOBAL_HISTORY_MAX_ENTRIES` lines, best-effort. */
async function trimGlobalHistoryFile(file: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    return;
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length <= GLOBAL_HISTORY_MAX_ENTRIES) return;
  const kept = lines.slice(-GLOBAL_HISTORY_MAX_ENTRIES);
  await writeFile(file, `${kept.join('\n')}\n`, 'utf-8');
}
