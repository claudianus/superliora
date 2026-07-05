import { createHash } from 'node:crypto';

import type { ToolStore } from '../../store';

export const LIORA_CONTEXT_ARCHIVE_STORE_KEY = 'liora_context_archive' as const;

export interface LioraArchiveEntry {
  readonly id: string;
  readonly path?: string | undefined;
  readonly label: string;
  readonly content: string;
  readonly createdAt: number;
}

export interface LioraContextArchiveState {
  readonly entries: Readonly<Record<string, LioraArchiveEntry>>;
}

declare module '../../store' {
  interface ToolStoreData {
    liora_context_archive: LioraContextArchiveState;
  }
}

const MAX_ARCHIVE_ENTRIES = 512;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function emptyArchive(): LioraContextArchiveState {
  return { entries: {} };
}

export function getContextArchive(store: ToolStore): LioraContextArchiveState {
  return store.get(LIORA_CONTEXT_ARCHIVE_STORE_KEY) ?? emptyArchive();
}

export function setContextArchive(store: ToolStore, state: LioraContextArchiveState): void {
  store.set(LIORA_CONTEXT_ARCHIVE_STORE_KEY, state);
}

export interface ArchiveContentInput {
  readonly store: ToolStore;
  readonly content: string;
  readonly label: string;
  readonly path?: string | undefined;
}

export interface ArchiveContentResult {
  readonly id: string;
  readonly marker: string;
  readonly summary: string;
}

export function archiveContent(input: ArchiveContentInput): ArchiveContentResult {
  const id = hashContent(input.content);
  const previous = getContextArchive(input.store);
  const entry: LioraArchiveEntry = {
    id,
    path: input.path,
    label: input.label,
    content: input.content,
    createdAt: Date.now(),
  };
  const entries = { ...previous.entries, [id]: entry };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ARCHIVE_ENTRIES) {
    const sorted = keys
      .map((key) => entries[key])
      .filter((item): item is LioraArchiveEntry => item !== undefined)
      .toSorted((a, b) => a.createdAt - b.createdAt);
    const trimmed = sorted.slice(sorted.length - MAX_ARCHIVE_ENTRIES);
    const nextEntries: Record<string, LioraArchiveEntry> = {};
    for (const item of trimmed) nextEntries[item.id] = item;
    setContextArchive(input.store, { entries: nextEntries });
  } else {
    setContextArchive(input.store, { entries });
  }
  return {
    id,
    marker: formatArchiveMarker(id, input.label),
    summary: summarizeArchivedContent(input.content),
  };
}

export function expandArchivedContent(
  store: ToolStore,
  id: string,
): { readonly found: true; readonly entry: LioraArchiveEntry } | { readonly found: false } {
  const entry = getContextArchive(store).entries[id];
  if (entry === undefined) return { found: false };
  return { found: true, entry };
}

export function formatArchiveMarker(id: string, label: string): string {
  return `[liora-archived id=${id} label=${label}]`;
}

function summarizeArchivedContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const charCount = content.length;
  const preview = lines
    .slice(0, 3)
    .map((line) => truncate(line.trim(), 120))
    .filter((line) => line.length > 0)
    .join(' | ');
  return `${String(lineCount)} lines, ${String(charCount)} chars${preview.length > 0 ? `: ${preview}` : ''}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
