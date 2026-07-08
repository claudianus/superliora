import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCatalog } from '#/utils/catalog-cache';

const SAMPLE_CATALOG = JSON.stringify({
  anthropic: { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'] },
});

function catalogResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loadCatalog', () => {
  let home: string;
  const previousHome = process.env['SUPERLIORA_HOME'];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'liora-catalog-'));
    process.env['SUPERLIORA_HOME'] = home;
  });

  afterEach(() => {
    process.env['SUPERLIORA_HOME'] = previousHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('fetches the catalog and writes it to the cache', async () => {
    const fetchImpl = vi.fn(async () => catalogResponse(SAMPLE_CATALOG));
    const catalog = await loadCatalog(undefined, fetchImpl as unknown as typeof fetch);
    expect(catalog['anthropic']?.name).toBe('Anthropic');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The cache file exists so the next load skips the network.
    const cachePath = join(home, 'cache', 'models-dev-catalog.json');
    expect(() => statSync(cachePath)).not.toThrow();
  });

  it('reuses the fresh on-disk cache without a network fetch', async () => {
    const fetchImpl = vi.fn(async () => catalogResponse(SAMPLE_CATALOG));
    await loadCatalog(undefined, fetchImpl as unknown as typeof fetch);
    await loadCatalog(undefined, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stale cache when the network fails', async () => {
    // Write a cache file directly, then make the network always fail.
    const cacheDir = join(home, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'models-dev-catalog.json'), SAMPLE_CATALOG, {
      mode: 0o600,
    });

    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const catalog = await loadCatalog(undefined, fetchImpl as unknown as typeof fetch);
    expect(catalog['anthropic']?.name).toBe('Anthropic');
  });
});
