/**
 * File provenance — per-session record of which agent/model/turn mutated
 * which files, with 1-based line ranges measured against the post-mutation
 * content.
 *
 * This is the harness-native equivalent of AI-code attribution tools like
 * git-ai: every Write/Edit/ApplyPatch mutation funnels through the file
 * tools, so the session can leave a durable, machine-readable trail that
 * later development tracking (blame annotation, RepoQuery provenance, tests)
 * can join against. Design rules:
 *
 * - Storage is one append-only NDJSON file per session
 *   (`<sessionDir>/provenance.ndjson`), written through the local filesystem
 *   — provenance describes the session, not the (possibly remote) workspace.
 * - No file content is ever recorded: paths, ranges, counts, and a SHA-256
 *   of the post-mutation content so consumers can detect line drift.
 * - Sensitive paths (isSensitiveFile) are skipped entirely, mirroring the
 *   rewind snapshot policy.
 * - Recording never throws and never blocks the tool path beyond one
 *   serialized append; it is disabled without a sink and via
 *   SUPERLIORA_FILE_PROVENANCE=0.
 *
 * Agent-standalone: this module is session infrastructure — the recorder is
 * handed to agents like FileSnapshotStore, never hung on the Agent instance
 * as graph state by default.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';

import { isSensitiveFile } from '../tools/policies/sensitive';
import { diffAddedLineRanges, type LineDiffSummary, type LineRange } from '../tools/support/line-diff';

/** Set to `0` to disable provenance recording for the process. */
export const FILE_PROVENANCE_ENV = 'SUPERLIORA_FILE_PROVENANCE';

/** Mutation descriptor the file tools hand to the recorder. */
export interface FileProvenanceMutation {
  /** Absolute path as the tool wrote it (kaos-resolved). */
  readonly path: string;
  /** Builtin tool name (`Write`, `Edit`, `ApplyPatch`). */
  readonly tool: string;
  readonly op: FileProvenanceOp;
  /** Content before the mutation; null when the file did not exist or is deleted. */
  readonly before: string | null;
  /** Content after the mutation; null for deletes. */
  readonly after: string | null;
  /**
   * Content to hash into `contentHash` (defaults to `after`). Tools that
   * diff against a normalized view but write different on-disk bytes
   * (CRLF materialization) pass the written bytes here so consumers can
   * match the record against the file as it exists on disk.
   */
  readonly hashSource?: string | null;
}

export type FileProvenanceOp = 'create' | 'overwrite' | 'append' | 'edit' | 'patch' | 'delete';

export interface ProvenanceMutationContext {
  readonly agentType: string;
  readonly model?: string | undefined;
  readonly turn?: string | undefined;
}

/** One NDJSON line (schema `v: 1`). */
export interface FileProvenanceRecord {
  readonly v: 1;
  /** Epoch ms of the successful mutation. */
  readonly ts: number;
  readonly agentType: string;
  readonly model?: string;
  readonly turn?: string;
  readonly tool: string;
  readonly op: FileProvenanceOp;
  readonly path: string;
  /** 1-based inclusive ranges of added lines in the post-mutation content. */
  readonly added: readonly LineRange[];
  readonly addedLines: number;
  readonly removedLines: number;
  /** SHA-256 hex of the post-mutation content; omitted for deletes. */
  readonly contentHash?: string;
}

const SCHEMA_VERSION = 1;
const META_KIND = 'superliora-file-provenance';

interface MetaLine {
  readonly kind: typeof META_KIND;
  readonly v: number;
  readonly cwd?: string;
}

export interface FileProvenanceRecorderOptions {
  /** NDJSON sink path; undefined (or env `SUPERLIORA_FILE_PROVENANCE=0`) disables recording. */
  readonly filePath?: string | undefined;
  /** Working directory noted in the file header for later workspace joins. */
  readonly cwd?: string | undefined;
}

export class FileProvenanceRecorder {
  private readonly filePath: string | undefined;
  private readonly cwd: string | undefined;
  /** Serializes appends so per-file ordering survives parallel tool calls. */
  private tail: Promise<void> = Promise.resolve();

