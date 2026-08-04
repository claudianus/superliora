/**
 * Turn-scoped file snapshots for `/rewind` (conversation + disk restore).
 *
 * Layer 2 of the rewind stack (transcript is layer 1; hunk accept/reject is later).
 * Snapshots only files the agent is about to write/edit. Sensitive paths are
 * skipped by default (isSensitiveFile) so secrets are not persisted in the
 * session snapshot store.
 *
 * Agent-standalone: this module is session/workspace infrastructure — do not
 * hang snapshot graph state on the Agent instance.
 */

import type { Kaos } from '@superliora/kaos';
import { dirname, join } from 'pathe';

import { isSensitiveFile } from '../tools/policies/sensitive';

export interface FileSnapshotEntry {
  readonly path: string;
  /** UTF-8 content before the mutation, or null if the file did not exist. */
  readonly content: string | null;
  readonly existed: boolean;
  readonly skippedSensitive: boolean;
}

export interface TurnFileSnapshot {
  readonly turnId: string;
  readonly createdAt: number;
  readonly entries: readonly FileSnapshotEntry[];
}

export interface FileSnapshotStoreOptions {
  readonly kaos: Kaos;
  /** Absolute directory under the session dir for snapshot blobs (optional). */
  readonly snapshotDir?: string | undefined;
  /** When true (default), skip isSensitiveFile paths entirely. */
  readonly skipSensitive?: boolean | undefined;
}

/**
 * Retention caps for the in-memory index. Long agent sessions commit a
 * snapshot every turn; without eviction the before-write file contents grow
 * the heap linearly. Oldest turns are evicted first — `/rewind` to an
 * evicted turn is a no-op (same as an unknown turn id), which trades the
 * rare very-deep rewind for bounded memory.
 */
export const MAX_SNAPSHOT_RETAINED_TURNS = 96;
export const MAX_SNAPSHOT_RETAINED_BYTES = 32 * 1024 * 1024;

/**
 * In-memory turn snapshot index with optional disk mirror under snapshotDir.
 */
export class FileSnapshotStore {
  private readonly kaos: Kaos;
  private readonly snapshotDir: string | undefined;
  private readonly skipSensitive: boolean;
  private readonly turns = new Map<string, TurnFileSnapshot>();
  /** First-write-wins per path within a turn. */
  private readonly pending = new Map<string, Map<string, FileSnapshotEntry>>();
  /** Approximate retained content size across committed snapshots. */
  private retainedBytes = 0;

  constructor(options: FileSnapshotStoreOptions) {
    this.kaos = options.kaos;
    this.snapshotDir = options.snapshotDir;
    this.skipSensitive = options.skipSensitive ?? true;
  }

  /**
   * Capture before-state for a path the agent is about to mutate.
   * Safe to call multiple times for the same path in a turn — first wins.
   */
  async captureBeforeWrite(turnId: string, absolutePath: string): Promise<FileSnapshotEntry> {
    let bucket = this.pending.get(turnId);
    if (bucket === undefined) {
      bucket = new Map();
      this.pending.set(turnId, bucket);
    }
    const existing = bucket.get(absolutePath);
    if (existing !== undefined) return existing;

    if (this.skipSensitive && isSensitiveFile(absolutePath)) {
      const entry: FileSnapshotEntry = {
        path: absolutePath,
        content: null,
        existed: false,
        skippedSensitive: true,
      };
      bucket.set(absolutePath, entry);
      return entry;
    }

    let content: string | null = null;
    let existed = false;
    try {
      content = await this.kaos.readText(absolutePath);
      existed = true;
    } catch {
      content = null;
      existed = false;
    }

    const entry: FileSnapshotEntry = {
      path: absolutePath,
      content,
      existed,
      skippedSensitive: false,
    };
    bucket.set(absolutePath, entry);
    return entry;
  }

