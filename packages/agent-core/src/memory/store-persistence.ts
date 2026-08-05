/**
 * SQLite/filesystem persistence engine for Liora Memory — extracted from
 * `store.ts`.
 *
 * Owns the on-disk database handle (with corruption recovery), schema
 * migration, the `records/` markdown mirror, and all raw SQL execution.
 * `store.ts` composes this with the pure query helpers in
 * `store-query.ts` for the public `LioraMemoryStore` API; nothing here
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
  readFileSync,
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
  MemoryAuditEvent,
  MemoryRecord,
  MemorySearchRequest,
  MemorySourceRef,
} from './types';

export const SCHEMA_VERSION = 2;
export const STORE_RELATIVE_PATH = 'memory/liora-memory.sqlite';
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
    this.migrateLegacyStorePath();
    this.db = this.openDatabaseWithRecovery();
    this.migrate();
    this.restoreMarkdownRecords();
    this.migrateLegacyEpisodes();
    this.verifyMirrorCountOnOpen();
  }

  /** Move the v1 filename once; SQLite remains the only durable authority. */
  private migrateLegacyStorePath(): void {
    if (existsSync(this.dbPath)) return;
    for (const legacyName of ['kimi-recall.sqlite', 'liora-recall.sqlite']) {
      const legacyPath = join(dirname(this.dbPath), legacyName);
      if (!existsSync(legacyPath)) continue;
      try {
        for (const suffix of ['', '-wal', '-shm']) {
          const source = `${legacyPath}${suffix}`;
          if (existsSync(source)) renameSync(source, `${this.dbPath}${suffix}`);
        }
      } catch {
        // Leave the legacy file in place so a later open can retry safely.
      }
      return;
    }
  }

  /**
   * Open the database, healing on-disk corruption instead of failing forever.
   *
   * A damaged image (torn write, crashed WAL flush, failing disk) used to make
   * every Liora Memory call throw "database disk image is malformed" until the
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
      `[liora-memory] memory database at ${this.dbPath} was corrupt (${reason}); ` +
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
        epistemic TEXT NOT NULL DEFAULT 'direct',
        recorded_at INTEGER NOT NULL DEFAULT 0,
        accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        valid_from INTEGER,
        valid_to INTEGER,
        invalid_at INTEGER,
        supersedes_json TEXT NOT NULL DEFAULT '[]',
        superseded_by TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        links_json TEXT NOT NULL DEFAULT '[]'
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
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        confidence REAL NOT NULL,
        valid_from INTEGER,
        valid_to INTEGER,
        source_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_links_memory ON memory_links(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_kind, target_id);
    `);
    this.addColumn('epistemic', "TEXT NOT NULL DEFAULT 'direct'");
    this.addColumn('recorded_at', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumn('invalid_at', 'INTEGER');
    this.addColumn('evidence_json', "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn('links_json', "TEXT NOT NULL DEFAULT '[]'");
    this.db.exec(`
      UPDATE memories
      SET kind = CASE kind
        WHEN 'semantic' THEN 'fact'
        WHEN 'episodic' THEN 'event'
        WHEN 'procedural' THEN 'procedure'
        WHEN 'prospective' THEN 'task'
        WHEN 'governance' THEN 'rule'
        ELSE kind
      END,
      recorded_at = CASE WHEN recorded_at = 0 THEN created_at ELSE recorded_at END,
      epistemic = CASE WHEN source_json LIKE '%"kind":"auto"%' THEN 'inferred' ELSE epistemic END;
      UPDATE memory_meta SET value = '${SCHEMA_VERSION}' WHERE key = 'schema_version';
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

  private addColumn(name: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
    } catch {
      // Existing databases already have the v2 column.
    }
  }

  /**
   * Import the abandoned JSON episode store once into canonical Memory.
   * The deterministic id makes reopening idempotent and leaves the source
   * files available for manual recovery.
   */
  private migrateLegacyEpisodes(): void {
    const episodesDir = join(dirname(this.dbPath), 'episodes');
    if (!existsSync(episodesDir)) return;
    for (const file of readdirSync(episodesDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(readFileSync(join(episodesDir, file), 'utf8')) as Record<string, unknown>;
        const id = typeof raw['id'] === 'string' ? `episode-${raw['id']}` : `episode-${file.slice(0, -5)}`;
        if (this.hasRecord(id)) continue;
        const createdAt =
          typeof raw['createdAt'] === 'string' && Number.isFinite(Date.parse(raw['createdAt']))
            ? Date.parse(raw['createdAt'])
            : this.now();
        const goal = typeof raw['goal'] === 'string' ? raw['goal'].trim() : 'Imported task episode';
        const outcome = typeof raw['outcome'] === 'string' ? raw['outcome'] : 'unknown';
        const workDir = typeof raw['workDir'] === 'string' ? raw['workDir'] : undefined;
        const insights = Array.isArray(raw['insights'])
          ? raw['insights'].filter((value): value is string => typeof value === 'string')
          : [];
        const steps = Array.isArray(raw['steps'])
          ? raw['steps']
              .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
              .map((step) => (typeof step['description'] === 'string' ? step['description'] : ''))
              .filter((value) => value.length > 0)
          : [];
        const tags = Array.isArray(raw['tags'])
          ? raw['tags'].filter((value): value is string => typeof value === 'string')
          : [];
        const record: MemoryRecord = {
          id,
          type: 'event',
          epistemic: 'summary',
          scope: workDir === undefined ? 'user' : 'workspace',
          scopeKey: workDir,
          subject: goal.slice(0, 96),
          content: [`Outcome: ${outcome}`, ...steps.map((step) => `Step: ${step}`), ...insights.map((item) => `Insight: ${item}`)].join('\n'),
          tags: [...new Set(['legacy-episode', ...tags])].slice(0, 16),
          confidence: 0.7,
          importance: 0.5,
          status: 'active',
          source: {
            kind: 'import',
            sessionId: typeof raw['session_id'] === 'string' ? raw['session_id'] : undefined,
            excerpt: 'legacy JSON episode migration',
          },
          createdAt,
          updatedAt: createdAt,
          recordedAt: createdAt,
          accessCount: 0,
          supersedes: [],
          evidenceRefs:
            typeof raw['session_id'] === 'string'
              ? [{ kind: 'run', id: raw['session_id'] }]
              : [],
          links: [],
          metadata: { migration: 'legacy-episodic-v1', sourceFile: file },
        };
        this.upsertRecord(record);
        this.writeMarkdownRecord(record);
        this.insertEvent(record.id, 'migrate-legacy-episode', record.source);
      } catch {
        // A malformed legacy episode must not block the canonical store.
      }
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
          status, source_json, created_at, updated_at, epistemic, recorded_at, accessed_at, access_count,
          valid_from, valid_to, invalid_at, supersedes_json, superseded_by, metadata_json, evidence_json, links_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          epistemic = excluded.epistemic,
          recorded_at = excluded.recorded_at,
          accessed_at = excluded.accessed_at,
          access_count = excluded.access_count,
          valid_from = excluded.valid_from,
          valid_to = excluded.valid_to,
          invalid_at = excluded.invalid_at,
          supersedes_json = excluded.supersedes_json,
          superseded_by = excluded.superseded_by,
          metadata_json = excluded.metadata_json,
          evidence_json = excluded.evidence_json,
          links_json = excluded.links_json
      `)
      .run(
        record.id,
        record.type,
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
        record.epistemic,
        record.recordedAt,
        record.accessedAt ?? null,
        record.accessCount,
        record.validFrom ?? null,
        record.validTo ?? null,
        record.invalidAt ?? null,
        JSON.stringify(record.supersedes),
        record.supersededBy ?? null,
        JSON.stringify(record.metadata),
        JSON.stringify(record.evidenceRefs),
        JSON.stringify(record.links),
      );
    this.upsertFts(record);
    this.replaceLinks(record);
  }

  private replaceLinks(record: MemoryRecord): void {
    this.db.prepare('DELETE FROM memory_links WHERE memory_id = ?').run(record.id);
    const statement = this.db.prepare(`
      INSERT INTO memory_links (
        id, memory_id, target_kind, target_id, relation, confidence,
        valid_from, valid_to, source_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const link of record.links) {
      statement.run(
        randomUUID(),
        record.id,
        link.targetKind,
        link.targetId,
        link.relation,
        link.confidence,
        link.validFrom ?? null,
        link.validTo ?? null,
        JSON.stringify(link.source ?? record.source),
        this.now(),
      );
    }
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

  expandMemoryLinks(
    seedIds: readonly string[],
    maxDepth = 2,
    maxNodes = 32,
    asOf?: number,
  ): readonly {
    readonly id: string;
    readonly path: readonly string[];
  }[] {
    const seen = new Set(seedIds);
    let frontier = seedIds.map((id) => ({ id, path: [id] }));
    const found: { id: string; path: readonly string[] }[] = [];
    for (let depth = 0; depth < maxDepth && frontier.length > 0 && found.length < maxNodes; depth += 1) {
      const placeholders = frontier.map(() => '?').join(', ');
      const temporalClause =
        asOf === undefined ? '' : ' AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)';
      const rows = this.db
        .prepare(
          `SELECT memory_id, target_id FROM memory_links
           WHERE memory_id IN (${placeholders}) AND target_kind = 'memory'${temporalClause}`,
        )
        .all(...frontier.map((entry) => entry.id), ...(asOf === undefined ? [] : [asOf, asOf]));
      const next: { id: string; path: string[] }[] = [];
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue;
        const value = row as Record<string, unknown>;
        const source = value['memory_id'];
        const target = value['target_id'];
        const parent = frontier.find((entry) => entry.id === source);
        if (typeof target !== 'string' || parent === undefined || seen.has(target)) continue;
        seen.add(target);
        const entry = { id: target, path: [...parent.path, target] };
        found.push(entry);
        next.push(entry);
        if (found.length >= maxNodes) break;
      }
      frontier = next;
    }
    return found;
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

  recentEvents(limitValue = 20): readonly MemoryAuditEvent[] {
    const rows = this.db
      .prepare(
        'SELECT id, memory_id, action, source_json, created_at FROM memory_events ORDER BY created_at DESC LIMIT ?',
      )
      .all(Math.max(1, Math.min(MAX_LIMIT, limitValue)));
    return rows.flatMap((row) => {
      if (typeof row !== 'object' || row === null) return [];
      const value = row as Record<string, unknown>;
      if (
        typeof value['id'] !== 'string' ||
        typeof value['memory_id'] !== 'string' ||
        typeof value['action'] !== 'string' ||
        typeof value['created_at'] !== 'number' ||
        typeof value['source_json'] !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: value['id'],
          memoryId: value['memory_id'],
          action: value['action'],
          source: parseEventSource(value['source_json']),
          createdAt: value['created_at'],
        },
      ];
    });
  }

  purgeRecord(id: string): boolean {
    this.db.prepare('DELETE FROM memory_links WHERE memory_id = ?').run(id);
    this.deleteFts(id);
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }

  restoreMarkdownRecords(): void {
    if (!existsSync(this.recordsDir)) return;
    for (const file of readdirSync(this.recordsDir)) {
      if (!file.endsWith('.md')) continue;
      const sourcePath = join(this.recordsDir, file);
      const record = readMarkdownRecord(sourcePath);
      if (record === undefined) continue;
      if (this.hasRecord(record.id)) continue;
      this.upsertRecord(record);
      this.writeMarkdownRecord(record);
      const canonicalPath = join(this.recordsDir, `${memoryRecordFileStem(record.id)}.md`);
      if (canonicalPath !== sourcePath) rmSync(sourcePath, { force: true });
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
        `[liora-memory] memory database at ${this.dbPath} has ${dbCount} records but the ` +
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

function parseEventSource(text: string): MemorySourceRef {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const kind = value['kind'];
    if (kind === 'user' || kind === 'tool' || kind === 'auto' || kind === 'import' || kind === 'system') {
      return {
        kind,
        ...(typeof value['sessionId'] === 'string' ? { sessionId: value['sessionId'] } : {}),
        ...(typeof value['agentId'] === 'string' ? { agentId: value['agentId'] } : {}),
        ...(typeof value['turnId'] === 'number' ? { turnId: value['turnId'] } : {}),
        ...(typeof value['messageId'] === 'string' ? { messageId: value['messageId'] } : {}),
        ...(typeof value['excerpt'] === 'string' ? { excerpt: value['excerpt'] } : {}),
      };
    }
  } catch {
    // Corrupt audit payloads should not make inspect unusable.
  }
  return { kind: 'system' };
}
