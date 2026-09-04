import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readApiErrorMessage } from '../src/api-error';
import { startCallbackServer } from '../src/flow/oauth-flow-http';
import { pollOpenAiDeviceToken } from '../src/flow/oauth-flow-openai';
import { OAuthManager } from '../src/flow/oauth-manager';
import { OAuthProviderManager } from '../src/flow/oauth-provider-manager';
import { startProactiveRefreshTimer } from '../src/flow/proactive-refresh';
import { exchangeGitHubCopilotSession } from '../src/profiles/github-copilot';
import { fetchCustomRegistry } from '../src/registry/custom-registry';
import { FileTokenStorage } from '../src/storage';
import { classifyToken } from '../src/token-state';
import {
  EXPERIMENTAL_PROVIDER_PROFILES,
  PROVIDER_PROFILES,
  getProviderProfile,
  isOAuthProviderId,
} from '../src/profiles';
import { OAUTH_PROVIDER_IDS } from '../src/profiles/provider-profile';
import type { TokenInfo } from '../src/types';

function portOf(redirectUri: string): number {
  const match = redirectUri.match(/:(\d+)\//);
  if (match?.[1] === undefined) throw new Error(`no port in ${redirectUri}`);
  return Number(match[1]);
}

describe('oauth provider compat (hermes/opencode/cline parity)', () => {
  it('OAUTH_PROVIDER_IDS covers every registered profile (no stale id list)', () => {
    const registered = new Set([
      ...PROVIDER_PROFILES.map((p) => p.id),
      ...EXPERIMENTAL_PROVIDER_PROFILES.map((entry) => entry.profile.id),
    ]);
    for (const id of OAUTH_PROVIDER_IDS) {
      expect(getProviderProfile(id)).toBeDefined();
    }
    for (const id of registered) {
      expect(
        (OAUTH_PROVIDER_IDS as readonly string[]).includes(id),
        `profile "${id}" missing from OAUTH_PROVIDER_IDS`,
      ).toBe(true);
      expect(isOAuthProviderId(id)).toBe(true);
    }
  });

  it('isolates token files per storage key (multi-account login)', async () => {
    const saved = new Map<string, TokenInfo>();
    const storage = {
      load: async (name: string) => saved.get(name),
      save: async (name: string, token: TokenInfo) => {
        saved.set(name, token);
      },
      remove: async (name: string) => {
        saved.delete(name);
      },
      list: async () => [...saved.keys()],
    };
    const manager = new OAuthProviderManager({ storage });
    // Distinct managers per storage key so parallel logins do not share locks.
    expect(manager.managerFor('openai-codex', 'work')).not.toBe(
      manager.managerFor('openai-codex', 'personal'),
    );
    expect(manager.managerFor('openai-codex', 'work')).toBe(
      manager.managerFor('openai-codex', 'work'),
    );
    expect(manager.storageName('managed:kimi-api')).toBe('kimi-api');
  });

  it('falls back to an ephemeral port when the preferred callback port is busy', async () => {
    const first = await startCallbackServer(0);
    const busyPort = portOf(first.redirectUri);
    const second = await startCallbackServer(busyPort);
    try {
      expect(portOf(second.redirectUri)).not.toBe(busyPort);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('advertises the configured redirect host (xAI registers 127.0.0.1, not localhost)', async () => {
    const server = await startCallbackServer(0, '127.0.0.1');
    try {
      expect(server.redirectUri).toContain('http://127.0.0.1:');
    } finally {
      await server.close();
    }
  });

  it('accepts google-genai custom registries (Gemini custom endpoints)', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          gp: {
            id: 'gp',
            name: 'GP',
            api: 'https://example.test',
            type: 'google-genai',
            models: {},
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    const entries = await fetchCustomRegistry(
      { kind: 'apiJson', url: 'https://example.test/api.json', apiKey: '' },
      fetchImpl,
    );
    expect(entries['gp']?.type).toBe('google-genai');
  });

  it('treats whitespace-only access tokens as revoked (no 401 loop)', () => {
    expect(
      classifyToken({
        accessToken: '   ',
        refreshToken: 'r',
        expiresAt: 9999999999,
        expiresIn: 3600,
        scope: '',
        tokenType: 'Bearer',
      }).kind,
    ).toBe('revoked');
  });

  it('storage list() hides dotfiles that pathFor would reject', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oauth-list-'));
    const storage = new FileTokenStorage(dir);
    await storage.save('work', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 9999999999,
      expiresIn: 3600,
      scope: '',
      tokenType: 'Bearer',
    });
    writeFileSync(join(dir, '.hidden.json'), '{}');
    expect(await storage.list()).toEqual(['work']);
  });

  it('proactive timer never overlaps ticks and survives throwing observers', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let failNext = false;
      const onError = vi.fn(() => {
        throw new Error('observer blew up');
      });
      const handle = startProactiveRefreshTimer(
        () => {
          calls += 1;
          if (failNext) return Promise.reject(new Error('refresh blew up'));
          return gate.then(() => 'tok');
        },
        60_000,
        { onError },
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(calls).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      failNext = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
      expect(onError).toHaveBeenCalledTimes(1);
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats OpenAI device-poll 429 as pending (backs off, keeps waiting)', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async () => {
      seen.push('poll');
      if (seen.length === 1) {
        return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ authorization_code: 'code', code_verifier: 'verifier' }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await pollOpenAiDeviceToken(
        {
          name: 'openai-codex',
          oauthHost: 'https://auth.openai.com',
          clientId: 'cid',
          kind: 'device_code_openai',
        },
        { deviceAuthId: 'd', userCode: 'u', interval: 1, verificationUri: 'v' },
        { sleep: () => Promise.resolve(), timeoutMs: 60_000 },
      );
      expect(result).toEqual({ authorizationCode: 'code', codeVerifier: 'verifier' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts OpenAI device-poll sleep promptly instead of waiting the interval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 403 })),
    );
    try {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 10);
      const started = Date.now();
      await expect(
        pollOpenAiDeviceToken(
          {
            name: 'openai-codex',
            oauthHost: 'https://auth.openai.com',
            clientId: 'cid',
            kind: 'device_code_openai',
          },
          { deviceAuthId: 'd', userCode: 'u', interval: 60, verificationUri: 'v' },
          { signal: controller.signal, timeoutMs: 120_000 },
        ),
      ).rejects.toThrow('Authorization aborted');
      expect(Date.now() - started).toBeLessThan(30_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts a Kimi device login stuck in the poll sleep', async () => {
    const storage = new FileTokenStorage(mkdtempSync(join(tmpdir(), 'oauth-login-')));
    const manager = new OAuthManager({
      config: { name: 'kimi', oauthHost: 'https://example.test', clientId: 'cid' },
      storage,
      requestDeviceImpl: async () => ({
        userCode: 'u',
        deviceCode: 'd',
        verificationUri: 'v',
        verificationUriComplete: 'vc',
        expiresIn: 300,
        interval: 120,
      }),
      pollDeviceImpl: async () => ({
        kind: 'pending',
        errorCode: 'authorization_pending',
        description: '',
      }),
      sleep: () => new Promise<void>(() => {}),
    });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 10);
    await expect(manager.login({ signal: controller.signal })).rejects.toThrow(
      'Login aborted by caller',
    );
  });

  it('propagates the caller signal to the Copilot session exchange', async () => {
    let observed: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      observed = init?.signal;
      return new Response(JSON.stringify({ token: 'tid=abc;exp=9999999999' }), {
        status: 200,
      });
    });
    const controller = new AbortController();
    controller.abort();
    await exchangeGitHubCopilotSession(
      'ghu_user',
      fetchMock as unknown as typeof fetch,
      { signal: controller.signal },
    );
    expect(observed?.aborted).toBe(true);
  });

  it('caps surfaced API error messages', async () => {
    const message = await readApiErrorMessage(
      new Response(JSON.stringify({ message: `x`.repeat(5000) }), { status: 400 }),
      'fallback',
    );
    expect(message.length).toBeLessThanOrEqual(501);
    expect(message.startsWith('x')).toBe(true);
  });

  it('honors preferBrowser for OpenAI Codex (PKCE loopback instead of device polling)', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const saved = new Map<string, TokenInfo>();
      const storage = {
        load: async (name: string) => saved.get(name),
        save: async (name: string, token: TokenInfo) => {
          saved.set(name, token);
        },
        remove: async (name: string) => {
          saved.delete(name);
        },
        list: async () => [...saved.keys()],
      };
      const manager = new OAuthProviderManager({ storage });
      const token = await manager.login(
        'openai-codex',
        {
          onAuthorizeUrl: (url) => {
            seenUrls.push(url);
          },
          onManualCallbackPrompt: async () => 'test-authorization-code-123',
        },
        { preferBrowser: true, storageKey: 'openai-codex-work' },
      );
      expect(token.accessToken).toBe('at');
      expect(seenUrls).toHaveLength(1);
      expect(seenUrls[0]).toContain('response_type=code');
      expect(saved.get('openai-codex-work')?.accessToken).toBe('at');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('writes the Kimi device id atomically (no torn file, stable across calls)', async () => {
    const { createKimiDeviceId, readKimiDeviceId } = await import('../src/identity');
    const dir = mkdtempSync(join(tmpdir(), 'oauth-device-'));
    const first = createKimiDeviceId(dir);
    expect(first.length).toBeGreaterThan(0);
    expect(readKimiDeviceId(dir)).toBe(first);
    expect(createKimiDeviceId(dir)).toBe(first);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(dir)).toEqual(['device_id']);
  });
});
