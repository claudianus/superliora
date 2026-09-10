import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearProviderUsageCache,
  OAuthProviderManager,
} from '@superliora/oauth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness } from '#/index';

import { TEST_IDENTITY } from './test-identity';

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-quota-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearProviderUsageCache();
  await rm(homeDir, { recursive: true, force: true });
});

describe('LioraHarness.auth getAllProvidersUsage with an OAuth account pool', () => {
  it('fetches one quota snapshot per pool account with labels and primary marker', async () => {
    await writeFile(
      join(homeDir, 'config.toml'),
      [
        '[providers.openai-codex]',
        'type = "openai"',
        'api_key = ""',
        '',
        '[providers.openai-codex.oauth]',
        'storage = "file"',
        'key = "codex-a"',
        'label = "Alpha"',
        '',
        '[[providers.openai-codex.oauths]]',
        'storage = "file"',
        'key = "codex-b"',
        'label = "Beta"',
        '',
      ].join('\n'),
    );

    const tokenForStorageKey = new Map<string, string>([
      ['codex-a', 'token-alpha'],
      ['codex-b', 'token-beta'],
    ]);
    const ensureFresh = vi
      .spyOn(OAuthProviderManager.prototype, 'ensureFresh')
      .mockImplementation(async (_providerId, options) => {
        const storageKey = options?.storageKey ?? 'codex-a';
        const token = tokenForStorageKey.get(storageKey);
        if (token === undefined) throw new Error('no token');
        return token;
      });

    const fetchSpy = vi.fn(async (_input: Parameters<typeof fetch>[0]) =>
      new Response(
        JSON.stringify({
          plan_type: 'plus',
          email: 'account@example.com',
          rate_limit: {
            primary_window: {
              used_percent: 61,
              limit_window_seconds: 5 * 3600,
            },
            secondary_window: {
              used_percent: 42,
              reset_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
              limit_window_seconds: 7 * 24 * 3600,
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });
    const quota = await harness.auth.getAllProvidersUsage({ refresh: true });

    expect(ensureFresh.mock.calls.map((call) => call[1]?.storageKey)).toEqual([
      'codex-a',
      'codex-b',
    ]);
    expect(quota.providers).toHaveLength(2);
    expect(quota.providers[0]).toMatchObject({
      providerKey: 'openai-codex',
      accountKey: 'codex-a',
      accountLabel: 'Alpha',
      isPrimary: true,
      plan: 'plus',
    });
    expect(quota.providers[1]).toMatchObject({
      providerKey: 'openai-codex',
      accountKey: 'codex-b',
      accountLabel: 'Beta',
      isPrimary: false,
    });
    expect(quota.providers[0]!.summary).toMatchObject({ label: 'Weekly limit', used: 42 });
    // One WHAM request per pool account.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
