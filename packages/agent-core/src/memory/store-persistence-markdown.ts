/**
 * Markdown mirror helpers for Liora Recall persistence — extracted from
 * `store-persistence.ts`.
 *
 * Owns the base64-embedded JSON record format under `records/*.md`. The
 * SQLite engine in `store-persistence.ts` calls these for mirror read/write
 * and restore; nothing here touches the database directly.
 */

import { readFileSync } from 'node:fs';

import {
  clamp01,
  isMemoryRecordLike,
  isMemorySourceRefLike,
  normalizeTags,
  sanitizeMetadata,
  stripUndefined,
} from './store-query';
import type { MemoryRecord, MemorySourceRef } from './types';

const MARKDOWN_RECORD_SCHEMA_VERSION = 1;
const MARKDOWN_RECORD_MARKER = 'kimi-recall-record-json-base64';
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

export function memoryRecordFileStem(id: string): string {
  return `memory_${Buffer.from(id, 'utf8').toString('base64url')}`;
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

function markdownRecordRegex(): RegExp {
  return new RegExp(`\\n<!-- ${MARKDOWN_RECORD_MARKER}:([A-Za-z0-9_-]+) -->\\n?$`);
}

function singleLine(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim() || '(untitled)';
}
