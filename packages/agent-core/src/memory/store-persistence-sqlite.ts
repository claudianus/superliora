/**
 * SQLite engine helpers for Liora Memory persistence — extracted from
 * `store-persistence.ts`.
 *
 * Owns the node:sqlite handle wrapper, corruption error classification,
 * and row-to-domain mapping. `store-persistence.ts` composes these with
 * the markdown mirror in `store-persistence-markdown.ts`.
 */

import { createRequire } from 'node:module';

import {
  parseMemoryType,
  parseMemoryScope,
  parseMemoryStatus,
  isMemoryEvidenceRefLike,
  isMemoryLinkLike,
  stripUndefined,
} from './store-query';
import type {
  MemoryEvidenceRef,
  MemoryLink,
  MemoryRecord,
  MemorySourceRef,
} from './types';

interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

export interface MemoryRow {
  readonly id: string;
  readonly kind: string;
  readonly epistemic: string;
  readonly scope: string;
  readonly scope_key: string | null;
  readonly subject: string;
  readonly content: string;
  readonly tags_json: string;
  readonly confidence: number;
  readonly importance: number;
  readonly status: string;
  readonly source_json: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly recorded_at: number;
  readonly accessed_at: number | null;
  readonly access_count: number;
  readonly valid_from: number | null;
  readonly valid_to: number | null;
  readonly invalid_at: number | null;
  readonly supersedes_json: string;
  readonly superseded_by: string | null;
  readonly metadata_json: string;
  readonly evidence_json: string;
  readonly links_json: string;
  readonly rank?: number | null;
}

export function openDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const sqlite = require('node:sqlite') as SqliteModule;
  return new sqlite.DatabaseSync(path);
}

/**
 * True for SQLite corruption-class failures (SQLITE_CORRUPT / SQLITE_NOTADB).
 * node:sqlite surfaces these as plain errors, so match on the message text.
 * Transient errors (busy, locked, permission) must NOT match — quarantining a
 * healthy database over them would discard recoverable data.
 */
export function isDatabaseCorruptionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /database disk image is malformed/iu.test(error.message) ||
    /file is not a database/iu.test(error.message) ||
    /SQLITE_CORRUPT\b/iu.test(error.message) ||
    /SQLITE_NOTADB\b/iu.test(error.message)
  );
}

export function corruptionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rowToMemory(row: MemoryRow): MemoryRecord {
  const base = {
    id: row.id,
    type: parseMemoryType(row.kind),
    epistemic: parseEpistemic(row.epistemic),
    scope: parseMemoryScope(row.scope),
    subject: row.subject,
    content: row.content,
    tags: parseJsonArray(row.tags_json),
    confidence: row.confidence,
    importance: row.importance,
    status: parseMemoryStatus(row.status),
    source: parseSourceRef(row.source_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordedAt: row.recorded_at,
    accessCount: row.access_count,
    supersedes: parseJsonArray(row.supersedes_json),
    evidenceRefs: parseJsonObjects<MemoryEvidenceRef>(row.evidence_json).filter(isMemoryEvidenceRefLike),
    links: parseJsonObjects<MemoryLink>(row.links_json).filter(isMemoryLinkLike),
    metadata: parseJsonObject(row.metadata_json),
  };
  return stripUndefined({
    ...base,
    scopeKey: row.scope_key ?? undefined,
    accessedAt: row.accessed_at ?? undefined,
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    invalidAt: row.invalid_at ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
  });
}

export function isMemoryRow(value: unknown): value is MemoryRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['kind'] === 'string' &&
    typeof row['epistemic'] === 'string' &&
    typeof row['scope'] === 'string' &&
    (typeof row['scope_key'] === 'string' || row['scope_key'] === null) &&
    typeof row['subject'] === 'string' &&
    typeof row['content'] === 'string' &&
    typeof row['tags_json'] === 'string' &&
    typeof row['confidence'] === 'number' &&
    typeof row['importance'] === 'number' &&
    typeof row['status'] === 'string' &&
    typeof row['source_json'] === 'string' &&
    typeof row['created_at'] === 'number' &&
    typeof row['updated_at'] === 'number' &&
    typeof row['recorded_at'] === 'number' &&
    (typeof row['accessed_at'] === 'number' || row['accessed_at'] === null) &&
    typeof row['access_count'] === 'number' &&
    (typeof row['valid_from'] === 'number' || row['valid_from'] === null) &&
    (typeof row['valid_to'] === 'number' || row['valid_to'] === null) &&
    (typeof row['invalid_at'] === 'number' || row['invalid_at'] === null) &&
    typeof row['supersedes_json'] === 'string' &&
    (typeof row['superseded_by'] === 'string' || row['superseded_by'] === null) &&
    typeof row['metadata_json'] === 'string' &&
    typeof row['evidence_json'] === 'string' &&
    typeof row['links_json'] === 'string'
  );
}

export function isCountRow(
  value: unknown,
): value is { readonly kind: string; readonly scope: string; readonly status: string; readonly count: number } {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['kind'] === 'string' &&
    typeof row['scope'] === 'string' &&
    typeof row['status'] === 'string' &&
    typeof row['count'] === 'number'
  );
}

function parseJsonArray(text: string): readonly string[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function parseJsonObjects<T>(text: string): readonly T[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is T => typeof entry === 'object' && entry !== null);
  } catch {
    return [];
  }
}

function parseEpistemic(value: string): MemoryRecord['epistemic'] {
  if (value === 'direct' || value === 'inferred' || value === 'preference' || value === 'summary') return value;
  return 'direct';
}

function parseJsonObject(text: string): Readonly<Record<string, unknown>> {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseSourceRef(text: string): MemorySourceRef {
  const value = parseJsonObject(text);
  const kind = value['kind'];
  if (kind === 'user' || kind === 'tool' || kind === 'auto' || kind === 'import' || kind === 'system') {
    const source: {
      kind: MemorySourceRef['kind'];
      sessionId?: string;
      agentId?: string;
      turnId?: number;
      messageId?: string;
      excerpt?: string;
    } = { kind };
    if (typeof value['sessionId'] === 'string') source.sessionId = value['sessionId'];
    if (typeof value['agentId'] === 'string') source.agentId = value['agentId'];
    if (typeof value['turnId'] === 'number') source.turnId = value['turnId'];
    if (typeof value['messageId'] === 'string') source.messageId = value['messageId'];
    if (typeof value['excerpt'] === 'string') source.excerpt = value['excerpt'];
    return source;
  }
  return { kind: 'system' };
}
