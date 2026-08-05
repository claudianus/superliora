/**
 * Markdown mirror helpers for Liora Memory persistence — extracted from
 * `store-persistence.ts`.
 *
 * Owns the base64-embedded JSON record format under `records/*.md`. The
 * SQLite engine in `store-persistence.ts` calls these for mirror read/write
 * and restore; nothing here touches the database directly.
 */

import { readFileSync } from 'node:fs';

import {
  clamp01,
  isMemoryEvidenceRefLike,
  isMemoryLinkLike,
  isMemoryRecordLike,
  isMemorySourceRefLike,
  normalizeTags,
  parseMemoryType,
  sanitizeMetadata,
  stripUndefined,
} from './store-query';
import type { MemoryRecord, MemorySourceRef } from './types';

const MARKDOWN_RECORD_SCHEMA_VERSION = 2;
const MARKDOWN_RECORD_MARKER = 'liora-memory-record-json-base64';
const LEGACY_MARKDOWN_RECORD_MARKER = 'kimi-recall-record-json-base64';
const SYSTEM_MEMORY_SOURCE: MemorySourceRef = { kind: 'system' };

export function readMarkdownRecord(path: string): MemoryRecord | undefined {
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

export function renderMarkdownRecord(record: MemoryRecord): string {
  const encoded = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
  const lines = [
    '---',
    `schema_version: ${MARKDOWN_RECORD_SCHEMA_VERSION}`,
    `id: ${record.id}`,
    `type: ${record.type}`,
    `scope: ${record.scope}`,
    `status: ${record.status}`,
    '---',
    '',
    `# ${singleLine(record.subject)}`,
    '',
    `- id: ${record.id}`,
    `- type: ${record.type}`,
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

export function memoryRecordFileStem(id: string): string {
  return `memory_${Buffer.from(id, 'utf8').toString('base64url')}`;
}

function normalizeMarkdownRecord(value: unknown): MemoryRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const source = isMemorySourceRefLike(candidate['source']) ? candidate['source'] : SYSTEM_MEMORY_SOURCE;
  const createdAt = typeof candidate['createdAt'] === 'number' ? candidate['createdAt'] : Date.now();
  const normalized = {
    ...candidate,
    type: parseMemoryType(
      typeof candidate['type'] === 'string'
        ? candidate['type']
        : typeof candidate['kind'] === 'string'
          ? candidate['kind']
          : 'fact',
    ),
    epistemic:
      candidate['epistemic'] === 'direct' ||
      candidate['epistemic'] === 'inferred' ||
      candidate['epistemic'] === 'preference' ||
      candidate['epistemic'] === 'summary'
        ? candidate['epistemic']
        : source.kind === 'auto'
          ? 'inferred'
          : 'direct',
    recordedAt: typeof candidate['recordedAt'] === 'number' ? candidate['recordedAt'] : createdAt,
    evidenceRefs: Array.isArray(candidate['evidenceRefs'])
      ? candidate['evidenceRefs'].filter(isMemoryEvidenceRefLike)
      : [],
    links: Array.isArray(candidate['links'])
      ? candidate['links'].filter(isMemoryLinkLike)
      : [],
  };
  if (!isMemoryRecordLike(normalized)) return undefined;
  return stripUndefined({
    id: normalized.id,
    type: normalized.type,
    epistemic: normalized.epistemic,
    scope: normalized.scope,
    scopeKey: typeof normalized.scopeKey === 'string' ? normalized.scopeKey : undefined,
    subject: normalized.subject,
    content: normalized.content,
    tags: normalizeTags(normalized.tags),
    confidence: clamp01(normalized.confidence),
    importance: clamp01(normalized.importance),
    status: normalized.status,
    source,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    recordedAt: normalized.recordedAt,
    accessedAt: typeof normalized.accessedAt === 'number' ? normalized.accessedAt : undefined,
    accessCount: Number.isFinite(normalized.accessCount) ? normalized.accessCount : 0,
    validFrom: typeof normalized.validFrom === 'number' ? normalized.validFrom : undefined,
    validTo: typeof normalized.validTo === 'number' ? normalized.validTo : undefined,
    invalidAt: typeof normalized.invalidAt === 'number' ? normalized.invalidAt : undefined,
    supersedes: Array.isArray(normalized.supersedes)
      ? normalized.supersedes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    supersededBy: typeof normalized.supersededBy === 'string' ? normalized.supersededBy : undefined,
    evidenceRefs: normalized.evidenceRefs,
    links: normalized.links,
    metadata: sanitizeMetadata(
      typeof normalized.metadata === 'object' && normalized.metadata !== null && !Array.isArray(normalized.metadata)
        ? normalized.metadata as Record<string, unknown>
        : {},
    ),
  });
}

function markdownRecordRegex(): RegExp {
  return new RegExp(
    `\\n<!-- (?:${MARKDOWN_RECORD_MARKER}|${LEGACY_MARKDOWN_RECORD_MARKER}):([A-Za-z0-9_-]+) -->\\n?$`,
  );
}

function singleLine(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim() || '(untitled)';
}
