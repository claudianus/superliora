import { createReadStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'pathe';

import { syncDir } from '../../utils/fs';
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
}

export class FileSystemAgentRecordPersistence implements AgentRecordPersistence {
  private readonly pendingRecords: AgentRecord[] = [];
  private shouldClear = false;
  private directorySynced = false;
  private flushPromise: Promise<void> | undefined;
  private error: unknown;
  private consecutiveFailures = 0;

  constructor(
    private readonly filePath: string,
    private readonly options: FileSystemAgentRecordPersistenceOptions = {},
  ) {}

  async *read(): AsyncIterable<AgentRecord> {
    await this.flush();

    let line = '';
    let lineNumber = 0;
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
          if (record !== undefined) yield record;

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
      if (record !== undefined) yield record;
    }
  }

  append(input: AgentRecord): void {
    this.throwIfError();
    this.pendingRecords.push(input);
    this.scheduleFlush();
  }

  rewrite(records: readonly AgentRecord[]): void {
    this.throwIfError();
    this.shouldClear = true;
    this.pendingRecords.splice(0, this.pendingRecords.length, ...records);
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

  private scheduleFlush(): void {
    void this.ensureFlush().catch((error) => {
      this.options.onError?.(error);
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
      await this.drainBatch();
    }
  }

  private async drainBatch(): Promise<void> {
    const shouldClear = this.shouldClear;
    // Snapshot the batch but do not drop it from `pendingRecords` until the
    // write is confirmed durable. On failure we re-queue it at the front so
    // a transient error does not silently lose records — the next flush
    // attempt re-attempts the same batch instead of skipping ahead.
    const batch = this.pendingRecords.splice(0);
    this.shouldClear = false;

    try {
      const writable = this.options.blobStore !== undefined
        ? await Promise.all(
            batch.map((record) => this.options.blobStore!.offload(record)),
          )
        : batch;

      const content = writable.map((e) => JSON.stringify(e) + '\n').join('');
      const directory = dirname(this.filePath);
      await mkdir(directory, { recursive: true });

      const fh = await open(this.filePath, shouldClear ? 'w' : 'a');
      try {
        if (content.length > 0) {
          await fh.writeFile(content, 'utf8');
        }
        await fh.sync();
      } finally {
        await fh.close();
      }

      if (!this.directorySynced) {
        await syncDir(directory);
        this.directorySynced = true;
      }
    } catch (error) {
      // Re-queue the un-drained batch so a transient failure does not lose
      // records. `shouldClear` (a rewrite) is also restored so a failed
      // rewrite retries as a clear-then-write rather than appending.
      this.pendingRecords.unshift(...batch);
      if (shouldClear) this.shouldClear = true;
      throw error;
    }
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
