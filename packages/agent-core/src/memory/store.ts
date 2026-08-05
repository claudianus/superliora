/**
 * Liora Memory store — public `LioraMemoryStore` API and session/agent
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
  assertMemoryType,
  assertMemoryScope,
  assertMemoryStatus,
  buildListFilter,
  clamp01,
  defaultScopeForType,
  defaultScopeKey,
  extractMemoryCandidates,
  hasAllTags,
  isMemoryType,
  isMemoryEvidenceRefLike,
  isMemoryLinkLike,
  isMemoryRecordLike,
  isMemoryScope,
  limit,
  MAX_LIMIT,
  MEMORY_TYPES,
  MEMORY_SCOPES,
  contentPartsToText,
  normalizeComparable,
  normalizeCreateInput,
  normalizeRequired,
  normalizeTags,
  prioritizeInjectionTypes,
  sanitizeMetadata,
  scoreMemory,
  stripUndefined,
} from './store-query';
import type {
  AgentMemoryRuntime,
  LioraMemoryConfig,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryInspectResult,
  MemoryListRequest,
  MemoryRecord,
  MemoryRuntimeAgentContext,
  MemoryRuntimeSessionContext,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryReflectInput,
  MemoryReflectResult,
  MemoryStats,
  MemoryTurnCaptureInput,
  MemoryType,
  MemoryUpdateInput,
  SessionMemoryRuntime,
} from './types';

export interface LioraMemoryStoreOptions {
  readonly homeDir: string;
  readonly config?: (() => LioraMemoryConfig | undefined) | undefined;
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

// Recall precision (T2-5): rule/fact memories are durable guidance; event
// noise should not crowd them out of the tiny injection window.
// cap. Candidates are fetched wide, boosted, re-ranked, then capped.
const INJECTION_CANDIDATE_MULTIPLIER = 3;
const INJECTION_CANDIDATE_FLOOR = 6;

function temporalWindowsOverlap(left: MemoryRecord, right: MemoryRecord): boolean {
  const leftStart = left.validFrom ?? Number.NEGATIVE_INFINITY;
  const rightStart = right.validFrom ?? Number.NEGATIVE_INFINITY;
  const leftEnd = Math.min(left.validTo ?? Number.POSITIVE_INFINITY, left.invalidAt ?? Number.POSITIVE_INFINITY);
  const rightEnd = Math.min(right.validTo ?? Number.POSITIVE_INFINITY, right.invalidAt ?? Number.POSITIVE_INFINITY);
  return Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd);
}

export class LioraMemoryStore {
  private readonly persistence: MemoryPersistence;
  private readonly now: () => number;
  private readonly config: (() => LioraMemoryConfig | undefined) | undefined;

  constructor(options: LioraMemoryStoreOptions) {
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
    return new LioraMemorySessionRuntime(this, context);
  }

  async remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    if (!this.isEnabled()) {
      throw new Error('Liora Memory is disabled by config.');
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
    if (
      (patch.evidenceRefs !== undefined && patch.evidenceRefs.some((ref) => !isMemoryEvidenceRefLike(ref))) ||
      (patch.links !== undefined && patch.links.some((link) => !isMemoryLinkLike(link)))
    ) {
      throw new Error('Memory provenance contains an invalid reference or link.');
    }
    const scope = patch.scope ?? existing.scope;
    const scopeKey =
      patch.scopeKey !== undefined
        ? patch.scopeKey
        : patch.scope !== undefined && patch.scope !== existing.scope
          ? undefined
          : existing.scopeKey;
    if (scope !== 'user' && (scopeKey === undefined || scopeKey.trim().length === 0)) {
      throw new Error(`Memory ${scope} scope requires a scopeKey.`);
    }
    const record = stripUndefined({
      ...existing,
      type: patch.type ?? existing.type,
      epistemic: patch.epistemic ?? existing.epistemic,
      scope,
      subject: patch.subject === undefined ? existing.subject : normalizeRequired(patch.subject, 'Memory subject cannot be empty.'),
      content,
      tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
      confidence: clamp01(patch.confidence ?? existing.confidence),
      importance: clamp01(patch.importance ?? existing.importance),
      status: patch.status ?? existing.status,
      updatedAt: now,
      recordedAt: existing.recordedAt,
      supersedes: existing.supersedes,
      metadata: patch.metadata === undefined ? existing.metadata : sanitizeMetadata(patch.metadata),
      scopeKey: scope === 'user' ? undefined : scopeKey,
      validFrom: patch.validFrom ?? existing.validFrom,
      validTo: patch.validTo ?? existing.validTo,
      invalidAt: patch.invalidAt ?? existing.invalidAt,
      supersededBy: patch.supersededBy ?? existing.supersededBy,
      evidenceRefs: patch.evidenceRefs ?? existing.evidenceRefs,
      links: patch.links ?? existing.links,
    });
    assertMemoryType(record.type);
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
      invalidAt: existing.invalidAt ?? now,
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

  async recall(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    if (!this.isEnabled()) return [];
    const effectiveRequest =
      request.asOf === undefined ? { ...request, asOf: this.now() } : request;
    const query = effectiveRequest.query?.trim();
    const records = this.persistence
      .searchRecords(query, effectiveRequest)
      .filter(({ record }) => hasAllTags(record, effectiveRequest.tags));
    const scored = records.map(({ record, rank }) => scoreMemory(record, query, rank, this.now()));
    const minScore =
      typeof effectiveRequest.minScore === 'number' && Number.isFinite(effectiveRequest.minScore)
        ? effectiveRequest.minScore
        : undefined;
    const scoredRanked = scored.toSorted((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt);
    let ranked = scoredRanked;
    const filtered = minScore === undefined ? ranked : ranked.filter((result) => result.score >= minScore);
    if (request.expandLinks === true && filtered.length > 0) {
      const known = new Set(filtered.map((result) => result.memory.id));
      const linked = this.persistence.expandMemoryLinks([...known], 2, 32, effectiveRequest.asOf);
      for (const entry of linked) {
        const memory = await this.get(entry.id);
        if (
          memory === undefined ||
          known.has(memory.id) ||
          !this.matchesRecallBoundary(memory, effectiveRequest)
        )
          continue;
        const result = scoreMemory(memory, query, undefined, this.now());
        ranked = [...ranked, { ...result, reasons: [...result.reasons, 'linked'], linkPath: entry.path }];
        known.add(memory.id);
      }
      ranked = ranked.toSorted((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt);
    } else {
      ranked = filtered;
    }
    const sorted = this.applyTokenBudget(
      ranked.filter((result) => minScore === undefined || result.score >= minScore),
      effectiveRequest.tokenBudget,
      effectiveRequest.limit,
    );
    if (sorted.length === 0 && minScore !== undefined && scoredRanked.length > 0) {
      const best = scoredRanked[0]!;
      return [
        {
          ...best,
          abstained: true,
          abstentionReason: `best score ${best.score.toFixed(2)} is below minimum ${minScore.toFixed(2)}`,
        },
      ];
    }
    if (sorted.length > 0) {
      this.persistence.touch(sorted.map((result) => result.memory.id));
    }
    return sorted;
  }

  private matchesRecallBoundary(memory: MemoryRecord, request: MemorySearchRequest): boolean {
    const archived =
      request.includeArchived === true &&
      (memory.status === 'archived' || memory.status === 'superseded');
    const deleted = request.includeDeleted === true && memory.status === 'deleted';
    const candidate = request.includeCandidates === true && memory.status === 'candidate';
    if (memory.status !== 'active' && !archived && !deleted && !candidate) return false;
    if (request.scope !== undefined && memory.scope !== request.scope) return false;
    if (request.scopeKey !== undefined && memory.scopeKey !== request.scopeKey) return false;
    if (
      request.scope === undefined &&
      memory.scope !== 'user' &&
      memory.scopeKey !== (memory.scope === 'workspace' ? request.workspaceKey : request.sessionId)
    ) {
      return false;
    }
    if (request.asOf !== undefined) {
      if (memory.recordedAt > request.asOf) return false;
      if (memory.validFrom !== undefined && memory.validFrom > request.asOf) return false;
      if (memory.validTo !== undefined && memory.validTo <= request.asOf) return false;
      if (
        request.includeDeleted !== true &&
        memory.invalidAt !== undefined &&
        memory.invalidAt <= request.asOf
      ) {
        return false;
      }
    }
    return true;
  }

  private applyTokenBudget(
    results: readonly MemorySearchResult[],
    tokenBudget: number | undefined,
    requestedLimit: number | undefined,
  ): readonly MemorySearchResult[] {
    const cap = limit(requestedLimit);
    if (tokenBudget === undefined || !Number.isFinite(tokenBudget)) return results.slice(0, cap);
    let used = 0;
    const boundedBudget = Math.max(1, Math.floor(tokenBudget));
    const selected: MemorySearchResult[] = [];
    for (const result of results) {
      const estimated = Math.max(1, Math.ceil((result.memory.subject.length + result.memory.content.length) / 4));
      if (selected.length > 0 && used + estimated > boundedBudget) break;
      selected.push(result);
      used += estimated;
      if (selected.length >= cap) break;
    }
    return selected;
  }

  async stats(): Promise<MemoryStats> {
    const rows = this.persistence.statsRows();
    const byType = Object.fromEntries(MEMORY_TYPES.map((type) => [type, 0])) as Record<MemoryType, number>;
    const byScope = Object.fromEntries(MEMORY_SCOPES.map((scope) => [scope, 0])) as Record<MemoryScope, number>;
    let total = 0;
    let active = 0;
    let archived = 0;
    let deleted = 0;
    let candidates = 0;
    for (const row of rows) {
      total += row.count;
      if (row.status === 'active') active += row.count;
      if (row.status === 'archived') archived += row.count;
      if (row.status === 'deleted') deleted += row.count;
      if (row.status === 'candidate') candidates += row.count;
      if (isMemoryType(row.kind)) byType[row.kind] += row.count;
      if (isMemoryScope(row.scope)) byScope[row.scope] += row.count;
    }
    return { total, active, archived, deleted, candidates, byType, byScope };
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

  async reflect(input: MemoryReflectInput = {}): Promise<MemoryReflectResult> {
    const active = await this.list({ status: 'active', limit: MAX_LIMIT });
    const candidates = await this.list({ status: 'candidate', limit: input.limit ?? MAX_LIMIT });
    let promoted = 0;
    let rejected = 0;
    let merged = 0;
    let activeRecords = [...active];
    const memoryKey = (memory: MemoryRecord): string =>
      [
        memory.type,
        memory.scope,
        memory.scopeKey ?? '',
        normalizeComparable(memory.subject),
        normalizeComparable(memory.content),
      ].join('\0');
    for (const candidate of candidates) {
      const duplicate = activeRecords.find((memory) => memoryKey(memory) === memoryKey(candidate));
      if (duplicate !== undefined) {
        if (input.dryRun !== true) {
          await this.update(candidate.id, { status: 'superseded', supersededBy: duplicate.id });
        }
        rejected += 1;
        continue;
      }
      const conflict = activeRecords.find(
        (memory) =>
          memory.type === candidate.type &&
          memory.scope === candidate.scope &&
          memory.scopeKey === candidate.scopeKey &&
          normalizeComparable(memory.subject) === normalizeComparable(candidate.subject) &&
          temporalWindowsOverlap(memory, candidate),
      );
      if (
        conflict !== undefined &&
        input.force !== true &&
        (candidate.recordedAt < conflict.recordedAt ||
          (candidate.recordedAt === conflict.recordedAt && candidate.id < conflict.id))
      ) {
        if (input.dryRun !== true) {
          await this.update(candidate.id, { status: 'superseded', supersededBy: conflict.id });
        }
        rejected += 1;
        continue;
      }
      if (conflict !== undefined && input.dryRun !== true) {
        await this.update(conflict.id, { status: 'superseded', supersededBy: candidate.id });
      }
      promoted += 1;
      if (conflict !== undefined) {
        activeRecords = activeRecords.filter((memory) => memory.id !== conflict.id);
      }
      activeRecords.push({ ...candidate, status: 'active' });
      if (input.dryRun !== true) {
        await this.update(candidate.id, { status: 'active' });
      }
      if (conflict !== undefined) merged += 1;
    }
    if (input.dryRun !== true) await this.applyRetention();
    return { examined: active.length + candidates.length, merged, promoted, rejected };
  }

  private async applyRetention(): Promise<void> {
    const retentionDays = this.config?.()?.retentionDays;
    if (retentionDays === undefined || !Number.isFinite(retentionDays)) return;
    const cutoff = this.now() - Math.max(1, retentionDays) * 86_400_000;
    const records = await this.list({ status: 'active', limit: MAX_LIMIT });
    for (const record of records) {
      if (record.updatedAt < cutoff) await this.update(record.id, { status: 'archived' });
    }
  }

  async inspect(): Promise<MemoryInspectResult> {
    const integrity = this.checkIntegrity();
    return {
      storePath: this.getStorePath(),
      schemaVersion: SCHEMA_VERSION,
      integrity,
      stats: await this.stats(),
      recentEvents: this.persistence.recentEvents(),
    };
  }

  async purge(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (existing === undefined) return false;
    const purged = this.persistence.purgeRecord(id);
    if (purged) this.persistence.insertEvent(id, 'purge', { kind: 'system' });
    return purged;
  }

  async recordTurn(
    context: MemoryRuntimeAgentContext,
    input: MemoryTurnCaptureInput,
  ): Promise<readonly MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    if (this.config?.()?.captureMode === 'off') return [];
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
    const results = await this.recall({
      query,
      workspaceKey: context.workDir,
      sessionId: context.sessionId,
      limit: Math.max(cap * INJECTION_CANDIDATE_MULTIPLIER, INJECTION_CANDIDATE_FLOOR),
      includeArchived: false,
      includeCandidates: false,
      minScore: hasQuery ? (this.config?.()?.minInjectionScore ?? DEFAULT_INJECTION_MIN_SCORE) : undefined,
    });
    return renderMemoryInjection(prioritizeInjectionTypes(results).slice(0, cap));
  }
}

class LioraMemorySessionRuntime implements SessionMemoryRuntime {
  constructor(
    private readonly store: LioraMemoryStore,
    private readonly context: MemoryRuntimeSessionContext,
  ) {}

  forAgent(context: MemoryRuntimeAgentContext): AgentMemoryRuntime {
    return new LioraMemoryAgentRuntime(this.store, {
      ...context,
      sessionId: this.context.sessionId,
      workDir: context.workDir || this.context.workDir,
    });
  }
}

class LioraMemoryAgentRuntime implements AgentMemoryRuntime {
  constructor(
    private readonly store: LioraMemoryStore,
    private readonly context: MemoryRuntimeAgentContext,
  ) {}

  isEnabled(): boolean {
    return this.store.isEnabled();
  }

  recall(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    return this.store.recall(this.withContext(request));
  }

  list(request: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    return this.store.list(this.withListContext(request));
  }

  get(id: string): Promise<MemoryRecord | undefined> {
    return this.visibleRecord(id);
  }

  remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    const source = input.source ?? {
      kind: 'tool' as const,
      sessionId: this.context.sessionId,
      agentId: this.context.agentId,
    };
    return this.store.remember({
      ...input,
      scope: input.scope ?? defaultScopeForType(input.type),
      scopeKey: input.scopeKey ?? defaultScopeKey(input.scope ?? defaultScopeForType(input.type), this.context),
      source,
      links: [
        ...(input.links ?? []),
        {
          targetKind: 'run',
          targetId: this.context.sessionId,
          relation: 'remembered-in-session',
          confidence: 1,
          source,
        },
      ],
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

  reflect(input: MemoryReflectInput = {}): Promise<MemoryReflectResult> {
    return this.store.reflect(input);
  }

  inspect(): Promise<MemoryInspectResult> {
    return this.store.inspect();
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
