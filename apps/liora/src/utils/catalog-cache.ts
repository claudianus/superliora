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
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  loadBuiltInCatalog,
  type Catalog,
} from '@superliora/sdk';

import { BUILT_IN_CATALOG_JSON } from '#/built-in-catalog';
import { mergeLocalCatalogProviders } from '#/utils/local-catalog-providers';
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

const OPENROUTER_CATALOG_URL = 'https://openrouter.ai/api/v1/models';

async function fetchOpenRouterCatalog(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Catalog | undefined> {
  try {
    const res = await fetchImpl(OPENROUTER_CATALOG_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[]; output_modalities?: string[] };
        supported_parameters?: string[];
      }>;
    };
    const data = json.data;
    if (!Array.isArray(data) || data.length === 0) return undefined;
    const models: Record<string, NonNullable<Catalog[string]['models']>[string]> = {};
    for (const m of data) {
      if (typeof m.id !== 'string' || m.id.length === 0) continue;
      const ctx = typeof m.context_length === 'number' && m.context_length > 0 ? m.context_length : undefined;
      const prompt = m.pricing?.prompt !== undefined ? Number(m.pricing.prompt) : undefined;
      const completion = m.pricing?.completion !== undefined ? Number(m.pricing.completion) : undefined;
      const cost =
        prompt !== undefined && Number.isFinite(prompt) && completion !== undefined && Number.isFinite(completion)
          ? { input: prompt * 1_000_000, output: completion * 1_000_000 }
          : undefined;
      const supportedParams = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      const hasTools = supportedParams.includes('tools');
      models[m.id] = {
        id: m.id,
        name: typeof m.name === 'string' && m.name.length > 0 ? m.name : undefined,
        limit: ctx !== undefined ? { context: ctx } : undefined,
        tool_call: hasTools ? true : undefined,
        // OpenRouter advertises reasoning support via the `reasoning`
        // parameter; without this the fallback catalog shows every model as
        // non-reasoning while models.dev is down.
        reasoning: supportedParams.includes('reasoning') ? true : undefined,
        modalities: undefined,
        cost,
      };
    }
    if (Object.keys(models).length === 0) return undefined;
    return {
      openrouter: {
        id: 'openrouter',
        name: 'OpenRouter',
        api: 'https://openrouter.ai/api/v1',
        env: ['OPENROUTER_API_KEY'],
        npm: '@openrouter/ai-sdk-provider',
        type: 'openai',
        doc: 'https://openrouter.ai/docs',
        models,
      },
    } satisfies Catalog;
  } catch {
    return undefined;
  }
}

/**
 * Loads the catalog with a disk cache in front of the network fetch.
 *
 * Resolution order:
 *   1. Fresh on-disk cache (within {@link CATALOG_CACHE_TTL_MS}) → returned.
 *   2. Network fetch from {@link DEFAULT_CATALOG_URL} → cached and returned.
 *   3. Live OpenRouter fallback (`https://openrouter.ai/api/v1/models`) → cached and returned.
 *   4. Stale on-disk cache (any age) → returned when the network fails.
 *   5. Build-time snapshot (`BUILT_IN_CATALOG_JSON`) → last-resort fallback.
 *
 * SuperLiora-curated providers (e.g. ClinePass) are always merged after the
 * models.dev snapshot so they appear even when offline. The on-disk cache
 * stores only the remote snapshot so local entry updates take effect without
 * waiting for the TTL.
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
      return mergeLocalCatalogProviders(cached);
    }
  }

  try {
    const catalog = await fetchCatalog(DEFAULT_CATALOG_URL, signal, fetchImpl);
    await writeCachedCatalog(catalog);
    return mergeLocalCatalogProviders(catalog);
  } catch {
    // Live OpenRouter fallback when models.dev is down (no hard-coded model lists)
    try {
      const openRouter = await fetchOpenRouterCatalog(signal, fetchImpl);
      if (openRouter !== undefined) {
        await writeCachedCatalog(openRouter);
        return mergeLocalCatalogProviders(openRouter);
      }
    } catch {
      // fall through to disk cache
    }
    if (cached !== undefined) return mergeLocalCatalogProviders(cached);
    const builtIn = loadBuiltInCatalog(BUILT_IN_CATALOG_JSON);
    if (builtIn !== undefined) return mergeLocalCatalogProviders(builtIn);
    // Last resort: still surface curated provider shells (now without hard-coded models)
    // so /login can still show the provider row even fully offline.
    return mergeLocalCatalogProviders({});
  }
}
