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
    // Cheap size estimate: avoid full stringify twice. Over-estimate slightly
    // so we stay under the join ceiling even when JSON expands keys.
    const estimate = estimateRecordBytes(record);
    if (count > 0 && approxBytes + estimate > MAX_DRAIN_BATCH_BYTES) break;
    approxBytes += estimate;
    count += 1;
  }
  return Math.max(1, count);
}

export function estimateRecordBytes(record: AgentRecord): number {
  // Rough UTF-8 estimate without a full stringify of every pending row.
  // Prefer known large text fields; fall back to a modest default.
  try {
    const asJson = JSON.stringify(record);
    return asJson.length + 1; // + newline
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
    const line = `${JSON.stringify(record)}\n`;
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
    const line = `${JSON.stringify(record)}\n`;
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
