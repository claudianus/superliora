import type { Kaos } from '@superliora/kaos';

import type {
  ComposeCacheLookupInput,
  LioraContextComposeCacheEntry,
} from '../../tools/builtin/context/context-compose-cache';
import { composeCacheKey } from '../../tools/builtin/context/context-compose-cache';
import type { WorkspaceConfig } from '../../tools/support/workspace';
import { workspaceComposeCacheDir } from './paths';
import { readJsonFile, writeJsonFile } from './store';

const MAX_DISK_ENTRIES = 64;

function composeCacheEntryPath(cacheDir: string, cacheKey: string): string {
  return `${cacheDir}/${cacheKey}.json`;
}

export async function lookupComposeDiskCache(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  input: ComposeCacheLookupInput,
): Promise<string | undefined> {
  try {
    const cacheKey = composeCacheKey(input);
    const entry = await readJsonFile<LioraContextComposeCacheEntry>(
      kaos,
      composeCacheEntryPath(workspaceComposeCacheDir(workspace), cacheKey),
    );
    if (entry === undefined) return undefined;
    if (entry.indexBuiltAt !== input.indexBuiltAt) return undefined;
    return entry.output;
  } catch {
    return undefined;
  }
}

export async function storeComposeDiskCache(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  input: ComposeCacheLookupInput,
  output: string,
): Promise<void> {
  try {
    const cacheDir = workspaceComposeCacheDir(workspace);
    const cacheKey = composeCacheKey(input);
    const entry: LioraContextComposeCacheEntry = {
      cacheKey,
      output,
      indexBuiltAt: input.indexBuiltAt,
      createdAt: Date.now(),
    };
    await kaos.mkdir(cacheDir, { parents: true, existOk: true });
    await writeJsonFile(kaos, composeCacheEntryPath(cacheDir, cacheKey), entry);
    await trimComposeDiskCache(kaos, cacheDir);
  } catch {
    // Best-effort: session memory cache still helps when disk persistence is unavailable.
  }
}

async function trimComposeDiskCache(kaos: Kaos, cacheDir: string): Promise<void> {
  const entries: LioraContextComposeCacheEntry[] = [];
  try {
    for await (const name of kaos.iterdir(cacheDir)) {
      if (!name.endsWith('.json')) continue;
      const entry = await readJsonFile<LioraContextComposeCacheEntry>(
        kaos,
        composeCacheEntryPath(cacheDir, name.replace(/\.json$/u, '')),
      );
      if (entry !== undefined) entries.push(entry);
    }
  } catch {
    return;
  }
  if (entries.length <= MAX_DISK_ENTRIES) return;
  const stale = entries.toSorted((a, b) => a.createdAt - b.createdAt).slice(0, entries.length - MAX_DISK_ENTRIES);
  await Promise.all(
    stale.map((entry) =>
      kaos.unlink(composeCacheEntryPath(cacheDir, entry.cacheKey)).catch(() => undefined),
    ),
  );
}
