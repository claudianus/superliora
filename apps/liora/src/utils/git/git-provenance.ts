/**
 * Join session file-provenance records onto `git blame` rows for the
 * `/blame` viewer.
 *
 * The provenance NDJSON (one per session dir, written by agent-core's
 * Write/Edit/ApplyPatch hooks) stores the SHA-256 of each file's
 * post-mutation content. Annotations are only applied when the file on disk
 * still hashes to a recorded state — recorded line numbers are measured
 * against that state, so a file edited since stays unannotated instead of
 * showing wrong attributions. This covers the current session's trail;
 * cross-session history and commit-anchored attribution are future work.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'pathe';

/** Per-line AI attribution marker for the blame panel. */
export interface ProvenanceAnnotation {
  readonly model?: string;
  readonly agentType: string;
  readonly ts: number;
}

/** Structural subset of the agent-core provenance record. */
export interface ProvenanceRecordLike {
  readonly path: string;
  readonly op: string;
  readonly ts: number;
  readonly agentType: string;
  readonly model?: string;
  readonly added: readonly { readonly start: number; readonly end: number }[];
  readonly contentHash?: string;
}

export interface LoadProvenanceAnnotationsOptions {
  /** Current session dir (holds `provenance.ndjson`). */
  readonly sessionDir: string;
  /** Blame target as given (workspace-relative or absolute). */
  readonly target: string;
  readonly workDir: string;
  /** Injected for tests; defaults to a UTF-8 fs read. */
  readonly readTextFile?: (path: string) => Promise<string>;
}

/**
 * Load per-line provenance annotations for a blame target. Missing file,
 * missing log, or hash drift (file changed after the last recorded edit)
 * all resolve to an empty map — annotation is best-effort by design.
 */
export async function loadProvenanceAnnotations(
  options: LoadProvenanceAnnotationsOptions,
): Promise<ReadonlyMap<number, ProvenanceAnnotation>> {
  const readTextFile = options.readTextFile ?? (async (path) => readFile(path, 'utf8'));
  const absoluteTarget = resolve(options.workDir, options.target);

  let currentContent: string;
  try {
    currentContent = await readTextFile(absoluteTarget);
  } catch {
    return new Map();
  }
  const currentHash = createHash('sha256').update(currentContent, 'utf8').digest('hex');

  const records = await readProvenanceRecords(
    join(options.sessionDir, 'provenance.ndjson'),
    readTextFile,
  );
  const matching = records.filter(
    (record) =>
      record.contentHash === currentHash &&
      record.added.length > 0 &&
      provenancePathMatches(record.path, absoluteTarget, options.target),
  );

  // Newest record wins per line; iterate oldest → newest so later
  // mutations overwrite earlier ones.
  const perLine = new Map<number, ProvenanceAnnotation>();
  for (const record of matching.toSorted((a, b) => a.ts - b.ts)) {
    for (const range of record.added) {
      for (let line = Math.max(1, range.start); line <= range.end; line++) {
        perLine.set(line, {
          model: record.model,
          agentType: record.agentType,
          ts: record.ts,
        });
      }
    }
  }
  return perLine;
}

async function readProvenanceRecords(
  logPath: string,
  readTextFile: (path: string) => Promise<string>,
): Promise<readonly ProvenanceRecordLike[]> {
  let raw: string;
  try {
    raw = await readTextFile(logPath);
  } catch {
    return [];
  }
  const records: ProvenanceRecordLike[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isProvenanceRecord(parsed)) records.push(parsed);
    } catch {
      // Skip torn or foreign (meta) lines; the log is advisory.
    }
  }
  return records;
}

function isProvenanceRecord(value: unknown): value is ProvenanceRecordLike {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['v'] === 1 &&
    record['kind'] === undefined &&
    typeof record['ts'] === 'number' &&
    typeof record['path'] === 'string' &&
    typeof record['op'] === 'string' &&
    typeof record['agentType'] === 'string' &&
    Array.isArray(record['added'])
  );
}

/** Separator-insensitive match: exact, or the record path ends with the target. */
function provenancePathMatches(recordPath: string, absoluteTarget: string, rawTarget: string): boolean {
  const normalize = (value: string): string => value.replaceAll('\\', '/');
  const record = normalize(recordPath);
  const absolute = normalize(absoluteTarget);
  if (record === absolute) return true;
  const raw = normalize(rawTarget);
  return record.endsWith(`/${raw}`);
}
