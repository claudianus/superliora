/**
 * Covers: browser channel escalate stub on empty paid/free results.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HintBrowserSearchChannel,
  ResearchSearchEngine,
  UnavailableBrowserSearchChannel,
  type BrowserSearchChannel,
} from '../../../src/tools/providers/research-search';

describe('ResearchSearchEngine browser escalate', () => {
  beforeEach(() => {
    process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK = '1';
  });

  afterEach(() => {
    delete process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK;
  });

  it('calls browser channel once when paid and free return empty', async () => {
    const search = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([]);
    const browserChannel: BrowserSearchChannel = {
      available: () => true,
      search,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.search.brave.com')) {
        return new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('duckduckgo.com/html')) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel,
      search: {
        strategy: 'auto',
        freeFallback: true,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('empty query', { limit: 3 });
    expect(results).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('empty query', 3);
    expect(engine.status().browser).toEqual({
      configured: true,
      ready: true,
      escalateAttempted: undefined,
    });
  });

  it('skips browser channel when unavailable', async () => {
    const search = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([]);
    const browserChannel: BrowserSearchChannel = {
      available: () => false,
      search,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    await engine.search('empty query', { limit: 2 });
    expect(search).not.toHaveBeenCalled();
    expect(engine.status().browser).toEqual({
      configured: true,
      ready: false,
      escalateAttempted: undefined,
    });
  });

  it('records escalate attempts via HintBrowserSearchChannel status', async () => {
    const browserChannel = new HintBrowserSearchChannel(true);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    expect(engine.status().browser).toEqual({
      configured: true,
      ready: true,
      escalateAttempted: false,
    });

    await engine.search('empty query', { limit: 2 });

    expect(engine.status().browser).toEqual({
      configured: true,
      ready: true,
      escalateAttempted: true,
    });
  });

  it('reports browser channel as unconfigured by default', () => {
    const engine = new ResearchSearchEngine();
    expect(engine.status().browser).toEqual({
      configured: false,
      ready: false,
      escalateAttempted: undefined,
    });
    expect(new UnavailableBrowserSearchChannel().available()).toBe(false);
  });
});
