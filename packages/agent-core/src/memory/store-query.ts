/**
 * Pure query/business logic for Liora Memory — extracted from `store.ts`.
 *
 * Everything here is free of I/O: memory scoring/ranking, SQL clause
 * construction (the resulting strings/params are executed by
 * `store-persistence.ts`), turn-capture candidate extraction, and the
 * small validation/normalization helpers shared across the memory store.
 */

import { randomUUID } from 'node:crypto';

import { shouldSkipMemoryText } from './redact';
import type {
  LioraMemoryConfig,
  MemoryCreateInput,
  MemoryEvidenceRef,
  MemoryEpistemic,
  MemoryListRequest,
  MemoryLink,
  MemoryRecord,
  MemoryRuntimeAgentContext,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySourceRef,
  MemoryStatus,
  MemoryTurnCaptureInput,
  MemoryType,
} from './types';

interface ExplicitMemoryCandidate {
  readonly type: MemoryType;
  readonly epistemic: MemoryEpistemic;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly tags: readonly string[];
  readonly signal: string;
  readonly utility: number;
}

export const MEMORY_TYPES: readonly MemoryType[] = [
  'fact',
  'event',
  'procedure',
  'task',
  'rule',
];
export const MEMORY_SCOPES: readonly MemoryScope[] = ['user', 'workspace', 'session'];
export const MEMORY_STATUSES: readonly MemoryStatus[] = [
  'candidate',
  'active',
  'archived',
  'superseded',
  'deleted',
];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// Durable rules and facts should outrank noisy event memories at the tiny
// prompt boundary. Candidates are fetched wide, re-ranked, then capped.
const TYPE_PRIORITY_BOOST = 0.05;
const PRIORITY_INJECTION_TYPES: ReadonlySet<MemoryType> = new Set(['rule', 'fact']);

export function prioritizeInjectionTypes(
  results: readonly MemorySearchResult[],
): readonly MemorySearchResult[] {
  return results
    .map((result) => ({
      result,
      boosted:
        result.score + (PRIORITY_INJECTION_TYPES.has(result.memory.type) ? TYPE_PRIORITY_BOOST : 0),
    }))
    .toSorted((a, b) => b.boosted - a.boosted || b.result.score - a.result.score)
    .map((entry) => entry.result);
}

// ---------------------------------------------------------------------------
// Type/scope/status validation
// ---------------------------------------------------------------------------

export function isMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType);
}

export function isMemoryScope(value: string): value is MemoryScope {
  return MEMORY_SCOPES.includes(value as MemoryScope);
}

export function isMemoryStatus(value: string): value is MemoryStatus {
  return MEMORY_STATUSES.includes(value as MemoryStatus);
}

export function parseMemoryType(value: string): MemoryType {
  if (isMemoryType(value)) return value;
  const legacyTypes: Readonly<Record<string, MemoryType>> = {
    semantic: 'fact',
    episodic: 'event',
    procedural: 'procedure',
    prospective: 'task',
    governance: 'rule',
  };
  return legacyTypes[value] ?? 'fact';
}

export function parseMemoryScope(value: string): MemoryScope {
  if (isMemoryScope(value)) return value;
  return 'user';
}

export function parseMemoryStatus(value: string): MemoryStatus {
  if (isMemoryStatus(value)) return value;
  return 'active';
}

export function assertMemoryType(value: string): asserts value is MemoryType {
  if (!isMemoryType(value)) throw new Error(`Invalid memory type: ${value}`);
}

export function assertMemoryScope(value: string): asserts value is MemoryScope {
  if (!isMemoryScope(value)) throw new Error(`Invalid memory scope: ${value}`);
}

export function assertMemoryStatus(value: string): asserts value is MemoryStatus {
  if (!isMemoryStatus(value)) throw new Error(`Invalid memory status: ${value}`);
}

