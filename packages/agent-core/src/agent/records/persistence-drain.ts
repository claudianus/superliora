import { appendFileSync } from 'node:fs';
import { open } from 'node:fs/promises';

import type { AgentRecord } from './types';

export const MAX_DRAIN_BATCH_RECORDS = 256;
/** Soft byte budget for one drain batch of serialized JSONL (approx). */
export const MAX_DRAIN_BATCH_BYTES = 4 * 1024 * 1024;
/** Max chars assembled before flushing a partial write within a batch. */
export const MAX_WRITE_CHUNK_CHARS = 1 * 1024 * 1024;

export function prependPendingRecords(pending: AgentRecord[], batch: readonly AgentRecord[]): void {
  if (batch.length === 0) return;
  const rest = pending.splice(0);
  pending.length = 0;
  for (const record of batch) {
    pending.push(record);
  }
  for (const record of rest) {
    pending.push(record);
  }
}

/**
 * How many pending records fit in one drain batch under the record + byte
 * soft caps. Always takes at least one record when the queue is non-empty so
 * a single oversized record still drains (written line-by-line without join).
 */
export function takeDrainBatchCount(pending: readonly AgentRecord[]): number {
  if (pending.length === 0) return 0;
  let count = 0;
  let approxBytes = 0;
  for (const record of pending) {
    if (count >= MAX_DRAIN_BATCH_RECORDS) break;
    // Size estimate reuses the cached serialized line so the writer never
    // stringifies a record twice. Slightly over-count for the newline so we
    // stay under the join ceiling even when JSON expands keys.
    const estimate = estimateRecordBytes(record);
    if (count > 0 && approxBytes + estimate > MAX_DRAIN_BATCH_BYTES) break;
    approxBytes += estimate;
    count += 1;
  }
  return Math.max(1, count);
}

/**
 * Serialized JSONL line cache for one drain pass. Batch counting estimates
 * bytes per record and the writer serializes the same records again; without
 * the cache every record (including large tool outputs) would run a full
 * JSON.stringify twice. WeakMap so drained records stay collectible.
 */
const drainLineCache = new WeakMap<AgentRecord, string>();

function serializedLine(record: AgentRecord): string {
  const cached = drainLineCache.get(record);
  if (cached !== undefined) return cached;
  const line = JSON.stringify(record);
  drainLineCache.set(record, line);
  return line;
}

export function estimateRecordBytes(record: AgentRecord): number {
  // Serialize once and reuse the exact line the writer will emit.
  try {
    return serializedLine(record).length + 1; // + newline
  } catch {
    // Circular / non-serializable should not happen for AgentRecord; if it
    // does, force a single-record batch so the real write path surfaces it.
    return MAX_DRAIN_BATCH_BYTES;
  }
}

/** Write JSONL lines in char-capped chunks — never one giant joined string. */
export async function writeJsonlLines(
  fh: Awaited<ReturnType<typeof open>>,
  records: readonly AgentRecord[],
): Promise<void> {
  let chunk = '';
  for (const record of records) {
    const line = `${serializedLine(record)}\n`;
    if (chunk.length > 0 && chunk.length + line.length > MAX_WRITE_CHUNK_CHARS) {
      // Use write(Buffer) (not writeFile): writeFile on a FileHandle rewrites
      // from position 0 and would clobber earlier chunks in the same open handle.
      await fh.write(Buffer.from(chunk, 'utf8'));
      chunk = '';
    }
    // A single line larger than the chunk budget still writes alone — never
    // join multiple huge lines into one string.
    if (line.length > MAX_WRITE_CHUNK_CHARS) {
      if (chunk.length > 0) {
        await fh.write(Buffer.from(chunk, 'utf8'));
        chunk = '';
      }
      await fh.write(Buffer.from(line, 'utf8'));
      continue;
    }
    chunk += line;
  }
  if (chunk.length > 0) {
    await fh.write(Buffer.from(chunk, 'utf8'));
  }
}

export function writeJsonlLinesSync(fd: number, records: readonly AgentRecord[]): void {
  let chunk = '';
  for (const record of records) {
    const line = `${serializedLine(record)}\n`;
    if (chunk.length > 0 && chunk.length + line.length > MAX_WRITE_CHUNK_CHARS) {
      appendFileSync(fd, chunk, 'utf8');
      chunk = '';
    }
    if (line.length > MAX_WRITE_CHUNK_CHARS) {
      if (chunk.length > 0) {
        appendFileSync(fd, chunk, 'utf8');
        chunk = '';
      }
      appendFileSync(fd, line, 'utf8');
      continue;
    }
    chunk += line;
  }
  if (chunk.length > 0) {
    appendFileSync(fd, chunk, 'utf8');
  }
}

export function parseRecordLine(
  line: string,
  lineNumber: number,
  filePath: string,
  allowTruncated: boolean,
): AgentRecord | undefined {
  if (line.length === 0) return undefined;
  try {
    return JSON.parse(line) as AgentRecord;
  } catch (parseError) {
    // Tolerate a truncated trailing line — last write may have crashed
    // mid-flush; everything before is still well-formed.
    if (allowTruncated) return undefined;
    throw new Error(
      `wire.jsonl: corrupted line ${lineNumber} in ${filePath}: ${String(parseError)}`,
      { cause: parseError },
    );
  }
}