  /** Seal the pending captures for a turn into an immutable snapshot. */
  commitTurn(turnId: string, createdAt = Date.now()): TurnFileSnapshot {
    const bucket = this.pending.get(turnId) ?? new Map();
    this.pending.delete(turnId);
    const snapshot: TurnFileSnapshot = {
      turnId,
      createdAt,
      entries: Array.from(bucket.values()),
    };
    const existing = this.turns.get(turnId);
    if (existing !== undefined) this.dropTurn(existing);
    this.turns.set(turnId, snapshot);
    this.retainedBytes += snapshotBytes(snapshot);
    this.evictExcess();
    return snapshot;
  }

  getTurn(turnId: string): TurnFileSnapshot | undefined {
    return this.turns.get(turnId);
  }

  listTurns(): readonly TurnFileSnapshot[] {
    return Array.from(this.turns.values()).toSorted((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Restore files from a sealed turn snapshot.
   * Sensitive-skipped entries are reported but not written.
   */
  async restoreTurn(turnId: string): Promise<{
    readonly restored: readonly string[];
    readonly deleted: readonly string[];
    readonly skippedSensitive: readonly string[];
    readonly errors: readonly { path: string; message: string }[];
  }> {
    const snapshot = this.turns.get(turnId);
    if (snapshot === undefined) {
      return { restored: [], deleted: [], skippedSensitive: [], errors: [] };
    }

    const restored: string[] = [];
    const deleted: string[] = [];
    const skippedSensitive: string[] = [];
    const errors: { path: string; message: string }[] = [];

    for (const entry of snapshot.entries) {
      if (entry.skippedSensitive) {
        skippedSensitive.push(entry.path);
        continue;
      }
      try {
        if (!entry.existed || entry.content === null) {
          try {
            await this.kaos.unlink(entry.path);
            deleted.push(entry.path);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') {
              errors.push({
                path: entry.path,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
          continue;
        }
        const parent = dirname(entry.path);
        try {
          await this.kaos.mkdir(parent, { parents: true, existOk: true });
        } catch {
          /* write may still succeed */
        }
        await this.kaos.writeAtomic(entry.path, entry.content);
        restored.push(entry.path);
      } catch (error) {
        errors.push({
          path: entry.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { restored, deleted, skippedSensitive, errors };
  }

  /** Drop turns at and after `turnId` (inclusive) from the index after rewind. */
  discardFrom(turnId: string): void {
    const ordered = this.listTurns();
    let drop = false;
    for (const snap of ordered) {
      if (snap.turnId === turnId) drop = true;
      if (drop) {
        this.dropTurn(snap);
      }
    }
  }

  /** Release the oldest committed snapshots until both retention caps hold. */
  private evictExcess(): void {
    while (
      this.turns.size > MAX_SNAPSHOT_RETAINED_TURNS ||
      this.retainedBytes > MAX_SNAPSHOT_RETAINED_BYTES
    ) {
      // Map iterates in insertion order: first key is the oldest commit.
      const oldest = this.turns.keys().next().value;
      if (oldest === undefined) break;
      const snapshot = this.turns.get(oldest);
      if (snapshot === undefined) {
        this.turns.delete(oldest);
        continue;
      }
      this.dropTurn(snapshot);
    }
  }

  private dropTurn(snapshot: TurnFileSnapshot): void {
    if (this.turns.delete(snapshot.turnId)) {
      this.retainedBytes = Math.max(0, this.retainedBytes - snapshotBytes(snapshot));
    }
    this.pending.delete(snapshot.turnId);
  }

  /** Optional path helper for session-relative snapshot dirs. */
  static snapshotDirForSession(sessionDir: string): string {
    return join(sessionDir, 'file-snapshots');
  }
}

/** Approximate heap cost of a snapshot's before-write contents. */
function snapshotBytes(snapshot: TurnFileSnapshot): number {
  let bytes = 0;
  for (const entry of snapshot.entries) {
    if (entry.content !== null) bytes += entry.content.length;
  }
  return bytes;
}