export function isMemoryRecordLike(value: unknown): value is MemoryRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['type'] === 'string' &&
    isMemoryType(record['type']) &&
    (record['epistemic'] === 'direct' ||
      record['epistemic'] === 'inferred' ||
      record['epistemic'] === 'preference' ||
      record['epistemic'] === 'summary') &&
    typeof record['scope'] === 'string' &&
    isMemoryScope(record['scope']) &&
    typeof record['subject'] === 'string' &&
    typeof record['content'] === 'string' &&
    Array.isArray(record['tags']) &&
    record['tags'].every((tag) => typeof tag === 'string') &&
    typeof record['confidence'] === 'number' &&
    record['confidence'] >= 0 &&
    record['confidence'] <= 1 &&
    typeof record['importance'] === 'number' &&
    record['importance'] >= 0 &&
    record['importance'] <= 1 &&
    typeof record['status'] === 'string' &&
    isMemoryStatus(record['status']) &&
    isMemorySourceRefLike(record['source']) &&
    typeof record['createdAt'] === 'number' &&
    typeof record['updatedAt'] === 'number' &&
    typeof record['recordedAt'] === 'number' &&
    Array.isArray(record['supersedes']) &&
    record['supersedes'].every((id) => typeof id === 'string') &&
    Array.isArray(record['evidenceRefs']) &&
    record['evidenceRefs'].every(isMemoryEvidenceRefLike) &&
    Array.isArray(record['links']) &&
    record['links'].every(isMemoryLinkLike)
  );
}

export function isMemoryEvidenceRefLike(value: unknown): value is MemoryEvidenceRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    (ref['kind'] === 'file' ||
      ref['kind'] === 'symbol' ||
      ref['kind'] === 'run' ||
      ref['kind'] === 'message' ||
      ref['kind'] === 'memory' ||
      ref['kind'] === 'url') &&
    typeof ref['id'] === 'string' &&
    ref['id'].length > 0 &&
    (ref['excerpt'] === undefined || typeof ref['excerpt'] === 'string') &&
    (ref['sha256'] === undefined || typeof ref['sha256'] === 'string')
  );
}

export function isMemoryLinkLike(value: unknown): value is MemoryLink {
  if (typeof value !== 'object' || value === null) return false;
  const link = value as Record<string, unknown>;
  return (
    (link['targetKind'] === 'memory' ||
      link['targetKind'] === 'file' ||
      link['targetKind'] === 'symbol' ||
      link['targetKind'] === 'run' ||
      link['targetKind'] === 'evidence') &&
    typeof link['targetId'] === 'string' &&
    link['targetId'].length > 0 &&
    typeof link['relation'] === 'string' &&
    link['relation'].length > 0 &&
    typeof link['confidence'] === 'number' &&
    link['confidence'] >= 0 &&
    link['confidence'] <= 1 &&
    (link['validFrom'] === undefined || typeof link['validFrom'] === 'number') &&
    (link['validTo'] === undefined || typeof link['validTo'] === 'number') &&
    (link['source'] === undefined || isMemorySourceRefLike(link['source']))
  );
}

export function isMemorySourceRefLike(value: unknown): value is MemorySourceRef {
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

// ---------------------------------------------------------------------------
// Generic normalization helpers
// ---------------------------------------------------------------------------

export function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export function normalizeRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(message);
  return trimmed;
}

export function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))].slice(0, 16);
}

