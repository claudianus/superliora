/**
 * Liora Recall store — public `LioraRecallStore` API and session/agent
 * runtime views.
 *
 * This is a thin coordinator: on-disk persistence (SQLite + `records/`
 * markdown mirror, corruption recovery) lives in `store-persistence.ts`,
 * and pure business logic (scoring, validation, SQL clause construction,
 * turn-capture extraction) lives in `store-query.ts`. Everything exported
 * from this module before the Wave 4b/5 split remains exported here with
 * identical behavior.
 */

import { join } from 'pathe';

import { renderMemoryInjection } from './render';
import { redactMemoryText, shouldSkipMemoryText } from './redact';
import { MemoryPersistence, SCHEMA_VERSION, STORE_RELATIVE_PATH } from './store-persistence';
import {
  assertMemoryKind,
  assertMemoryScope,
  assertMemoryStatus,
  buildListFilter,
  clamp01,
  defaultScopeForKind,
  defaultScopeKey,
  extractMemoryCandidates,
  hasAllTags,
  isMemoryKind,
  isMemoryRecordLike,
  isMemoryScope,
  limit,
  MAX_LIMIT,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  contentPartsToText,
  normalizeComparable,
  normalizeCreateInput,
  normalizeRequired,
  normalizeTags,
  prioritizeInjectionKinds,
  sanitizeMetadata,
  scoreMemory,
  stripUndefined,
} from './store-query';
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
  MemoryStats,
  MemoryTurnCaptureInput,
  MemoryUpdateInput,
  SessionMemoryRuntime,
} from './types';

export interface LioraRecallStoreOptions {
  readonly homeDir: string;
  readonly config?: (() => LioraRecallConfig | undefined) | undefined;
  readonly now?: (() => number) | undefined;
}

export interface MemoryIntegrityOptions {
  readonly repair?: boolean | undefined;
}

export interface MemoryIntegrityReport {
  readonly ok: boolean;
  readonly issues: string[];
  readonly repaired?: boolean | undefined;
}

const DEFAULT_INJECTION_LIMIT = 2;
const DEFAULT_INJECTION_MIN_SCORE = 0.35;

// Recall precision (T2-5): governance/semantic memories are durable rules
// and facts; episodic noise should not crowd them out of the tiny injection
// cap. Candidates are fetched wide, boosted, re-ranked, then capped.
const INJECTION_CANDIDATE_MULTIPLIER = 3;
const INJECTION_CANDIDATE_FLOOR = 6;

export class LioraRecallStore {
  private readonly persistence: MemoryPersistence;
  private readonly now: () => number;
  private readonly config: (() => LioraRecallConfig | undefined) | undefined;

  constructor(options: LioraRecallStoreOptions) {
    this.now = options.now ?? Date.now;
    this.config = options.config;
    const dbPath = options.config?.()?.storePath ?? join(options.homeDir, STORE_RELATIVE_PATH);
    this.persistence = new MemoryPersistence(dbPath, this.now);
  }

  getStorePath(): string {
    return this.persistence.dbPath;
  }

  isEnabled(): boolean {
    return this.config?.()?.enabled !== false;
  }

  /**
   * Cross-check the SQLite database against the `records/` markdown mirror.
   *
   * Runs `PRAGMA quick_check`, compares the database row count with the number
   * of mirror files, and checks mirror record ids against the database rows.
   * With `repair: true`, records present in the mirror but missing from the
   * database are restored through the same path used at open. `issues`
   * describes what the check found and `repaired` reports the restore outcome;
   * run a second check to confirm a clean state after a repair.
   */
  checkIntegrity(options: MemoryIntegrityOptions = {}): MemoryIntegrityReport {
    const { issues, missingIds } = this.persistence.checkIntegrity();
    if (options.repair !== true) {
      return { ok: issues.length === 0, issues };
    }
    if (missingIds.length === 0) {
      return { ok: issues.length === 0, issues, repaired: false };
    }
    this.persistence.restoreMarkdownRecords();
    const stillMissing = missingIds.filter((id) => !this.persistence.hasRecord(id));
    if (stillMissing.length > 0) {
      issues.push(`repair incomplete: ${stillMissing.length} records could not be restored`);
    }
    return { ok: issues.length === 0, issues, repaired: stillMissing.length === 0 };
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
    const record = normalizeCreateInput(input, subject, redacted.text, now);
    this.persistence.upsertRecord(record);
    this.persistence.writeMarkdownRecord(record);
    this.persistence.insertEvent(record.id, 'create', record.source);
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
    this.persistence.upsertRecord(record);
    this.persistence.writeMarkdownRecord(record);
    this.persistence.insertEvent(record.id, 'update', existing.source);
    return record;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.persistence.getRecord(id);
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
    this.persistence.upsertRecord(deletedRecord);
    this.persistence.writeMarkdownRecord(deletedRecord);
    this.persistence.insertEvent(id, 'forget', existing.source);
    return true;
  }

  async list(request: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    const { clauses, params } = buildListFilter(request);
    const records = this.persistence.listRecords(clauses, params, limit(request.limit), Math.max(0, request.offset ?? 0));
    return records.filter((record) => hasAllTags(record, request.tags));
  }

  async search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    if (!this.isEnabled()) return [];
    const query = request.query?.trim();
    const records = this.persistence
      .searchRecords(query, request)
      .filter(({ record }) => hasAllTags(record, request.tags));
    const scored = records.map(({ record, rank }) => scoreMemory(record, query, rank, this.now()));
    const minScore =
      typeof request.minScore === 'number' && Number.isFinite(request.minScore) ? request.minScore : undefined;
    const ranked = scored.toSorted((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt);
    const sorted = (minScore === undefined ? ranked : ranked.filter((result) => result.score >= minScore)).slice(
      0,
      limit(request.limit),
    );
    if (sorted.length > 0) {
      this.persistence.touch(sorted.map((result) => result.memory.id));
    }
    return sorted;
  }

  async stats(): Promise<MemoryStats> {
    const rows = this.persistence.statsRows();
    const byKind = Object.fromEntries(MEMORY_KINDS.map((kind) => [kind, 0])) as Record<MemoryKind, number>;
    const byScope = Object.fromEntries(MEMORY_SCOPES.map((scope) => [scope, 0])) as Record<MemoryScope, number>;
    let total = 0;
    let active = 0;
    let archived = 0;
    let deleted = 0;
    for (const row of rows) {
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
      this.persistence.upsertRecord(record);
      this.persistence.writeMarkdownRecord(record);
      if (existing === undefined) imported += 1;
      else updated += 1;
      this.persistence.insertEvent(record.id, 'import', { kind: 'import' });
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
    const cap = this.config?.()?.maxRetrieved ?? DEFAULT_INJECTION_LIMIT;
    // Recall precision (T2-5): fetch a wider candidate window, then let
    // governance/semantic memories outrank marginal episodic hits before
    // the cap is applied.
    const results = await this.search({
      query,
      workspaceKey: context.workDir,
      sessionId: context.sessionId,
      limit: Math.max(cap * INJECTION_CANDIDATE_MULTIPLIER, INJECTION_CANDIDATE_FLOOR),
      includeArchived: false,
      minScore: hasQuery ? (this.config?.()?.minInjectionScore ?? DEFAULT_INJECTION_MIN_SCORE) : undefined,
    });
    return renderMemoryInjection(prioritizeInjectionKinds(results).slice(0, cap));
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
