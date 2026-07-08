/**
 * Disk-backed cache for the models.dev provider catalog.
 *
 * Mirrors opencode's approach: a JSON file under the app cache dir with a
 * short TTL, written atomically. When the network is unreachable or the cache
 * is fresh, callers reuse the on-disk snapshot so the provider picker stays
 * fast. A build-time snapshot (`BUILT_IN_CATALOG_JSON`) is the last-resort
 * fallback so the picker still works fully offline.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  loadBuiltInCatalog,
  type Catalog,
} from '@superliora/sdk';

import { BUILT_IN_CATALOG_JSON } from '#/built-in-catalog';
import { getCacheDir } from '#/utils/paths';

const CATALOG_CACHE_FILE = 'models-dev-catalog.json';
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

export class CatalogCacheError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'CatalogCacheError';
  }
}

function cachePath(): string {
  return join(getCacheDir(), CATALOG_CACHE_FILE);
}

function isFreshCache(ageMs: number): boolean {
  return ageMs < CATALOG_CACHE_TTL_MS;
}

async function readCachedCatalog(): Promise<Catalog | undefined> {
  try {
    const raw = await readFile(cachePath(), 'utf8');
    return loadBuiltInCatalog(raw);
  } catch {
    return undefined;
  }
}

async function writeCachedCatalog(catalog: Catalog): Promise<void> {
  try {
    const path = cachePath();
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(catalog), { mode: 0o600 });
    await rename(tmp, path);
  } catch {
    // Caching is best-effort; never let a write failure break the picker.
  }
}

/**
 * Loads the catalog with a disk cache in front of the network fetch.
 *
 * Resolution order:
 *   1. Fresh on-disk cache (within {@link CATALOG_CACHE_TTL_MS}) → returned.
 *   2. Network fetch from {@link DEFAULT_CATALOG_URL} → cached and returned.
 *   3. Stale on-disk cache (any age) → returned when the network fails.
 *   4. Build-time snapshot (`BUILT_IN_CATALOG_JSON`) → last-resort fallback.
 *
 * Throws {@link CatalogCacheError} only when every source is unavailable.
 */
export async function loadCatalog(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Catalog> {
  const cached = await readCachedCatalog();
  let cacheAge = Number.POSITIVE_INFINITY;
  if (cached !== undefined) {
    try {
      const stats = await stat(cachePath());
      cacheAge = Date.now() - stats.mtimeMs;
    } catch {
      // Treat an unreadable mtime as stale.
    }
    if (isFreshCache(cacheAge)) {
      return cached;
    }
  }

  try {
    const catalog = await fetchCatalog(DEFAULT_CATALOG_URL, signal, fetchImpl);
    await writeCachedCatalog(catalog);
    return catalog;
  } catch (error) {
    if (cached !== undefined) return cached;
    const builtIn = loadBuiltInCatalog(BUILT_IN_CATALOG_JSON);
    if (builtIn !== undefined) return builtIn;
    if (error instanceof CatalogFetchError) {
      throw new CatalogCacheError(
        `Catalog unavailable (HTTP ${error.status}) and no cached snapshot.`,
        { cause: error },
      );
    }
    throw new CatalogCacheError(
      'Catalog unavailable and no cached snapshot.',
      { cause: error },
    );
  }
}
