import { appendFileSync, closeSync, createReadStream, fsyncSync, mkdirSync, openSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'pathe';

import { syncDir, syncDirSync } from '../../utils/fs';
import type { BlobStore } from './blobref';
import { type AgentRecord, type AgentRecordPersistence } from './types';

export interface FileSystemAgentRecordPersistenceOptions {
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly blobStore?: BlobStore | undefined;
  /**
   * Number of consecutive drain failures after which the persistence enters a
   * latched (sticky) error state and stops retrying. Defaults to
   * {@link DEFAULT_MAX_CONSECUTIVE_DRAIN_FAILURES}. Below this threshold a
   * transient failure (e.g. momentary disk full) is cleared by the next
   * successful write so the agent can self-heal instead of being permanently
   * bricked.
   */
  readonly maxConsecutiveDrainFailures?: number | undefined;
}

/**
 * Default ceiling on consecutive drain failures. A run of failures this long
 * almost always indicates a persistent condition (read-only mount, deleted
 * directory, quota exhaustion) rather than a transient blip, so we latch to
 * avoid an infinite retry loop.
 */
const DEFAULT_MAX_CONSECUTIVE_DRAIN_FAILURES = 5;

/**
 * Cap a single drain batch so we never build one giant string for `writeFile`.
 * Large sessions (post-compaction rewrite, long wire journals) can exceed V8's
 * max string length (~512MB–1GB) when every pending record is `JSON.stringify`d
 * and `.join`ed — that surfaces as `RangeError: Invalid string length` and
 * kills the process. Batches stay well under that ceiling and are written as
 * sequential line chunks.
 */
const MAX_DRAIN_BATCH_RECORDS = 256;
/** Soft byte budget for one drain batch of serialized JSONL (approx). */
const MAX_DRAIN_BATCH_BYTES = 4 * 1024 * 1024;
/** Max chars assembled before flushing a partial write within a batch. */
const MAX_WRITE_CHUNK_CHARS = 1 * 1024 * 1024;

export interface InMemoryAgentRecordPersistenceOptions {
  readonly onRecord?: ((record: AgentRecord) => void) | undefined;
}

export class InMemoryAgentRecordPersistence implements AgentRecordPersistence {
  readonly records: AgentRecord[] = [];

  constructor(
    records: readonly AgentRecord[] = [],
    private readonly options: InMemoryAgentRecordPersistenceOptions = {},
  ) {
    this.records.push(...records);
  }

  async *read(): AsyncIterable<AgentRecord> {
    for (const record of this.records) {
      yield record;
    }
  }

  append(input: AgentRecord): void {
    this.records.push(input);
    this.options.onRecord?.(input);
  }

  rewrite(records: readonly AgentRecord[]): void {
    this.records.splice(0, this.records.length, ...records);
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  flushSync(): void {}

  recordCount(): number {
    return this.records.length;
  }
}

export class FileSystemAgentRecordPersistence implements AgentRecordPersistence {
  private readonly pendingRecords: AgentRecord[] = [];
  private shouldClear = false;
  private directorySynced = false;
  private flushPromise: Promise<void> | undefined;
  private error: unknown;
  private consecutiveFailures = 0;
  /**
   * Count of records durably appended (fsync'd) to the log. Advances only
   * after a batch write is confirmed durable so it reflects the true on-disk
   * append offset. Reset to the live record count after a rewrite (clear).
   */
  private committedRecordCount = 0;

  constructor(
    private readonly filePath: string,
    private readonly options: FileSystemAgentRecordPersistenceOptions = {},
  ) {}

  async *read(): AsyncIterable<AgentRecord> {
    await this.flush();

    let line = '';
    let lineNumber = 0;
    let yielded = 0;
    const stream = createReadStream(this.filePath, { encoding: 'utf8' });
    try {
      for await (const chunk of stream) {
        line += chunk;
        let newlineIndex = line.indexOf('\n');
        while (newlineIndex !== -1) {
          const rawLine = line.slice(0, newlineIndex);
          line = line.slice(newlineIndex + 1);
          lineNumber++;

          const record = parseRecordLine(
            rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine,
            lineNumber,
            this.filePath,
            false,
          );
          if (record !== undefined) {
            yielded++;
            yield record;
          }

          newlineIndex = line.indexOf('\n');
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw error;
    }

    if (line.length > 0) {
      lineNumber++;
      const record = parseRecordLine(line, lineNumber, this.filePath, true);
      if (record !== undefined) {
        yielded++;
        yield record;
      }
    }

    // Seed the committed offset from the records just read, so a freshly
    // resumed persistence reflects the existing durable log length before any
    // new appends or rewrites land.
    this.committedRecordCount = yielded;
  }

  append(input: AgentRecord): void {
    this.throwIfError();
    this.pendingRecords.push(input);
    this.scheduleFlush();
  }

  rewrite(records: readonly AgentRecord[]): void {
    this.throwIfError();
    this.shouldClear = true;
    // Avoid `splice(0, n, ...records)` / spread — huge sessions can blow the
    // call-stack argument limit before we even reach the disk path.
    this.pendingRecords.length = 0;
    for (const record of records) {
      this.pendingRecords.push(record);
    }
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    this.throwIfError();
    while (
      this.flushPromise !== undefined ||
      this.shouldClear ||
      this.pendingRecords.length > 0
    ) {
      await this.ensureFlush();
      this.throwIfError();
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }

  flushSync(): void {
    // Crash-path only (signal handlers, uncaughtExceptionMonitor): drain
    // whatever is still pending with a synchronous append + fsync + dir sync.
    //
    // We deliberately do NOT touch an in-flight async `flushPromise`: that
    // batch was already spliced out of `pendingRecords` and lives in the
    // async drain's local — if its write/fsync hadn't completed when the
    // process died, that batch is lost regardless (a sync path cannot await
    // an fd it does not own). We only guarantee durability for records still
    // in `pendingRecords` at the moment of the crash.
    //
    // Lines are written in char-capped chunks so we never assemble a single
    // multi-hundred-MB string (RangeError: Invalid string length).
    if (this.pendingRecords.length === 0 && !this.shouldClear) return;
    const clearAtStart = this.shouldClear;
    const batch = this.pendingRecords.splice(0);
    this.shouldClear = false;
    try {
      const directory = dirname(this.filePath);
      mkdirSync(directory, { recursive: true });
      const flags = clearAtStart ? 'w' : 'a';
      const fd = openSync(this.filePath, flags);
      try {
        writeJsonlLinesSync(fd, batch);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (!this.directorySynced) {
        syncDirSync(directory);
        this.directorySynced = true;
      }
      this.consecutiveFailures = 0;
      // Advance the committed offset for the batch we just fsync'd. On a clear
      // the log is reset to this batch; otherwise it extends the prior offset.
      // Note: an in-flight async drain may still settle its own batch later,
      // so the offset is approximate at crash time — acceptable, since journal
      // replay (not this counter) is the source of truth and the offset only
      // guides checkpoint precedence.
      this.committedRecordCount = clearAtStart
        ? batch.length
        : this.committedRecordCount + batch.length;
    } catch (error) {
      // Re-queue so a subsequent resume attempt can retry; do NOT latch — a
      // crash-path failure should not brick future sessions.
      this.pendingRecords.unshift(...batch);
      if (clearAtStart) this.shouldClear = true;
      this.options.onError?.(error);
    }
  }

  recordCount(): number {
    return this.committedRecordCount;
  }

  private scheduleFlush(): void {
    // Defer the drain start to a microtask so that a synchronous `flushSync`
    // (called from a signal handler / uncaughtExceptionMonitor within the same
    // tick as `append`) can drain `pendingRecords` before the async path
    // splices it out. The async drain still begins within the same tick —
    // only its synchronous `splice(0)` is pushed past the current call stack.
    queueMicrotask(() => {
      void this.ensureFlush().catch((error) => {
        this.options.onError?.(error);
      });
    });
  }

  private ensureFlush(): Promise<void> {
    if (this.flushPromise !== undefined) return this.flushPromise;

    const promise = this.drainPendingRecords()
      .then(() => {
        // A clean drain resets the failure streak so a later transient
        // error starts from zero instead of accumulating toward the latch.
        this.consecutiveFailures = 0;
      })
      .catch((error: unknown) => {
        this.consecutiveFailures += 1;
        // Below the latch threshold the error is transient — surface it via
        // onError (so the host can log / notify) but keep `this.error`
        // clear so the next append/flush attempt can self-heal. Only after
        // a long enough failure streak do we latch, to avoid retrying
        // forever against a genuinely broken sink (read-only mount, deleted
        // directory, exhausted quota).
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.error = error;
        }
        // oxlint-disable-next-line typescript-eslint/only-throw-error
        throw error;
      })
      .finally(() => {
        if (this.flushPromise === promise) {
          this.flushPromise = undefined;
        }
        // Only re-arm the background flush after a *successful* drain — a
        // failed drain already re-queued its batch, and immediately retrying
        // in the background would burn through the latch threshold on a
        // single persistent outage. The next explicit append/flush call
        // re-triggers the flush.
        if (
          this.consecutiveFailures === 0 &&
          this.error === undefined &&
          (this.shouldClear || this.pendingRecords.length > 0)
        ) {
          this.scheduleFlush();
        }
      });
    this.flushPromise = promise;
    return promise;
  }

  private get failureThreshold(): number {
    return this.options.maxConsecutiveDrainFailures ?? DEFAULT_MAX_CONSECUTIVE_DRAIN_FAILURES;
  }

  private throwIfError(): void {
    // oxlint-disable-next-line typescript-eslint/only-throw-error
    if (this.error !== undefined) throw this.error;
  }

  private async drainPendingRecords(): Promise<void> {
    while (this.shouldClear || this.pendingRecords.length > 0) {
      if (this.shouldClear) {
        // Rewrite must truncate once and write the full replacement set under a
        // single open handle. Splitting clear across multiple open('w')/'a'
        // cycles can leave a half-written journal if a later chunk fails.
        await this.drainRewrite();
      } else {
        await this.drainAppendBatch();
      }
    }
  }

  /**
   * Clear-then-write the entire pending queue. Lines are still serialized and
   * flushed in char-capped chunks so we never join a multi-hundred-MB string.
   */
  private async drainRewrite(): Promise<void> {
    const shouldClear = this.shouldClear;
    const batch = this.pendingRecords.splice(0);
    this.shouldClear = false;

    try {
      const writable =
        this.options.blobStore !== undefined
          ? await Promise.all(batch.map((record) => this.options.blobStore!.offload(record)))
          : batch;

      const directory = dirname(this.filePath);
      await mkdir(directory, { recursive: true });

      const fh = await open(this.filePath, 'w');
      try {
        await writeJsonlLines(fh, writable);
        await fh.sync();
      } finally {
        await fh.close();
      }

      if (!this.directorySynced) {
        await syncDir(directory);
        this.directorySynced = true;
      }
      this.committedRecordCount = writable.length;
    } catch (error) {
      this.pendingRecords.unshift(...batch);
      if (shouldClear) this.shouldClear = true;
      throw error;
    }
  }

  /**
   * Append a size-capped slice of pending records. Used for steady-state
   * append traffic so a burst of events cannot assemble one giant write.
   */
  private async drainAppendBatch(): Promise<void> {
    const takeCount = takeDrainBatchCount(this.pendingRecords);
    const batch = this.pendingRecords.splice(0, takeCount);

    try {
      const writable =
        this.options.blobStore !== undefined
          ? await Promise.all(batch.map((record) => this.options.blobStore!.offload(record)))
          : batch;

      const directory = dirname(this.filePath);
      await mkdir(directory, { recursive: true });

      const fh = await open(this.filePath, 'a');
      try {
        await writeJsonlLines(fh, writable);
        await fh.sync();
      } finally {
        await fh.close();
      }

      if (!this.directorySynced) {
        await syncDir(directory);
        this.directorySynced = true;
      }
      this.committedRecordCount += writable.length;
    } catch (error) {
      this.pendingRecords.unshift(...batch);
      throw error;
    }
  }
}

/**
 * How many pending records fit in one drain batch under the record + byte
 * soft caps. Always takes at least one record when the queue is non-empty so
 * a single oversized record still drains (written line-by-line without join).
 */
function takeDrainBatchCount(pending: readonly AgentRecord[]): number {
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

function estimateRecordBytes(record: AgentRecord): number {
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
async function writeJsonlLines(
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

function writeJsonlLinesSync(fd: number, records: readonly AgentRecord[]): void {
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

function parseRecordLine(
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
