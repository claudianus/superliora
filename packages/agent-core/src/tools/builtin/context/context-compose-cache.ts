import { createHash } from 'node:crypto';

import type { Kaos } from '@superliora/kaos';

import { lookupComposeDiskCache, storeComposeDiskCache } from '../../../lean-context/persist/compose-cache';
import type { ToolStore } from '../../store';
import type { WorkspaceConfig } from '../../support/workspace';

export const LIORA_CONTEXT_COMPOSE_CACHE_KEY = 'liora_context_compose_cache' as const;

export interface LioraContextComposeCacheEntry {
  readonly cacheKey: string;
  readonly output: string;
  readonly indexBuiltAt: number;
  readonly createdAt: number;
}

export interface LioraContextComposeCacheState {
  readonly entries: Readonly<Record<string, LioraContextComposeCacheEntry>>;
}

declare module '../../store' {
  interface ToolStoreData {
    liora_context_compose_cache: LioraContextComposeCacheState;
  }
}

const MAX_ENTRIES = 64;

export interface ComposeCacheLookupInput {
  readonly query?: string | undefined;
  readonly mode?: string | undefined;
  readonly maxFiles?: number | undefined;
  readonly maxSymbolsPerFile?: number | undefined;
  readonly paths?: readonly string[] | undefined;
  readonly indexBuiltAt: number;
}

export function composeCacheKey(input: ComposeCacheLookupInput): string {
  const payload = JSON.stringify({
    query: input.query,
    mode: input.mode ?? 'compose',
    maxFiles: input.maxFiles,
    maxSymbolsPerFile: input.maxSymbolsPerFile,
    paths: input.paths?.toSorted(),
    indexBuiltAt: input.indexBuiltAt,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function emptyCache(): LioraContextComposeCacheState {
  return { entries: {} };
}

function getComposeCache(store: ToolStore): LioraContextComposeCacheState {
  return store.get(LIORA_CONTEXT_COMPOSE_CACHE_KEY) ?? emptyCache();
}

function setComposeCache(store: ToolStore, state: LioraContextComposeCacheState): void {
  store.set(LIORA_CONTEXT_COMPOSE_CACHE_KEY, state);
}

export function lookupComposeCache(
  store: ToolStore | undefined,
  input: ComposeCacheLookupInput,
): string | undefined {
  if (store === undefined) return undefined;
  const key = composeCacheKey(input);
  const entry = getComposeCache(store).entries[key];
  if (entry === undefined) return undefined;
  if (entry.indexBuiltAt !== input.indexBuiltAt) return undefined;
  return entry.output;
}

export function storeComposeCache(
  store: ToolStore | undefined,
  input: ComposeCacheLookupInput,
  output: string,
): void {
  if (store === undefined) return;
  const key = composeCacheKey(input);
  const entry: LioraContextComposeCacheEntry = {
    cacheKey: key,
    output,
    indexBuiltAt: input.indexBuiltAt,
    createdAt: Date.now(),
  };
  const entries = { ...getComposeCache(store).entries, [key]: entry };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    const trimmed = keys
      .map((id) => entries[id])
      .filter((item): item is LioraContextComposeCacheEntry => item !== undefined)
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .slice(keys.length - MAX_ENTRIES);
    const nextEntries: Record<string, LioraContextComposeCacheEntry> = {};
    for (const item of trimmed) nextEntries[item.cacheKey] = item;
    setComposeCache(store, { entries: nextEntries });
    return;
  }
  setComposeCache(store, { entries });
}

export async function resolveComposeCache(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  store: ToolStore | undefined,
  input: ComposeCacheLookupInput,
): Promise<string | undefined> {
  const memory = lookupComposeCache(store, input);
  if (memory !== undefined) return memory;
  const disk = await lookupComposeDiskCache(kaos, workspace, input);
  if (disk === undefined) return undefined;
  storeComposeCache(store, input, disk);
  return disk;
}

export async function persistComposeCache(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  store: ToolStore | undefined,
  input: ComposeCacheLookupInput,
  output: string,
): Promise<void> {
  storeComposeCache(store, input, output);
  await storeComposeDiskCache(kaos, workspace, input, output);
}