export function sanitizeMetadata(metadata: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function limit(value: number | undefined, max = MAX_LIMIT): number {
  return Math.max(1, Math.min(max, value ?? DEFAULT_LIMIT));
}

export function hasAllTags(record: MemoryRecord, tags: readonly string[] | undefined): boolean {
  if (tags === undefined || tags.length === 0) return true;
  const own = new Set(record.tags);
  return tags.every((tag) => own.has(tag.toLowerCase()));
}

export function allowedStatuses(request: MemorySearchRequest): readonly MemoryStatus[] {
  const statuses: MemoryStatus[] = ['active'];
  if (request.includeCandidates === true) statuses.push('candidate');
  if (request.includeArchived === true) {
    statuses.push('archived', 'superseded');
  }
  if (request.includeDeleted === true) {
    statuses.push('deleted');
  }
  return statuses;
}

export function normalizeComparable(input: string): string {
  return input.toLocaleLowerCase().replaceAll(/\s+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// SQL clause construction (pure — executed by store-persistence.ts)
// ---------------------------------------------------------------------------

export function buildListFilter(
  request: MemoryListRequest,
): { readonly clauses: readonly string[]; readonly params: readonly unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (request.type !== undefined) {
    clauses.push('kind = ?');
    params.push(request.type);
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
  return { clauses, params };
}

export function buildSearchFilter(
  request: MemorySearchRequest,
): { readonly clauses: readonly string[]; readonly params: readonly unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const statuses = allowedStatuses(request);
  clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
  params.push(...statuses);
  if (request.type !== undefined) {
    clauses.push('kind = ?');
    params.push(request.type);
  }
  if (request.types !== undefined && request.types.length > 0) {
    clauses.push(`kind IN (${request.types.map(() => '?').join(', ')})`);
    params.push(...request.types);
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
  if (request.asOf !== undefined) {
    clauses.push('recorded_at <= ?');
    params.push(request.asOf);
    clauses.push('(valid_from IS NULL OR valid_from <= ?)');
    params.push(request.asOf);
    clauses.push('(valid_to IS NULL OR valid_to > ?)');
    params.push(request.asOf);
    if (request.includeDeleted !== true) {
      clauses.push('(invalid_at IS NULL OR invalid_at > ?)');
      params.push(request.asOf);
    }
  }
  return { clauses, params };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreMemory(
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
    lexical * 0.45 +
      memory.importance * 0.2 +
      memory.confidence * 0.15 +
      recency * 0.1 +
      frequency * 0.1,
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

export function queryTerms(query: string): readonly string[] {
  return query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

export function toFtsQuery(query: string): string | undefined {
  const terms = queryTerms(query).slice(0, 8);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

export function escapeLike(query: string): string {
  return query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

// ---------------------------------------------------------------------------
// Create-input normalization
// ---------------------------------------------------------------------------

export function normalizeCreateInput(
  input: MemoryCreateInput,
  subject: string,
  content: string,
  now: number,
): MemoryRecord {
  assertMemoryType(input.type);
  const scope = input.scope ?? 'user';
  assertMemoryScope(scope);
  if (scope !== 'user' && (input.scopeKey === undefined || input.scopeKey.trim().length === 0)) {
    throw new Error(`Memory ${scope} scope requires a scopeKey.`);
  }
  const source = input.source ?? { kind: 'user' };
  if ((input.evidenceRefs ?? []).some((ref) => !isMemoryEvidenceRefLike(ref))) {
    throw new Error('Memory evidenceRefs contains an invalid reference.');
  }
  if ((input.links ?? []).some((link) => !isMemoryLinkLike(link))) {
    throw new Error('Memory links contains an invalid link.');
  }
  const status = source.kind === 'auto' ? 'candidate' : input.status ?? 'active';
  return stripUndefined({
    id: randomUUID(),
    type: input.type,
    epistemic: input.epistemic ?? (source.kind === 'auto' ? 'inferred' : 'direct'),
    scope,
    scopeKey: scope === 'user' ? undefined : input.scopeKey,
    subject,
    content,
    tags: normalizeTags(input.tags ?? []),
    confidence: clamp01(input.confidence ?? 0.85),
    importance: clamp01(input.importance ?? 0.55),
    status,
    source,
    createdAt: now,
    updatedAt: now,
    recordedAt: now,
    accessedAt: undefined,
    accessCount: 0,
    validFrom: input.validFrom,
    validTo: input.validTo,
    invalidAt: undefined,
    supersedes: [],
    supersededBy: undefined,
    evidenceRefs: input.evidenceRefs ?? [],
    links: input.links ?? [],
    metadata: sanitizeMetadata(input.metadata ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Turn-capture candidate extraction
// ---------------------------------------------------------------------------

export function contentPartsToText(parts: readonly import('@superliora/kosong').ContentPart[]): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter((text) => text.length > 0)
    .join('\n');
}

export function extractMemoryCandidates(
  text: string,
  context: MemoryRuntimeAgentContext,
  input: MemoryTurnCaptureInput,
  config: LioraMemoryConfig | undefined,
): readonly MemoryCreateInput[] {
  const captures: MemoryCreateInput[] = [];
  const captureMode = config?.captureMode ?? 'explicit';
  for (const explicit of explicitMemorySentences(text)) {
    captures.push({
      type: explicit.type,
      epistemic: explicit.epistemic,
      scope: explicit.scope,
      scopeKey: defaultScopeKey(explicit.scope, context),
      subject: summarizeSubject(explicit.content),
      content: explicit.content,
      tags: explicit.tags,
      confidence: 0.92,
      importance: explicit.type === 'procedure' ? 0.85 : 0.72,
      status: 'candidate',
      source: {
        kind: 'auto',
        sessionId: context.sessionId,
        agentId: context.agentId,
        turnId: input.turnId,
        excerpt: excerpt(text),
      },
      links: [
        {
          targetKind: 'run',
          targetId: context.sessionId,
          relation: 'captured-in-session',
          confidence: 1,
          source: { kind: 'auto', sessionId: context.sessionId, agentId: context.agentId, turnId: input.turnId },
        },
      ],
      metadata: {
        capture: 'explicit',
        captureSignal: explicit.signal,
        captureUtility: explicit.utility,
      },
    });
  }
  if (
    captures.length === 0 &&
    captureMode === 'candidate' &&
    shouldCaptureEpisode(text, input.reason)
  ) {
    captures.push({
      type: 'event',
      epistemic: 'summary',
      scope: 'workspace',
      scopeKey: context.workDir,
      subject: summarizeSubject(text),
      content: truncate(text, 1_200),
      tags: inferTags(text),
      confidence: 0.65,
      importance: 0.48,
      status: 'candidate',
      source: {
        kind: 'auto',
        sessionId: context.sessionId,
        agentId: context.agentId,
        turnId: input.turnId,
        excerpt: excerpt(text),
      },
      links: [
        {
          targetKind: 'run',
          targetId: context.sessionId,
          relation: 'captured-in-session',
          confidence: 1,
          source: { kind: 'auto', sessionId: context.sessionId, agentId: context.agentId, turnId: input.turnId },
        },
      ],
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
    readonly type: MemoryType;
    readonly epistemic: MemoryEpistemic;
    readonly scope: MemoryScope;
    readonly tags: readonly string[];
    readonly signal: string;
    readonly utility: number;
  }[] = [
    {
      regex: /(?:기억해줘|기억해|메모해줘|메모해|remember(?: that)?|note(?: that)?)[:\s]+(.+)/giu,
      type: 'fact',
      epistemic: 'direct',
      scope: 'user',
      tags: ['explicit'],
      signal: 'explicit-request',
      utility: 0.74,
    },
    {
      regex: /(?:앞으로|from now on|always|prefer|선호|취향)[:\s,]+(.+)/giu,
      type: 'procedure',
      epistemic: 'preference',
      scope: 'user',
      tags: ['preference'],
      signal: 'preference-directive',
      utility: 0.86,
    },
    {
      regex: /(?:remind me|리마인드해줘|알려줘)[:\s]+(.+)/giu,
      type: 'task',
      epistemic: 'direct',
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
          type: pattern.type,
          epistemic: pattern.epistemic,
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

export function defaultScopeForType(type: MemoryType): MemoryScope {
  if (type === 'event') return 'workspace';
  return 'user';
}

export function defaultScopeKey(scope: MemoryScope, context: MemoryRuntimeAgentContext): string | undefined {
  if (scope === 'workspace') return context.workDir;
  if (scope === 'session') return context.sessionId;
  return undefined;
}

function normalizeMemorySentence(value: string): string {
  return value
    .split(/\n{2,}/u, 1)[0]
    ?.replace(/[`"'""'']+$/u, '')
    .trim() ?? '';
}

function summarizeSubject(text: string): string {
  return truncate(text.replaceAll(/\s+/gu, ' ').trim(), 96);
}

function excerpt(text: string): string {
  return truncate(text.replaceAll(/\s+/gu, ' ').trim(), 240);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function inferTags(text: string): readonly string[] {
  const tags = new Set<string>();
  if (/test|테스트/iu.test(text)) tags.add('test');
  if (/bug|fix|버그|수정/iu.test(text)) tags.add('bugfix');
  if (/implement|구현/iu.test(text)) tags.add('implementation');
  if (/config|설정/iu.test(text)) tags.add('config');
  return [...tags].slice(0, 6);
}
