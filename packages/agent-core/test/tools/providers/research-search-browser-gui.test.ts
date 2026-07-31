/**
 * Covers: real browser search channel via gui-use runtime.
 */

import type { BrowserUseRuntime } from '@superliora/gui-use';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GuiUseBrowserSearchChannel,
  createBrowserSearchChannel,
  DDG_HTML_BROWSER_SEARCH_URL,
} from '../../../src/tools/providers/research-search-browser-gui';
import {
  HintBrowserSearchChannel,
  ResearchSearchEngine,
} from '../../../src/tools/providers/research-search';

const FIXTURE_HTML = [
  '<html><body>',
  '<div class="result">',
  '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>',
  '<a class="result__snippet">Official docs snippet</a>',
  '</div>',
  '<div class="result">',
  '<a class="result__a" href="https://example.test/blog">Example Blog</a>',
  '<a class="result__snippet">Blog snippet</a>',
  '</div>',
  '</body></html>',
].join('');

function fakeBrowserRuntime(overrides: Partial<BrowserUseRuntime> = {}): BrowserUseRuntime {
  return {
    status: vi.fn().mockResolvedValue({
      platform: 'darwin',
      installed: true,
      ready: true,
    }),
    observe: vi.fn().mockResolvedValue({
      ok: true,
      url: `${DDG_HTML_BROWSER_SEARCH_URL}?q=test`,
      title: 'test at DuckDuckGo',
      snapshot: '',
      refs: [],
    }),
    console: vi.fn().mockResolvedValue({
      ok: true,
      messages: [],
      result: FIXTURE_HTML,
    }),
    screenshot: vi.fn(),
    act: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('GuiUseBrowserSearchChannel', () => {
  it('reports unavailable when runtime is missing', () => {
    const channel = new GuiUseBrowserSearchChannel(undefined);
    expect(channel.available()).toBe(false);
  });

  it('reports available when runtime is present', () => {
    const channel = new GuiUseBrowserSearchChannel(fakeBrowserRuntime());
    expect(channel.available()).toBe(true);
  });

  it('navigates DuckDuckGo HTML and parses fixture results', async () => {
    const runtime = fakeBrowserRuntime();
    const channel = new GuiUseBrowserSearchChannel(runtime);

    const results = await channel.search('example query', 2);

    expect(runtime.status).toHaveBeenCalledWith({ installIfMissing: false }, expect.any(AbortSignal));
    expect(runtime.observe).toHaveBeenCalledWith(
      { url: expect.stringContaining(DDG_HTML_BROWSER_SEARCH_URL) },
      expect.any(AbortSignal),
    );
    const observeUrl = vi.mocked(runtime.observe).mock.calls[0]?.[0]?.url ?? '';
    expect(observeUrl).toContain('q=example+query');
    expect(runtime.console).toHaveBeenCalledWith(
      { expression: 'document.documentElement.outerHTML' },
      expect.any(AbortSignal),
    );
    expect(results).toEqual([
      {
        title: 'Example Docs',
        url: 'https://example.com/docs',
        snippet: '[browser] Official docs snippet',
      },
      {
        title: 'Example Blog',
        url: 'https://example.test/blog',
        snippet: '[browser] Blog snippet',
      },
    ]);
  });

  it('returns empty results when runtime is not ready', async () => {
    const runtime = fakeBrowserRuntime({
      status: vi.fn().mockResolvedValue({ platform: 'darwin', installed: false, ready: false }),
    });
    const channel = new GuiUseBrowserSearchChannel(runtime);

    await expect(channel.search('query', 3)).resolves.toEqual([]);
    expect(runtime.observe).not.toHaveBeenCalled();
  });

  it('returns empty results when observe fails', async () => {
    const runtime = fakeBrowserRuntime({
      observe: vi.fn().mockResolvedValue({
        ok: false,
        url: '',
        title: '',
        snapshot: '',
        refs: [],
        error: 'navigation failed',
      }),
    });
    const channel = new GuiUseBrowserSearchChannel(runtime);

    await expect(channel.search('query', 3)).resolves.toEqual([]);
    expect(runtime.console).not.toHaveBeenCalled();
  });

  it('never throws on runtime errors', async () => {
    const runtime = fakeBrowserRuntime({
      status: vi.fn().mockRejectedValue(new Error('browser offline')),
    });
    const channel = new GuiUseBrowserSearchChannel(runtime);

    await expect(channel.search('query', 3)).resolves.toEqual([]);
  });
});

describe('createBrowserSearchChannel', () => {
  it('uses GuiUseBrowserSearchChannel when runtime is ready', async () => {
    const runtime = fakeBrowserRuntime();
    const channel = await createBrowserSearchChannel(runtime, true);
    expect(channel).toBeInstanceOf(GuiUseBrowserSearchChannel);
    expect(channel.available()).toBe(true);
  });

  it('falls back to HintBrowserSearchChannel when runtime is not ready', async () => {
    const runtime = fakeBrowserRuntime({
      status: vi.fn().mockResolvedValue({ platform: 'darwin', installed: true, ready: false }),
    });
    const channel = await createBrowserSearchChannel(runtime, true);
    expect(channel).toBeInstanceOf(HintBrowserSearchChannel);
    expect(channel.available()).toBe(true);
  });

  it('falls back to HintBrowserSearchChannel when runtime is missing', async () => {
    const channel = await createBrowserSearchChannel(undefined, false);
    expect(channel).toBeInstanceOf(HintBrowserSearchChannel);
    expect(channel.available()).toBe(false);
  });
});

describe('ResearchSearchEngine browser escalate with GuiUseBrowserSearchChannel', () => {
  beforeEach(() => {
    process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK = '1';
  });

  afterEach(() => {
    delete process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK;
  });
  it('returns parsed browser results when paid and free slots are empty', async () => {
    const runtime = fakeBrowserRuntime();
    const browserChannel = new GuiUseBrowserSearchChannel(runtime);
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

    const results = await engine.search('example query', { limit: 2 });

    expect(results).toEqual([
      {
        title: 'Example Docs',
        url: 'https://example.com/docs',
        snippet: '[browser] Official docs snippet',
      },
      {
        title: 'Example Blog',
        url: 'https://example.test/blog',
        snippet: '[browser] Blog snippet',
      },
    ]);
    expect(runtime.observe).toHaveBeenCalledTimes(1);
  });
});