  constructor(options: FileProvenanceRecorderOptions = {}) {
    this.filePath =
      process.env[FILE_PROVENANCE_ENV] === '0' ? undefined : options.filePath;
    this.cwd = options.cwd;
  }

  /** Recording is a no-op when no sink was configured or it is disabled. */
  get enabled(): boolean {
    return this.filePath !== undefined;
  }

  static provenancePathForSession(sessionDir: string): string {
    return join(sessionDir, 'provenance.ndjson');
  }

  /**
   * Record a successful mutation. Never throws: diff/IO failures are
   * swallowed (provenance must not break a tool that already succeeded).
   */
  async record(mutation: FileProvenanceMutation, ctx: ProvenanceMutationContext): Promise<void> {
    if (this.filePath === undefined) return;
    if (isSensitiveFile(mutation.path)) return;

    let summary: LineDiffSummary;
    try {
      summary = diffAddedLineRanges(mutation.before, mutation.after);
    } catch {
      return;
    }
    const isDelete = mutation.op === 'delete';
    if (!isDelete && summary.addedLines === 0 && summary.removedLines === 0) return;

    const hashSource = mutation.hashSource !== undefined ? mutation.hashSource : mutation.after;
    const record: FileProvenanceRecord = {
      v: SCHEMA_VERSION,
      ts: Date.now(),
      agentType: ctx.agentType,
      ...(ctx.model === undefined ? {} : { model: ctx.model }),
      ...(ctx.turn === undefined ? {} : { turn: ctx.turn }),
      tool: mutation.tool,
      op: mutation.op,
      path: mutation.path,
      added: summary.added,
      addedLines: summary.addedLines,
      removedLines: summary.removedLines,
      ...(hashSource === null ? {} : { contentHash: hashContent(hashSource) }),
    };

    const filePath = this.filePath;
    const cwd = this.cwd;
    // Chain onto the previous append; a failure must not lose later records.
    this.tail = this.tail
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        const lines: string[] = [];
        if (!(await hasProvenanceHeader(filePath))) {
          const meta: MetaLine = { kind: META_KIND, v: SCHEMA_VERSION, ...(cwd === undefined ? {} : { cwd }) };
          lines.push(JSON.stringify(meta));
        }
        lines.push(JSON.stringify(record));
        await appendFile(filePath, `${lines.join('\n')}\n`, 'utf8');
      })
      .catch(() => {});
    await this.tail;
  }

  /**
   * Parse all records from the sink (tolerating corrupt or foreign lines).
   * Missing file yields an empty list; safe to call from consumers.
   */
  async read(): Promise<readonly FileProvenanceRecord[]> {
    return readProvenanceFile(this.filePath);
  }
}

/** Read records from any provenance NDJSON path (missing/corrupt → []). */
export async function readProvenanceFile(
  filePath: string | undefined,
): Promise<readonly FileProvenanceRecord[]> {
  if (filePath === undefined) return [];
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const records: FileProvenanceRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isProvenanceRecord(parsed)) records.push(parsed);
    } catch {
      // Skip torn/corrupt lines; a provenance log is advisory.
    }
  }
  return records;
}

async function hasProvenanceHeader(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.startsWith(`{"kind":"${META_KIND}"`);
  } catch {
    return false;
  }
}

function isProvenanceRecord(value: unknown): value is FileProvenanceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['v'] === SCHEMA_VERSION &&
    record['kind'] === undefined &&
    typeof record['ts'] === 'number' &&
    typeof record['path'] === 'string' &&
    typeof record['tool'] === 'string' &&
    typeof record['op'] === 'string' &&
    Array.isArray(record['added'])
  );
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Per-agent hook the file tools receive. Binds agent type/model/turn at
 * record time (they change across turns and `/model` switches). Tools await
 * `record` before reporting success — the promise never rejects, so a
 * provenance failure can never fail a tool, and awaiting keeps records
 * durable across process exit. The agent-layer factory that binds an
 * `Agent` lives in `agent/tool/builtin-tools.ts` (session must not import
 * the agent layer).
 */
export interface FileProvenanceHook {
  readonly record: (mutation: FileProvenanceMutation) => void | Promise<void>;
}
