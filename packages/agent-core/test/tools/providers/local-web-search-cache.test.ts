/**
 * Covers: LocalResearchCache expired-row prune and live-row cap on write.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalResearchCache } from '../../../src/tools/providers/local-web-search-cache';
import type { WebSearchResult } from '../../../src/tools/builtin/web/web-search';

const hit = (id: string): WebSearchResult => ({
  title: id,
  url: `https://example.com/${id}`,
  snippet: id,
});

describe('LocalResearchCache prune', () => {
  const dirs: string[] = [];
  const caches: LocalResearchCache[] = [];

  afterEach(async () => {
    for (const cache of caches.splice(0)) {
      cache.close();
    }
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function openCache(maxRows = 8): Promise<LocalResearchCache> {
    const dir = await mkdtemp(join(tmpdir(), 'liora-research-cache-'));
    dirs.push(dir);
    const cache = new LocalResearchCache(join(dir, 'search.sqlite'), { maxRows });
    caches.push(cache);
    return cache;
  }

  it('deletes expired rows on the next write, not on a fresh miss', async () => {
    const cache = await openCache();
    cache.set('old', 'old query', [hit('old')], 10, 0);

    expect(cache.get('old', 100, { allowStale: false })).toBeUndefined();
    expect(cache.get('old', 100, { allowStale: true })?.[0]?.url).toBe('https://example.com/old');

    cache.set('fresh', 'fresh query', [hit('fresh')], 1_000, 100);

    expect(cache.get('old', 100, { allowStale: true })).toBeUndefined();
    expect(cache.get('fresh', 100, { allowStale: false })?.[0]?.url).toBe('https://example.com/fresh');
  });

  it('caps live rows to the newest maxRows after a write', async () => {
    const cache = await openCache(2);
    cache.set('a', 'a', [hit('a')], 1_000, 1);
    cache.set('b', 'b', [hit('b')], 1_000, 2);
    cache.set('c', 'c', [hit('c')], 1_000, 3);

    expect(cache.get('a', 3, { allowStale: false })).toBeUndefined();
    expect(cache.get('b', 3, { allowStale: false })?.[0]?.url).toBe('https://example.com/b');
    expect(cache.get('c', 3, { allowStale: false })?.[0]?.url).toBe('https://example.com/c');
  });

  it('keeps close() idempotent so a later open can read the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liora-research-cache-'));
    dirs.push(dir);
    const path = join(dir, 'search.sqlite');
    const cache = new LocalResearchCache(path, { maxRows: 8 });
    cache.set('k', 'k', [hit('k')], 1_000, 1);
    cache.close();
    cache.close();

    const reopened = new LocalResearchCache(path, { maxRows: 8 });
    caches.push(reopened);
    expect(reopened.get('k', 1, { allowStale: false })?.[0]?.url).toBe('https://example.com/k');
  });
});
