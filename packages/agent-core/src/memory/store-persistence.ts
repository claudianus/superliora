/**
 * SQLite/filesystem persistence engine for Liora Recall — extracted from
 * `store.ts`.
 *
 * Owns the on-disk database handle (with corruption recovery), schema
 * migration, the `records/` markdown mirror, and all raw SQL execution.
 * `store.ts` composes this with the pure query helpers in
 * `store-query.ts` for the public `LioraRecallStore` API; nothing here
 * validates domain rules beyond what is needed to read/write rows.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'pathe';

import {
  buildSearchFilter,
  clamp01,
  escapeLike,
  isMemoryRecordLike,
  isMemorySourceRefLike,
  limit,
  MAX_LIMIT,
  normalizeTags,
  parseMemoryKind,
  parseMemoryScope,
  parseMemoryStatus,
  sanitizeMetadata,
  stripUndefined,
  toFtsQuery,
} from './store-query';
import type {
  MemoryRecord,
  MemorySearchRequest,
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

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

interface MemoryRow {
  readonly id: string;
  readonly kind: string;
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
  readonly accessed_at: number | null;
  readonly access_count: number;
  readonly valid_from: number | null;
  readonly valid_to: number | null;
  readonly supersedes_json: string;
  readonly superseded_by: string | null;
  readonly metadata_json: string;
  readonly rank?: number | null;
}

export const SCHEMA_VERSION = 1;
export const STORE_RELATIVE_PATH = 'memory/kimi-recall.sqlite';
const RECORDS_DIR_NAME = 'records';
const MARKDOWN_RECORD_SCHEMA_VERSION = 1;
const MARKDOWN_RECORD_MARKER = 'kimi-recall-record-json-base64';
const SYSTEM_MEMORY_SOURCE: MemorySourceRef = { kind: 'system' };

export interface MemoryIntegrityIssues {
  readonly issues: string[];
  readonly missingIds: readonly string[];
}

export class MemoryPersistence {
  readonly dbPath: string;
  private readonly recordsDir: string;
  private readonly now: () => number;
  private readonly db: SqliteDatabase;
  private ftsEnabled = false;

  constructor(dbPath: string, now: () => number) {
    this.dbPath = dbPath;
    this.now = now;
    mkdirSync(dirname(this.dbPath), { recursive: true, mode: 0o700 });
    this.recordsDir = join(dirname(this.dbPath), RECORDS_DIR_NAME);
    this.db = this.openDatabaseWithRecovery();
    this.migrate();
    this.restoreMarkdownRecords();
    this.verifyMirrorCountOnOpen();
  }

  /**
   * Open the database, healing on-disk corruption instead of failing forever.
   *
   * A damaged image (torn write, crashed WAL flush, failing disk) used to make
   * every Liora Recall call throw "database disk image is malformed" until the
   * user hand-deleted the file. The store now probes the file before trusting
   * it: if opening throws a corruption-class error, or `PRAGMA quick_check`
   * reports bad pages, the file (plus WAL/SHM sidecars) is renamed to
   * `<name>.corrupt-<timestamp>` for forensics and a fresh database is opened.
   * `restoreMarkdownRecords()` then repopulates it from the `records/`
   * markdown mirror, so memories survive the quarantine.
   */
  private openDatabaseWithRecovery(): SqliteDatabase {
    try {
      const db = openDatabase(this.dbPath);
      const problem = this.probeDatabaseHealth(db);
      if (problem === undefined) return db;
      this.quarantineCorruptDatabase(db, problem);
    } catch (error) {
      if (!isDatabaseCorruptionError(error)) throw error;
      this.quarantineCorruptDatabase(undefined, corruptionErrorMessage(error));
    }
    return openDatabase(this.dbPath);
  }

  /** Returns a human-readable problem string when the file is unhealthy. */
  private probeDatabaseHealth(db: SqliteDatabase): string | undefined {
    let rows: unknown[];
    try {
      rows = db.prepare('PRAGMA quick_check').all();
    } catch (error) {
      if (isDatabaseCorruptionError(error)) return corruptionErrorMessage(error);
      throw error;
    }
    const first = rows[0] as { quick_check?: unknown } | undefined;
    if (rows.length === 1 && first?.quick_check === 'ok') return undefined;
    const detail = typeof first?.quick_check === 'string' ? first.quick_check : 'check failed';
    return `quick_check: ${detail}`;
  }

  private quarantineCorruptDatabase(db: SqliteDatabase | undefined, reason: string): void {
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // Best effort — a corrupt handle may refuse to close cleanly.
      }
    }
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/gu, '-');
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${this.dbPath}${suffix}`;
      if (!existsSync(source)) continue;
      try {
        renameSync(source, `${source}.corrupt-${stamp}`);
      } catch {
        // Leave it in place; the next open attempt surfaces it again.
      }
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[liora-recall] memory database at ${this.dbPath} was corrupt (${reason}); ` +
        `moved it aside as *.corrupt-${stamp} and rebuilding from the records/ mirror`,
    );
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_key TEXT,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        importance REAL NOT NULL,
        status TEXT NOT NULL,
        source_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        valid_from INTEGER,
        valid_to INTEGER,
        supersedes_json TEXT NOT NULL DEFAULT '[]',
        superseded_by TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_key);
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        action TEXT NOT NULL,
        source_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          id UNINDEXED,
          subject,
          content,
          tags,
          tokenize = 'unicode61'
        );
      `);
      this.ftsEnabled = true;
    } catch {
      this.ftsEnabled = false;
    }
  }

  getRecord(id: string): MemoryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (!isMemoryRow(row)) return undefined;
    return rowToMemory(row);
  }

  hasRecord(id: string): boolean {
    const row = this.db.prepare('SELECT id FROM memories WHERE id = ? LIMIT 1').get(id);
    return typeof row === 'object' && row !== null;
  }

  upsertRecord(record: MemoryRecord): void {
    const tagsJson = JSON.stringify(record.tags);
    this.db
      .prepare(`
        INSERT INTO memories (
          id, kind, scope, scope_key, subject, content, tags_json, confidence, importance,
          status, source_json, created_at, updated_at, accessed_at, access_count,
          valid_from, valid_to, supersedes_json, superseded_by, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          scope = excluded.scope,
          scope_key = excluded.scope_key,
          subject = excluded.subject,
          content = excluded.content,
          tags_json = excluded.tags_json,
          confidence = excluded.confidence,
          importance = excluded.importance,
          status = excluded.status,
          source_json = excluded.source_json,
          updated_at = excluded.updated_at,
          accessed_at = excluded.accessed_at,
          access_count = excluded.access_count,
          valid_from = excluded.valid_from,
          valid_to = excluded.valid_to,
          supersedes_json = excluded.supersedes_json,
          superseded_by = excluded.superseded_by,
          metadata_json = excluded.metadata_json
      `)
      .run(
        record.id,
        record.kind,
        record.scope,
        record.scopeKey ?? null,
        record.subject,
        record.content,
        tagsJson,
        record.confidence,
        record.importance,
        record.status,
        JSON.stringify(record.source),
        record.createdAt,
        record.updatedAt,
        record.accessedAt ?? null,
        record.accessCount,
        record.validFrom ?? null,
        record.validTo ?? null,
        JSON.stringify(record.supersedes),
        record.supersededBy ?? null,
        JSON.stringify(record.metadata),
      );
    this.upsertFts(record);
  }

  private upsertFts(record: MemoryRecord): void {
    if (!this.ftsEnabled) return;
    this.deleteFts(record.id);
    this.db
      .prepare('INSERT INTO memories_fts (id, subject, content, tags) VALUES (?, ?, ?, ?)')
      .run(record.id, record.subject, record.content, record.tags.join(' '));
  }

  private deleteFts(id: string): void {
    if (!this.ftsEnabled) return;
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
  }

  listRecords(
    clauses: readonly string[],
    params: readonly unknown[],
    limitValue: number,
    offset: number,
  ): readonly MemoryRecord[] {
    const sql =
      'SELECT * FROM memories' +
      (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
      ' ORDER BY importance DESC, updated_at DESC LIMIT ? OFFSET ?';
    const rows = this.db.prepare(sql).all(...params, limitValue, offset).filter(isMemoryRow);
    return rows.map(rowToMemory);
  }

  searchRecords(
    query: string | undefined,
    request: MemorySearchRequest,
  ): readonly { readonly record: MemoryRecord; readonly rank: number | undefined }[] {
    const rows =
      query !== undefined && query.length > 0 ? this.searchWithText(query, request) : this.searchWithoutText(request);
    return rows.map(({ row, rank }) => ({ record: rowToMemory(row), rank }));
  }

  private searchWithText(
    query: string,
    request: MemorySearchRequest,
  ): readonly { readonly row: MemoryRow; readonly rank: number | undefined }[] {
    if (this.ftsEnabled) {
      const ftsQuery = toFtsQuery(query);
      if (ftsQuery !== undefined) {
        try {
          const { clauses, params } = buildSearchFilter(request);
          const rows = this.db
            .prepare(`
              SELECT m.*, bm25(memories_fts) AS rank
              FROM memories_fts
              JOIN memories m ON m.id = memories_fts.id
              WHERE memories_fts MATCH ?
                ${clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''}
              ORDER BY rank ASC, m.importance DESC, m.updated_at DESC
              LIMIT ?
            `)
            .all(ftsQuery, ...params, limit(request.limit, MAX_LIMIT))
            .filter(isMemoryRow);
          if (rows.length > 0) {
            return rows.map((row) => ({ row, rank: typeof row.rank === 'number' ? row.rank : undefined }));
          }
        } catch {
        }
      }
    }
    const { clauses, params } = buildSearchFilter(request);
    const like = `%${escapeLike(query)}%`;
    const rows = this.db
      .prepare(`
        SELECT * FROM memories
        WHERE (subject LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')
          ${clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `)
      .all(like, like, like, ...params, limit(request.limit, MAX_LIMIT))
      .filter(isMemoryRow);
    return rows.map((row) => ({ row, rank: undefined }));
  }

  private searchWithoutText(
    request: MemorySearchRequest,
  ): readonly { readonly row: MemoryRow; readonly rank: number | undefined }[] {
    const { clauses, params } = buildSearchFilter(request);
    const rows = this.db
      .prepare(`
        SELECT * FROM memories
        ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `)
      .all(...params, limit(request.limit, MAX_LIMIT))
      .filter(isMemoryRow);
    return rows.map((row) => ({ row, rank: undefined }));
  }

  statsRows(): readonly { readonly kind: string; readonly scope: string; readonly status: string; readonly count: number }[] {
    return this.db
      .prepare('SELECT kind, scope, status, COUNT(*) AS count FROM memories GROUP BY kind, scope, status')
      .all()
      .filter(isCountRow);
  }

  touch(ids: readonly string[]): void {
    const now = this.now();
    const statement = this.db.prepare(
      'UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
    );
    for (const id of ids) {
      statement.run(now, id);
    }
  }

  insertEvent(memoryId: string, action: string, source: MemorySourceRef): void {
    this.db
      .prepare('INSERT INTO memory_events (id, memory_id, action, source_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), memoryId, action, JSON.stringify(source), this.now());
  }

  restoreMarkdownRecords(): void {
    if (!existsSync(this.recordsDir)) return;
    for (const file of readdirSync(this.recordsDir)) {
      if (!file.endsWith('.md')) continue;
      const record = readMarkdownRecord(join(this.recordsDir, file));
      if (record === undefined) continue;
      if (this.hasRecord(record.id)) continue;
      this.upsertRecord(record);
    }
  }

  writeMarkdownRecord(record: MemoryRecord): void {
    mkdirSync(this.recordsDir, { recursive: true, mode: 0o700 });
    const target = join(this.recordsDir, `${memoryRecordFileStem(record.id)}.md`);
    const tmp = `${target}.tmp-${randomUUID()}`;
    try {
      writeFileSync(tmp, renderMarkdownRecord(record), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, target);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  /**
   * Cheap count-only cross-check run once at open time, after migrate and the
   * mirror restore. A mismatch never blocks startup: log a warning, retry the
   * mirror restore once, and carry on.
   */
  private verifyMirrorCountOnOpen(): void {
    try {
      const dbCount = this.countDatabaseRecords();
      const mirrorFileCount = this.countMirrorFiles();
      if (dbCount === mirrorFileCount) return;
      // eslint-disable-next-line no-console
      console.warn(
        `[liora-recall] memory database at ${this.dbPath} has ${dbCount} records but the ` +
          `records/ mirror has ${mirrorFileCount} markdown files; retrying mirror restore`,
      );
      this.restoreMarkdownRecords();
    } catch {
      // Integrity checks must never break open; checkIntegrity() surfaces details on demand.
    }
  }

  /**
   * Cross-check the database against the `records/` markdown mirror:
   * `PRAGMA quick_check`, row-count parity, and per-id presence. Never
   * throws. Callers decide whether/how to repair from `missingIds`.
   */
  checkIntegrity(): MemoryIntegrityIssues {
    const issues: string[] = [];
    issues.push(...this.runQuickCheck());

    const dbCount = this.countDatabaseRecords();
    const mirrorFileCount = this.countMirrorFiles();
    if (dbCount !== mirrorFileCount) {
      issues.push(
        `record count mismatch: database has ${dbCount} records but the records/ mirror has ${mirrorFileCount} markdown files`,
      );
    }

    const missingIds = this.collectMirrorRecordIds().filter((id) => !this.hasRecord(id));
    if (missingIds.length > 0) {
      issues.push(
        `missing database records: ${missingIds.length} mirror records absent from the database ` +
          `(e.g. ${missingIds.slice(0, 3).join(', ')})`,
      );
    }
    return { issues, missingIds };
  }

  /** `PRAGMA quick_check` as issue strings; never throws. */
  private runQuickCheck(): string[] {
    let rows: unknown[];
    try {
      rows = this.db.prepare('PRAGMA quick_check').all();
    } catch (error) {
      return [`sqlite quick_check error: ${corruptionErrorMessage(error)}`];
    }
    const first = rows[0] as { quick_check?: unknown } | undefined;
    if (rows.length === 1 && first?.quick_check === 'ok') return [];
    const detail = typeof first?.quick_check === 'string' ? first.quick_check : 'check failed';
    return [`sqlite quick_check failed: ${detail}`];
  }

  private countDatabaseRecords(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM memories').get() as
      | { readonly count?: unknown }
      | undefined;
    return typeof row?.count === 'number' ? row.count : 0;
  }

  private countMirrorFiles(): number {
    if (!existsSync(this.recordsDir)) return 0;
    return readdirSync(this.recordsDir).filter((file) => file.endsWith('.md')).length;
  }

  private collectMirrorRecordIds(): readonly string[] {
    if (!existsSync(this.recordsDir)) return [];
    const ids: string[] = [];
    for (const file of readdirSync(this.recordsDir)) {
      if (!file.endsWith('.md')) continue;
      const record = readMarkdownRecord(join(this.recordsDir, file));
      if (record !== undefined) ids.push(record.id);
    }
    return ids;
  }
}

// ---------------------------------------------------------------------------
// Markdown mirror
// ---------------------------------------------------------------------------

function readMarkdownRecord(path: string): MemoryRecord | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    const match = text.match(markdownRecordRegex());
    const encoded = match?.[1];
    if (encoded === undefined) return undefined;
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    return normalizeMarkdownRecord(JSON.parse(json) as unknown);
  } catch {
    return undefined;
  }
}

function renderMarkdownRecord(record: MemoryRecord): string {
  const encoded = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
  const lines = [
    '---',
    `schema_version: ${MARKDOWN_RECORD_SCHEMA_VERSION}`,
    `id: ${record.id}`,
    `kind: ${record.kind}`,
    `scope: ${record.scope}`,
    `status: ${record.status}`,
    '---',
    '',
    `# ${singleLine(record.subject)}`,
    '',
    `- id: ${record.id}`,
    `- kind: ${record.kind}`,
    `- scope: ${record.scope}${record.scopeKey === undefined ? '' : `:${record.scopeKey}`}`,
    `- status: ${record.status}`,
    `- confidence: ${record.confidence}`,
    `- importance: ${record.importance}`,
    `- tags: ${record.tags.join(', ') || '(none)'}`,
    '',
    '## Content',
    '',
    record.content,
    '',
    `<!-- ${MARKDOWN_RECORD_MARKER}:${encoded} -->`,
    '',
  ];
  return lines.join('\n');
}

function normalizeMarkdownRecord(value: unknown): MemoryRecord | undefined {
  if (!isMemoryRecordLike(value)) return undefined;
  return stripUndefined({
    id: value.id,
    kind: value.kind,
    scope: value.scope,
    scopeKey: typeof value.scopeKey === 'string' ? value.scopeKey : undefined,
    subject: value.subject,
    content: value.content,
    tags: normalizeTags(value.tags),
    confidence: clamp01(value.confidence),
    importance: clamp01(value.importance),
    status: value.status,
    source: isMemorySourceRefLike(value.source) ? value.source : SYSTEM_MEMORY_SOURCE,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    accessedAt: typeof value.accessedAt === 'number' ? value.accessedAt : undefined,
    accessCount: Number.isFinite(value.accessCount) ? value.accessCount : 0,
    validFrom: typeof value.validFrom === 'number' ? value.validFrom : undefined,
    validTo: typeof value.validTo === 'number' ? value.validTo : undefined,
    supersedes: Array.isArray(value.supersedes)
      ? value.supersedes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    supersededBy: typeof value.supersededBy === 'string' ? value.supersededBy : undefined,
    metadata: sanitizeMetadata(value.metadata ?? {}),
  });
}

function memoryRecordFileStem(id: string): string {
  return `memory_${Buffer.from(id, 'utf8').toString('base64url')}`;
}

function markdownRecordRegex(): RegExp {
  return new RegExp(`\\n<!-- ${MARKDOWN_RECORD_MARKER}:([A-Za-z0-9_-]+) -->\\n?$`);
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim() || '(untitled)';
}

// ---------------------------------------------------------------------------
// SQLite engine helpers
// ---------------------------------------------------------------------------

function openDatabase(path: string): SqliteDatabase {
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
function isDatabaseCorruptionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /database disk image is malformed/iu.test(error.message) ||
    /file is not a database/iu.test(error.message) ||
    /SQLITE_CORRUPT\b/iu.test(error.message) ||
    /SQLITE_NOTADB\b/iu.test(error.message)
  );
}

function corruptionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  const base = {
    id: row.id,
    kind: parseMemoryKind(row.kind),
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
    accessCount: row.access_count,
    supersedes: parseJsonArray(row.supersedes_json),
    metadata: parseJsonObject(row.metadata_json),
  };
  return stripUndefined({
    ...base,
    scopeKey: row.scope_key ?? undefined,
    accessedAt: row.accessed_at ?? undefined,
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
  });
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

function isMemoryRow(value: unknown): value is MemoryRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['kind'] === 'string' &&
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
    (typeof row['accessed_at'] === 'number' || row['accessed_at'] === null) &&
    typeof row['access_count'] === 'number' &&
    (typeof row['valid_from'] === 'number' || row['valid_from'] === null) &&
    (typeof row['valid_to'] === 'number' || row['valid_to'] === null) &&
    typeof row['supersedes_json'] === 'string' &&
    (typeof row['superseded_by'] === 'string' || row['superseded_by'] === null) &&
    typeof row['metadata_json'] === 'string'
  );
}

function isCountRow(value: unknown): value is { readonly kind: string; readonly scope: string; readonly status: string; readonly count: number } {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row['kind'] === 'string' && typeof row['scope'] === 'string' && typeof row['status'] === 'string' && typeof row['count'] === 'number';
}
