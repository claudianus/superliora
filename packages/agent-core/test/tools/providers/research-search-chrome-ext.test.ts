/**
 * Covers: Ch5 Chrome extension search bridge stub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHROME_EXT_BRIDGE_ENV,
  CHROME_EXT_URL_ENV,
  ChromeExtensionSearchChannel,
  buildChromeExtensionBridgeStatus,
  chromeExtensionDegradeHint,
  createChromeExtensionSearchChannel,
  DEFAULT_CHROME_EXT_BRIDGE_URL,
  isChromeExtensionBridgeEnabled,
  resolveChromeExtensionBridgeUrl,
} from '../../../src/tools/providers/research-search-chrome-ext';
import {
  ResearchSearchEngine,
  type BrowserSearchChannel,
} from '../../../src/tools/providers/research-search';
import { inferSearchChannelsFromStatus } from '../../../src/tools/providers/research-search-health';

describe('ChromeExtensionSearchChannel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports disabled bridge status when env is unset', () => {
    expect(buildChromeExtensionBridgeStatus({} as NodeJS.ProcessEnv)).toMatchObject({
      configured: true,
      enabled: false,
      ready: false,
      nativeHost: { handshake: 'off' },
      hint: expect.stringContaining(CHROME_EXT_BRIDGE_ENV),
    });
    const channel = new ChromeExtensionSearchChannel({ env: {} as NodeJS.ProcessEnv });
    expect(channel.available()).toBe(false);
    expect(channel.status().enabled).toBe(false);
    expect(isChromeExtensionBridgeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('reports enabled bridge status when env is set', () => {
    const env = { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    expect(buildChromeExtensionBridgeStatus(env)).toMatchObject({
      configured: true,
      enabled: true,
      ready: true,
      bridgeUrl: DEFAULT_CHROME_EXT_BRIDGE_URL,
      nativeHost: { handshake: 'env-gated' },
      hint: expect.stringContaining('native host'),
    });
    const channel = new ChromeExtensionSearchChannel({ env });
    expect(channel.available()).toBe(true);
    expect(channel.status().enabled).toBe(true);
    expect(resolveChromeExtensionBridgeUrl(env)).toBe(DEFAULT_CHROME_EXT_BRIDGE_URL);
  });

  it('is unavailable by default', () => {
    const channel = new ChromeExtensionSearchChannel({ env: {} as NodeJS.ProcessEnv });
    expect(channel.available()).toBe(false);
  });

  it('is available when bridge env is enabled', () => {
    const env = { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    const channel = new ChromeExtensionSearchChannel({ env });
    expect(channel.available()).toBe(true);
  });

  it('respects custom bridge URL env', () => {
    const env = {
      [CHROME_EXT_BRIDGE_ENV]: '1',
      [CHROME_EXT_URL_ENV]: 'http://127.0.0.1:40000/search',
    } as NodeJS.ProcessEnv;
    expect(resolveChromeExtensionBridgeUrl(env)).toBe('http://127.0.0.1:40000/search');
  });

  it('returns [] without calling fetch when unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const channel = new ChromeExtensionSearchChannel({
      env: {} as NodeJS.ProcessEnv,
      fetchImpl,
    });
    await expect(channel.search('query', 3)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses bridge JSON on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Example',
              url: 'https://example.com/page',
              snippet: 'An authenticated hit',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const channel = new ChromeExtensionSearchChannel({
      env: { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
    });

    const results = await channel.search('example query', 5);
    expect(results).toEqual([
      {
        title: 'Example',
        url: 'https://example.com/page',
        snippet: '[chrome-ext] An authenticated hit',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      DEFAULT_CHROME_EXT_BRIDGE_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'example query', limit: 5 }),
      }),
    );
  });

  it('never throws on network or parse failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'));
    const channel = new ChromeExtensionSearchChannel({
      env: { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
    });
    await expect(channel.search('query', 2)).resolves.toEqual([]);
  });

  it('returns [] on non-OK HTTP responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('bad gateway', { status: 502 }),
    );
    const channel = new ChromeExtensionSearchChannel({
      env: { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
    });
    await expect(channel.search('query', 2)).resolves.toEqual([]);
  });

  it('returns [] on malformed JSON payloads', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ hits: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const channel = new ChromeExtensionSearchChannel({
      env: { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
    });
    await expect(channel.search('query', 2)).resolves.toEqual([]);
  });

  it('records escalateAttempted after bridge search', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const channel = new ChromeExtensionSearchChannel({
      env: { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
    });
    expect(channel.escalateAttempted).toBe(false);
    await channel.search('query', 2);
    expect(channel.escalateAttempted).toBe(true);
  });

  it('factory returns BrowserSearchChannel instance', () => {
    expect(createChromeExtensionSearchChannel()).toBeInstanceOf(ChromeExtensionSearchChannel);
  });

  it('exposes soft degrade hint for never-empty path', () => {
    expect(chromeExtensionDegradeHint()).toContain('Chrome extension');
  });
});

describe('ResearchSearchEngine chrome extension escalate', () => {
  beforeEach(() => {
    process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK = '1';
  });

  afterEach(() => {
    delete process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK;
  });
  it('escalates to Ch5 after browser returns empty', async () => {
    const browserSearch = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([]);
    const chromeSearch = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([
      {
        title: 'Logged-in hit',
        url: 'https://app.example.com/doc',
        snippet: '[chrome-ext] from extension',
      },
    ]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel: { available: () => true, search: browserSearch },
      chromeExtensionChannel: { available: () => true, search: chromeSearch },
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    const results = await engine.search('empty query', { limit: 2 });
    expect(results).toHaveLength(1);
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(chromeSearch).toHaveBeenCalledTimes(1);
    expect(chromeSearch).toHaveBeenCalledWith('empty query', 2);
    expect(engine.status().chromeExtension).toEqual({
      configured: true,
      enabled: true,
      ready: true,
      escalateAttempted: true,
    });
    expect(inferSearchChannelsFromStatus(engine.status())).toContain('ch5');
  });

  it('skips Ch5 when browser already returned hits', async () => {
    const browserSearch = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([
      { title: 'Browser hit', url: 'https://example.com', snippet: 'browser' },
    ]);
    const chromeSearch = vi.fn<BrowserSearchChannel['search']>().mockResolvedValue([]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel: { available: () => true, search: browserSearch },
      chromeExtensionChannel: { available: () => true, search: chromeSearch },
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    const results = await engine.search('empty query', { limit: 2 });
    expect(results).toHaveLength(1);
    expect(chromeSearch).not.toHaveBeenCalled();
  });

  it('reports chrome extension as unconfigured by default', () => {
    const engine = new ResearchSearchEngine();
    expect(engine.status().chromeExtension).toEqual({
      configured: false,
      enabled: false,
      ready: false,
    });
  });
});
