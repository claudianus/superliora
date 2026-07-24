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

import { renderMemoryInjection } from './render';
import { redactMemoryText, shouldSkipMemoryText } from './redact';
import type {
  AgentMemoryRuntime,
  LioraRecallConfig,
  MemoryConsolidateResult,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryKind,
  MemoryListRequest,
  MemoryRecord,
  MemoryRuntimeAgentContext,
  MemoryRuntimeSessionContext,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySourceRef,
  MemoryStats,
  MemoryStatus,
  MemoryTurnCaptureInput,
  MemoryUpdateInput,
  SessionMemoryRuntime,
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

interface ExplicitMemoryCandidate {
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly tags: readonly string[];
  readonly signal: string;
  readonly utility: number;
}

export interface LioraRecallStoreOptions {
  readonly homeDir: string;
  readonly config?: (() => LioraRecallConfig | undefined) | undefined;
  readonly now?: (() => number) | undefined;
}

const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_INJECTION_LIMIT = 6;
const DEFAULT_INJECTION_MIN_SCORE = 0.2;
const MAX_LIMIT = 100;
const STORE_RELATIVE_PATH = 'memory/kimi-recall.sqlite';
const RECORDS_DIR_NAME = 'records';
const MARKDOWN_RECORD_SCHEMA_VERSION = 1;
const MARKDOWN_RECORD_MARKER = 'kimi-recall-record-json-base64';
const SYSTEM_MEMORY_SOURCE: MemorySourceRef = { kind: 'system' };

const MEMORY_KINDS: readonly MemoryKind[] = [
  'semantic',
  'episodic',
  'procedural',
  'prospective',
  'governance',
];
const MEMORY_SCOPES: readonly MemoryScope[] = ['user', 'workspace', 'session'];
const MEMORY_STATUSES: readonly MemoryStatus[] = ['active', 'archived', 'superseded', 'deleted'];

export class LioraRecallStore {
  private readonly db: SqliteDatabase;
  private readonly dbPath: string;
  private readonly recordsDir: string;
  private readonly now: () => number;
  private readonly config: (() => LioraRecallConfig | undefined) | undefined;
  private ftsEnabled = false;

  constructor(options: LioraRecallStoreOptions) {
    this.now = options.now ?? Date.now;
    this.config = options.config;
    this.dbPath = options.config?.()?.storePath ?? join(options.homeDir, STORE_RELATIVE_PATH);
    mkdirSync(dirname(this.dbPath), { recursive: true, mode: 0o700 });
    this.recordsDir = join(dirname(this.dbPath), RECORDS_DIR_NAME);
    this.db = openDatabase(this.dbPath);
    this.migrate();
    this.restoreMarkdownRecords();
  }

  getStorePath(): string {
    return this.dbPath;
  }

  isEnabled(): boolean {
    return this.config?.()?.enabled !== false;
  }

  runtimeForSession(context: MemoryRuntimeSessionContext): SessionMemoryRuntime {
    return new LioraRecallSessionRuntime(this, context);
  }

  async remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    if (!this.isEnabled()) {
      throw new Error('Liora Recall is disabled by config.');
    }
    const subject = normalizeRequired(input.subject, 'Memory subject cannot be empty.');
    const redacted = redactMemoryText(normalizeRequired(input.content, 'Memory content cannot be empty.'));
    if (shouldSkipMemoryText(input.content)) {
      throw new Error('Memory content appears to contain multiple secrets and was not saved.');
    }
    const now = this.now();
    const record = this.normalizeCreateInput(input, subject, redacted.text, now);
    this.upsertRecord(record);
    this.writeMarkdownRecord(record);
    this.insertEvent(record.id, 'create', record.source);
    return record;
  }

  async update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord> {
    const existing = await this.get(id);
    if (existing === undefined) {
      throw new Error(`Memory "${id}" was not found.`);
    }
    const content = patch.content === undefined ? existing.content : redactMemoryText(patch.content).text;
    if (patch.content !== undefined && shouldSkipMemoryText(patch.content)) {
      throw new Error('Memory content appears to contain multiple secrets and was not saved.');
    }
    const now = this.now();
    const record = stripUndefined({
      ...existing,
      kind: patch.kind ?? existing.kind,
      scope: patch.scope ?? existing.scope,
      subject: patch.subject === undefined ? existing.subject : normalizeRequired(patch.subject, 'Memory subject cannot be empty.'),
      content,
      tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
      confidence: clamp01(patch.confidence ?? existing.confidence),
      importance: clamp01(patch.importance ?? existing.importance),
      status: patch.status ?? existing.status,
      updatedAt: now,
      supersedes: existing.supersedes,
      metadata: patch.metadata === undefined ? existing.metadata : sanitizeMetadata(patch.metadata),
      scopeKey: patch.scopeKey ?? existing.scopeKey,
      validFrom: patch.validFrom ?? existing.validFrom,
      validTo: patch.validTo ?? existing.validTo,
      supersededBy: patch.supersededBy ?? existing.supersededBy,
    });
    assertMemoryKind(record.kind);
    assertMemoryScope(record.scope);
    assertMemoryStatus(record.status);
    this.upsertRecord(record);
    this.writeMarkdownRecord(record);
    this.insertEvent(record.id, 'update', existing.source);
    return record;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (!isMemoryRow(row)) return undefined;
    return rowToMemory(row);
  }

  async forget(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (existing === undefined) return false;
    const now = this.now();
    const deletedRecord = {
      ...existing,
      status: 'deleted' as const,
      updatedAt: now,
    };
    this.upsertRecord(deletedRecord);
    this.writeMarkdownRecord(deletedRecord);
    this.insertEvent(id, 'forget', existing.source);
    return true;
  }

  async list(request: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (request.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(request.kind);
    }
    if (request.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(request.scope);
    }
    if (request.scopeKey !== undefined) {
      clauses.push('scope_key = ?');
      params.push(request.scopeKey);
    } else if (request.scope === undefined && (request.workspaceKey !== undefined || request.sessionId !== undefined)) {
      const scopeClauses = ['scope = ?'];
      params.push('user');
      if (request.workspaceKey !== undefined) {
        scopeClauses.push('(scope = ? AND scope_key = ?)');
        params.push('workspace', request.workspaceKey);
      }
      if (request.sessionId !== undefined) {
        scopeClauses.push('(scope = ? AND scope_key = ?)');
        params.push('session', request.sessionId);
      }
      clauses.push(`(${scopeClauses.join(' OR ')})`);
    }
    if (request.status !== undefined) {
      clauses.push('status = ?');
      params.push(request.status);
    }
    const sql =
      'SELECT * FROM memories' +
      (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
      ' ORDER BY importance DESC, updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit(request.limit), Math.max(0, request.offset ?? 0));
    const rows = this.db.prepare(sql).all(...params).filter(isMemoryRow);
    return rows.map(rowToMemory).filter((record) => hasAllTags(record, request.tags));
  }

  async search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    if (!this.isEnabled()) return [];
    const query = request.query?.trim();
    const records =
      query !== undefined && query.length > 0
        ? this.searchWithText(query, request)
        : this.searchWithoutText(request);
    const filtered = records
      .map((entry) => ({
        memory: rowToMemory(entry.row),
        ftsRank: entry.rank,
      }))
      .filter(({ memory }) => hasAllTags(memory, request.tags));
    const scored = filtered.map(({ memory, ftsRank }) => scoreMemory(memory, query, ftsRank, this.now()));
    const minScore =
      typeof request.minScore === 'number' && Number.isFinite(request.minScore) ? request.minScore : undefined;
    const ranked = scored.toSorted((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt);
    const sorted = (minScore === undefined ? ranked : ranked.filter((result) => result.score >= minScore)).slice(
      0,
      limit(request.limit),
    );
    if (sorted.length > 0) {
      this.touch(sorted.map((result) => result.memory.id));
    }
    return sorted;
  }

  async stats(): Promise<MemoryStats> {
    const rows = this.db.prepare('SELECT kind, scope, status, COUNT(*) AS count FROM memories GROUP BY kind, scope, status').all();
    const byKind = Object.fromEntries(MEMORY_KINDS.map((kind) => [kind, 0])) as Record<MemoryKind, number>;
    const byScope = Object.fromEntries(MEMORY_SCOPES.map((scope) => [scope, 0])) as Record<MemoryScope, number>;
    let total = 0;
    let active = 0;
    let archived = 0;
    let deleted = 0;
    for (const row of rows) {
      if (!isCountRow(row)) continue;
      total += row.count;
      if (row.status === 'active') active += row.count;
      if (row.status === 'archived') archived += row.count;
      if (row.status === 'deleted') deleted += row.count;
      if (isMemoryKind(row.kind)) byKind[row.kind] += row.count;
      if (isMemoryScope(row.scope)) byScope[row.scope] += row.count;
    }
    return { total, active, archived, deleted, byKind, byScope };
  }

  async exportRecords(request: MemoryListRequest = {}): Promise<MemoryExportResult> {
    return {
      exportedAt: this.now(),
      schemaVersion: SCHEMA_VERSION,
      records: await this.list({ ...request, limit: request.limit ?? MAX_LIMIT }),
    };
  }

  async importRecords(records: readonly MemoryRecord[]): Promise<MemoryImportResult> {
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    for (const record of records) {
      if (!isMemoryRecordLike(record)) {
        skipped += 1;
        continue;
      }
      const existing = await this.get(record.id);
      this.upsertRecord(record);
      this.writeMarkdownRecord(record);
      if (existing === undefined) imported += 1;
      else updated += 1;
      this.insertEvent(record.id, 'import', { kind: 'import' });
    }
    return { imported, skipped, updated };
  }

  async consolidate(): Promise<MemoryConsolidateResult> {
    const active = await this.list({ status: 'active', limit: MAX_LIMIT });
    const groups = new Map<string, MemoryRecord[]>();
    for (const memory of active) {
      const key = [
        memory.kind,
        memory.scope,
        memory.scopeKey ?? '',
        normalizeComparable(memory.subject),
        normalizeComparable(memory.content),
      ].join('\0');
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [memory]);
      else group.push(memory);
    }
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [keeper, ...duplicates] = group.toSorted((a, b) => b.updatedAt - a.updatedAt);
      if (keeper === undefined) continue;
      for (const duplicate of duplicates) {
        await this.update(duplicate.id, {
          status: 'superseded',
          supersededBy: keeper.id,
        });
        merged += 1;
      }
    }
    return { examined: active.length, merged };
  }

  async recordTurn(
    context: MemoryRuntimeAgentContext,
    input: MemoryTurnCaptureInput,
  ): Promise<readonly MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    if (this.config?.()?.autoCapture === false) return [];
    if (context.agentType !== 'main') return [];
    const text = contentPartsToText(input.input).trim();
    if (text.length === 0 || shouldSkipMemoryText(text)) return [];
    const captures = extractMemoryCandidates(text, context, input, this.config?.());
    const saved: MemoryRecord[] = [];
    for (const capture of captures) {
      try {
        saved.push(await this.remember(capture));
      } catch {
        continue;
      }
    }
    return saved;
  }

  async injection(context: MemoryRuntimeAgentContext, query?: string): Promise<string | undefined> {
    if (!this.isEnabled()) return undefined;
    if (context.agentType !== 'main') return undefined;
    const hasQuery = query !== undefined && query.trim().length > 0;
    const results = await this.search({
      query,
      workspaceKey: context.workDir,
      sessionId: context.sessionId,
      limit: this.config?.()?.maxRetrieved ?? DEFAULT_INJECTION_LIMIT,
      includeArchived: false,
      minScore: hasQuery ? (this.config?.()?.minInjectionScore ?? DEFAULT_INJECTION_MIN_SCORE) : undefined,
    });
    return renderMemoryInjection(results);
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

  private normalizeCreateInput(
    input: MemoryCreateInput,
    subject: string,
    content: string,
    now: number,
  ): MemoryRecord {
    assertMemoryKind(input.kind);
    const scope = input.scope ?? 'user';
    assertMemoryScope(scope);
    const source = input.source ?? { kind: 'user' };
    return stripUndefined({
      id: randomUUID(),
      kind: input.kind,
      scope,
      scopeKey: input.scopeKey,
      subject,
      content,
      tags: normalizeTags(input.tags ?? []),
      confidence: clamp01(input.confidence ?? 0.85),
      importance: clamp01(input.importance ?? 0.55),
      status: 'active' as const,
      source,
      createdAt: now,
      updatedAt: now,
      accessedAt: undefined,
      accessCount: 0,
      validFrom: input.validFrom,
      validTo: input.validTo,
      supersedes: [],
      supersededBy: undefined,
      metadata: sanitizeMetadata(input.metadata ?? {}),
    });
  }

  private upsertRecord(record: MemoryRecord): void {
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

  private searchWithText(
    query: string,
    request: MemorySearchRequest,
  ): readonly { readonly row: MemoryRow; readonly rank: number | undefined }[] {
    if (this.ftsEnabled) {
      const ftsQuery = toFtsQuery(query);
      if (ftsQuery !== undefined) {
        try {
          const { clauses, params } = this.searchClauses(request);
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
    const { clauses, params } = this.searchClauses(request);
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
    const { clauses, params } = this.searchClauses(request);
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

  private searchClauses(request: MemorySearchRequest): { readonly clauses: readonly string[]; readonly params: readonly unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const statuses = allowedStatuses(request);
    clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
    if (request.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(request.kind);
    }
    if (request.kinds !== undefined && request.kinds.length > 0) {
      clauses.push(`kind IN (${request.kinds.map(() => '?').join(', ')})`);
      params.push(...request.kinds);
    }
    if (request.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(request.scope);
      if (request.scopeKey !== undefined) {
        clauses.push('scope_key = ?');
        params.push(request.scopeKey);
      }
    } else {
      const scopeClauses = ['scope = ?'];
      params.push('user');
      if (request.workspaceKey !== undefined) {
        scopeClauses.push('(scope = ? AND scope_key = ?)');
        params.push('workspace', request.workspaceKey);
      }
      if (request.sessionId !== undefined) {
        scopeClauses.push('(scope = ? AND scope_key = ?)');
        params.push('session', request.sessionId);
      }
      clauses.push(`(${scopeClauses.join(' OR ')})`);
    }
    return { clauses, params };
  }

  private touch(ids: readonly string[]): void {
    const now = this.now();
    const statement = this.db.prepare(
      'UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
    );
    for (const id of ids) {
      statement.run(now, id);
    }
  }

  private insertEvent(memoryId: string, action: string, source: MemorySourceRef): void {
    this.db
      .prepare('INSERT INTO memory_events (id, memory_id, action, source_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), memoryId, action, JSON.stringify(source), this.now());
  }

  private restoreMarkdownRecords(): void {
    if (!existsSync(this.recordsDir)) return;
    for (const file of readdirSync(this.recordsDir)) {
      if (!file.endsWith('.md')) continue;
      const record = readMarkdownRecord(join(this.recordsDir, file));
      if (record === undefined) continue;
      if (this.hasRecord(record.id)) continue;
      this.upsertRecord(record);
    }
  }

  private writeMarkdownRecord(record: MemoryRecord): void {
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

  private hasRecord(id: string): boolean {
    const row = this.db.prepare('SELECT id FROM memories WHERE id = ? LIMIT 1').get(id);
    return typeof row === 'object' && row !== null;
  }
}

class LioraRecallSessionRuntime implements SessionMemoryRuntime {
  constructor(
    private readonly store: LioraRecallStore,
    private readonly context: MemoryRuntimeSessionContext,
  ) {}

  forAgent(context: MemoryRuntimeAgentContext): AgentMemoryRuntime {
    return new LioraRecallAgentRuntime(this.store, {
      ...context,
      sessionId: this.context.sessionId,
      workDir: context.workDir || this.context.workDir,
    });
  }
}

class LioraRecallAgentRuntime implements AgentMemoryRuntime {
  constructor(
    private readonly store: LioraRecallStore,
    private readonly context: MemoryRuntimeAgentContext,
  ) {}

  isEnabled(): boolean {
    return this.store.isEnabled();
  }

  search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    return this.store.search(this.withContext(request));
  }

  list(request: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    return this.store.list(this.withListContext(request));
  }

  get(id: string): Promise<MemoryRecord | undefined> {
    return this.visibleRecord(id);
  }

  remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    return this.store.remember({
      ...input,
      scope: input.scope ?? defaultScopeForKind(input.kind),
      scopeKey: input.scopeKey ?? defaultScopeKey(input.scope ?? defaultScopeForKind(input.kind), this.context),
      source: input.source ?? { kind: 'tool', sessionId: this.context.sessionId, agentId: this.context.agentId },
    });
  }

  async update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord> {
    const existing = await this.visibleRecord(id);
    if (existing === undefined) {
      throw new Error(`Memory "${id}" was not found.`);
    }
    const scopedPatch = this.withUpdateContext(existing, patch);
    if (!this.isVisibleScope(scopedPatch.scope ?? existing.scope, scopedPatch.scopeKey ?? existing.scopeKey)) {
      throw new Error(`Memory "${id}" was not found.`);
    }
    return this.store.update(id, scopedPatch);
  }

  async forget(id: string): Promise<boolean> {
    const existing = await this.visibleRecord(id);
    if (existing === undefined) return false;
    return this.store.forget(id);
  }

  getInjection(query?: string): Promise<string | undefined> {
    return this.store.injection(this.context, query);
  }

  recordTurn(input: MemoryTurnCaptureInput): Promise<readonly MemoryRecord[]> {
    return this.store.recordTurn(this.context, input);
  }

  private withContext(request: MemorySearchRequest): MemorySearchRequest {
    return {
      ...request,
      workspaceKey: request.workspaceKey ?? this.context.workDir,
      sessionId: request.sessionId ?? this.context.sessionId,
      limit: request.limit ?? DEFAULT_INJECTION_LIMIT,
    };
  }

  private withListContext(request: MemoryListRequest): MemoryListRequest {
    return {
      ...request,
      scopeKey:
        request.scopeKey ?? (request.scope === undefined ? undefined : defaultScopeKey(request.scope, this.context)),
      workspaceKey: request.workspaceKey ?? this.context.workDir,
      sessionId: request.sessionId ?? this.context.sessionId,
      limit: request.limit ?? DEFAULT_INJECTION_LIMIT,
    };
  }

  private withUpdateContext(existing: MemoryRecord, patch: MemoryUpdateInput): MemoryUpdateInput {
    if (patch.scope === undefined || patch.scopeKey !== undefined) return patch;
    const scopeKey = defaultScopeKey(patch.scope, this.context);
    if (scopeKey === existing.scopeKey) return patch;
    return { ...patch, scopeKey };
  }

  private async visibleRecord(id: string): Promise<MemoryRecord | undefined> {
    const record = await this.store.get(id);
    if (record === undefined) return undefined;
    return this.isVisibleScope(record.scope, record.scopeKey) ? record : undefined;
  }

  private isVisibleScope(scope: MemoryScope, scopeKey: string | undefined): boolean {
    if (scope === 'user') return true;
    if (scope === 'workspace') return scopeKey === this.context.workDir;
    return scopeKey === this.context.sessionId;
  }
}

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

function openDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const sqlite = require('node:sqlite') as SqliteModule;
  return new sqlite.DatabaseSync(path);
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

function scoreMemory(
  memory: MemoryRecord,
  query: string | undefined,
  ftsRank: number | undefined,
  now: number,
): MemorySearchResult {
  const lexical = ftsRank === undefined ? lexicalScore(memory, query) : Math.max(0, 1 / (1 + Math.abs(ftsRank)));
  const ageDays = Math.max(0, (now - memory.updatedAt) / 86_400_000);
  const recency = Math.max(0, 1 - ageDays / 365);
  const frequency = accessFrequencyScore(memory.accessCount);
  const score = clamp01(
    lexical * 0.5 + memory.importance * 0.2 + memory.confidence * 0.1 + recency * 0.1 + frequency * 0.1,
  );
  const reasons = [
    lexical > 0.1 ? 'text-match' : 'recent-important',
    memory.importance >= 0.7 ? 'important' : undefined,
    recency >= 0.8 ? 'recent' : undefined,
    frequency >= 0.5 ? 'frequently-used' : undefined,
  ].filter((reason): reason is string => reason !== undefined);
  return { memory, score, reasons };
}

function accessFrequencyScore(accessCount: number): number {
  if (accessCount <= 0) return 0;
  return clamp01(Math.log1p(accessCount) / Math.log1p(8));
}

function lexicalScore(memory: MemoryRecord, query: string | undefined): number {
  if (query === undefined || query.trim().length === 0) return 0.25;
  const haystack = normalizeComparable(`${memory.subject} ${memory.content} ${memory.tags.join(' ')}`);
  const terms = queryTerms(query);
  if (terms.length === 0) return 0.25;
  const matches = terms.filter((term) => haystack.includes(normalizeComparable(term))).length;
  return matches / terms.length;
}

function extractMemoryCandidates(
  text: string,
  context: MemoryRuntimeAgentContext,
  input: MemoryTurnCaptureInput,
  config: LioraRecallConfig | undefined,
): readonly MemoryCreateInput[] {
  const captures: MemoryCreateInput[] = [];
  for (const explicit of explicitMemorySentences(text)) {
    captures.push({
      kind: explicit.kind,
      scope: explicit.scope,
      scopeKey: defaultScopeKey(explicit.scope, context),
      subject: summarizeSubject(explicit.content),
      content: explicit.content,
      tags: explicit.tags,
      confidence: 0.92,
      importance: explicit.kind === 'procedural' ? 0.85 : 0.72,
      source: {
        kind: 'auto',
        sessionId: context.sessionId,
        agentId: context.agentId,
        turnId: input.turnId,
        excerpt: excerpt(text),
      },
      metadata: {
        capture: 'explicit',
        captureSignal: explicit.signal,
        captureUtility: explicit.utility,
      },
    });
  }
  if (captures.length === 0 && config?.captureEpisodic !== false && shouldCaptureEpisode(text, input.reason)) {
    captures.push({
      kind: 'episodic',
      scope: 'workspace',
      scopeKey: context.workDir,
      subject: summarizeSubject(text),
      content: truncate(text, 1_200),
      tags: inferTags(text),
      confidence: 0.65,
      importance: 0.48,
      source: {
        kind: 'auto',
        sessionId: context.sessionId,
        agentId: context.agentId,
        turnId: input.turnId,
        excerpt: excerpt(text),
      },
      metadata: {
        capture: 'episode',
        captureSignal: 'completed-work',
        captureUtility: 0.48,
      },
    });
  }
  return captures;
}

function explicitMemorySentences(text: string): readonly ExplicitMemoryCandidate[] {
  const results: ExplicitMemoryCandidate[] = [];
  const patterns: readonly {
    readonly regex: RegExp;
    readonly kind: MemoryKind;
    readonly scope: MemoryScope;
    readonly tags: readonly string[];
    readonly signal: string;
    readonly utility: number;
  }[] = [
    {
      regex: /(?:기억해줘|기억해|메모해줘|메모해|remember(?: that)?|note(?: that)?)[:\s]+(.+)/giu,
      kind: 'semantic',
      scope: 'user',
      tags: ['explicit'],
      signal: 'explicit-request',
      utility: 0.74,
    },
    {
      regex: /(?:앞으로|from now on|always|prefer|선호|취향)[:\s,]+(.+)/giu,
      kind: 'procedural',
      scope: 'user',
      tags: ['preference'],
      signal: 'preference-directive',
      utility: 0.86,
    },
    {
      regex: /(?:remind me|리마인드해줘|알려줘)[:\s]+(.+)/giu,
      kind: 'prospective',
      scope: 'user',
      tags: ['reminder'],
      signal: 'reminder-request',
      utility: 0.82,
    },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const content = normalizeMemorySentence(match[1] ?? '');
      if (content.length > 0 && !shouldSkipMemoryText(content) && !isTransientMemoryCandidate(content)) {
        results.push({
          kind: pattern.kind,
          scope: pattern.scope,
          content,
          tags: pattern.tags,
          signal: pattern.signal,
          utility: pattern.utility,
        });
      }
    }
  }
  return results.slice(0, 5);
}

function shouldCaptureEpisode(text: string, reason: string): boolean {
  if (reason !== 'completed') return false;
  if (text.length < 24) return false;
  if (isTransientMemoryCandidate(text)) return false;
  return /(?:\bbug\b|\bfix\b|\bimplement\b|\brefactor\b|\btest\b|\bbuild\b|\bPR\b|\bcommit\b|구현|수정|테스트|버그|리팩터|계획|goal|AGENTS\.md|packages\/|apps\/|src\/)/iu.test(text);
}

function isTransientMemoryCandidate(text: string): boolean {
  const normalized = normalizeComparable(text);
  if (/[?？]\s*$/u.test(text.trim())) return true;
  return /(?:\bwhat\b|\bwhen\b|\bwhere\b|\bwho\b|\bwhy\b|\bhow\b|뭐|무엇|언제|어디|누구|왜|어떻게|하면 돼|할까)$/iu.test(
    normalized,
  );
}

function defaultScopeForKind(kind: MemoryKind): MemoryScope {
  if (kind === 'episodic') return 'workspace';
  return 'user';
}

function defaultScopeKey(scope: MemoryScope, context: MemoryRuntimeAgentContext): string | undefined {
  if (scope === 'workspace') return context.workDir;
  if (scope === 'session') return context.sessionId;
  return undefined;
}

function normalizeRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(message);
  return trimmed;
}

function normalizeMemorySentence(value: string): string {
  return value
    .split(/\n{2,}/u, 1)[0]
    ?.replace(/[`"'“”‘’]+$/u, '')
    .trim() ?? '';
}

function summarizeSubject(text: string): string {
  return truncate(text.replace(/\s+/gu, ' ').trim(), 96);
}

function excerpt(text: string): string {
  return truncate(text.replace(/\s+/gu, ' ').trim(), 240);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function contentPartsToText(parts: readonly import('@superliora/kosong').ContentPart[]): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter((text) => text.length > 0)
    .join('\n');
}

function inferTags(text: string): readonly string[] {
  const tags = new Set<string>();
  if (/test|테스트/iu.test(text)) tags.add('test');
  if (/bug|fix|버그|수정/iu.test(text)) tags.add('bugfix');
  if (/implement|구현/iu.test(text)) tags.add('implementation');
  if (/config|설정/iu.test(text)) tags.add('config');
  return [...tags].slice(0, 6);
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))].slice(0, 16);
}

function sanitizeMetadata(metadata: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
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

function hasAllTags(record: MemoryRecord, tags: readonly string[] | undefined): boolean {
  if (tags === undefined || tags.length === 0) return true;
  const own = new Set(record.tags);
  return tags.every((tag) => own.has(tag.toLowerCase()));
}

function allowedStatuses(request: MemorySearchRequest): readonly MemoryStatus[] {
  const statuses: MemoryStatus[] = ['active'];
  if (request.includeArchived === true) {
    statuses.push('archived', 'superseded');
  }
  if (request.includeDeleted === true) {
    statuses.push('deleted');
  }
  return statuses;
}

function toFtsQuery(query: string): string | undefined {
  const terms = queryTerms(query).slice(0, 8);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

function queryTerms(query: string): readonly string[] {
  return query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function escapeLike(query: string): string {
  return query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function normalizeComparable(input: string): string {
  return input.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function limit(value: number | undefined, max = MAX_LIMIT): number {
  return Math.max(1, Math.min(max, value ?? DEFAULT_LIMIT));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isMemoryKind(value: string): value is MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind);
}

function isMemoryScope(value: string): value is MemoryScope {
  return MEMORY_SCOPES.includes(value as MemoryScope);
}

function isMemoryStatus(value: string): value is MemoryStatus {
  return MEMORY_STATUSES.includes(value as MemoryStatus);
}

function parseMemoryKind(value: string): MemoryKind {
  if (isMemoryKind(value)) return value;
  return 'semantic';
}

function parseMemoryScope(value: string): MemoryScope {
  if (isMemoryScope(value)) return value;
  return 'user';
}

function parseMemoryStatus(value: string): MemoryStatus {
  if (isMemoryStatus(value)) return value;
  return 'active';
}

function assertMemoryKind(value: string): asserts value is MemoryKind {
  if (!isMemoryKind(value)) throw new Error(`Invalid memory kind: ${value}`);
}

function assertMemoryScope(value: string): asserts value is MemoryScope {
  if (!isMemoryScope(value)) throw new Error(`Invalid memory scope: ${value}`);
}

function assertMemoryStatus(value: string): asserts value is MemoryStatus {
  if (!isMemoryStatus(value)) throw new Error(`Invalid memory status: ${value}`);
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

function isMemoryRecordLike(value: unknown): value is MemoryRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['kind'] === 'string' &&
    isMemoryKind(record['kind']) &&
    typeof record['scope'] === 'string' &&
    isMemoryScope(record['scope']) &&
    typeof record['subject'] === 'string' &&
    typeof record['content'] === 'string' &&
    Array.isArray(record['tags']) &&
    typeof record['confidence'] === 'number' &&
    typeof record['importance'] === 'number' &&
    typeof record['status'] === 'string' &&
    isMemoryStatus(record['status']) &&
    typeof record['createdAt'] === 'number' &&
    typeof record['updatedAt'] === 'number'
  );
}

function isMemorySourceRefLike(value: unknown): value is MemorySourceRef {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as Record<string, unknown>;
  const kind = source['kind'];
  return (
    (kind === 'user' || kind === 'tool' || kind === 'auto' || kind === 'import' || kind === 'system') &&
    (source['sessionId'] === undefined || typeof source['sessionId'] === 'string') &&
    (source['agentId'] === undefined || typeof source['agentId'] === 'string') &&
    (source['turnId'] === undefined || typeof source['turnId'] === 'number') &&
    (source['messageId'] === undefined || typeof source['messageId'] === 'string') &&
    (source['excerpt'] === undefined || typeof source['excerpt'] === 'string')
  );
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}
