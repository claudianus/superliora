/**
 * SQLite/filesystem persistence engine for Liora Recall — extracted from
 * `store.ts`.
 *
 * Owns the on-disk database handle (with corruption recovery), schema
 * migration, the `records/` markdown mirror, and all raw SQL execution.
 * `store.ts` composes this with the pure query helpers in
 * `store-query.ts` for the public `LioraRecallStore` API; nothing here
 * validates domain rules beyond what is needed to read/write rows.
 *
 * Markdown mirror I/O lives in `store-persistence-markdown.ts`; SQLite
 * helpers and row mapping live in `store-persistence-sqlite.ts`.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'pathe';

import {
  memoryRecordFileStem,
  readMarkdownRecord,
  renderMarkdownRecord,
} from './store-persistence-markdown';
import {
  corruptionErrorMessage,
  isCountRow,
  isDatabaseCorruptionError,
  isMemoryRow,
  openDatabase,
  rowToMemory,
  type MemoryRow,
  type SqliteDatabase,
} from './store-persistence-sqlite';
import {
  buildSearchFilter,
  escapeLike,
  limit,
  MAX_LIMIT,
  toFtsQuery,
} from './store-query';
import type {
  MemoryRecord,
  MemorySearchRequest,
  MemorySourceRef,
} from './types';

export const SCHEMA_VERSION = 1;
export const STORE_RELATIVE_PATH = 'memory/kimi-recall.sqlite';
const RECORDS_DIR_NAME = 'records';

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
    const stamp = new Date(this.now()).toISOString().replaceAll(/[:.]/gu, '-');
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
