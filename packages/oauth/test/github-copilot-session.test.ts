import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureGitHubCopilotSession,
  GITHUB_COPILOT_API_BASE_URL,
  GITHUB_COPILOT_PROFILE,
  GITHUB_COPILOT_PROVIDER_ID,
  GITHUB_COPILOT_TOKEN_URL,
  githubCopilotRequestHeaders,
  githubCopilotUserTokenInfo,
  isGitHubCopilotSessionToken,
  isGitHubUserToken,
  parseGitHubCopilotModelsResponse,
  parseGitHubCopilotQuotaSnapshots,
  parseGitHubCopilotTokenResponse,
  readGitHubCopilotEnvToken,
  resetGitHubCopilotSessionCache,
} from '../src/profiles/github-copilot';
import { EXPERIMENTAL_PROVIDER_PROFILES, getProviderProfile } from '../src/profiles';
import { fetchProviderUsage } from '../src/provider-usage';
import { OAuthProviderManager } from '../src/flow/oauth-provider-manager';
import type { TokenInfo } from '../src/types';
import type { TokenStorage } from '../src/storage';

class MemoryStorage implements TokenStorage {
  private readonly tokens = new Map<string, TokenInfo>();
  async load(name: string): Promise<TokenInfo | undefined> {
    return this.tokens.get(name);
  }
  async save(name: string, token: TokenInfo): Promise<void> {
    this.tokens.set(name, token);
  }
  async remove(name: string): Promise<void> {
    this.tokens.delete(name);
  }
  async list(): Promise<string[]> {
    return [...this.tokens.keys()];
  }
}

afterEach(() => {
  resetGitHubCopilotSessionCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('GitHub Copilot profile', () => {
  it('registers as experimental paste-token login', () => {
    expect(getProviderProfile(GITHUB_COPILOT_PROVIDER_ID)).toEqual(GITHUB_COPILOT_PROFILE);
    expect(GITHUB_COPILOT_PROFILE.flow.kind).toBe('paste_token');
    expect(GITHUB_COPILOT_PROFILE.flow.clientId).toBe('superliora');
    expect(GITHUB_COPILOT_PROFILE.flow.clientId).not.toContain('Iv1.');
    expect(GITHUB_COPILOT_PROFILE.wire).toBe('openai');
    expect(
      EXPERIMENTAL_PROVIDER_PROFILES.some(
        (entry) => entry.profile.id === GITHUB_COPILOT_PROVIDER_ID && entry.flag === 'github_copilot',
      ),
    ).toBe(true);
  });

  it('attaches Copilot identity headers', () => {
    expect(githubCopilotRequestHeaders()).toMatchObject({
      'Editor-Version': 'SuperLiora/1.0.0',
      'Editor-Plugin-Version': 'SuperLiora/1.0.0',
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': 'SuperLiora/1.0.0',
    });
  });

  it('reads env tokens in priority order', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghu_env');
    expect(readGitHubCopilotEnvToken()).toBe('ghu_env');
    vi.stubEnv('GITHUB_COPILOT_TOKEN', 'ghu_preferred');
    expect(readGitHubCopilotEnvToken()).toBe('ghu_preferred');
  });

  it('classifies GitHub user vs Copilot session tokens', () => {
    expect(isGitHubUserToken('ghu_abc')).toBe(true);
    expect(isGitHubUserToken('github_pat_abc')).toBe(true);
    expect(isGitHubCopilotSessionToken('tid=abc;exp=1')).toBe(true);
    expect(isGitHubCopilotSessionToken('ghu_abc')).toBe(false);
  });
});

describe('parseGitHubCopilotTokenResponse', () => {
  it('reads token, unix expires_at, and endpoints.api', () => {
    const parsed = parseGitHubCopilotTokenResponse({
      token: 'tid=sess;exp=1710000000',
      expires_at: 1_710_000_000,
      endpoints: { api: 'https://copilot.example.test/' },
    });
    expect(parsed).toEqual({
      token: 'tid=sess;exp=1710000000',
      expiresAtSec: 1_710_000_000,
      apiBaseUrl: 'https://copilot.example.test',
    });
  });

  it('falls back to proxy-ep and tid exp when api is missing', () => {
    const parsed = parseGitHubCopilotTokenResponse({
      token: 'tid=x;exp=1999999999',
      'proxy-ep': 'https://enterprise.example.test',
    });
    expect(parsed?.apiBaseUrl).toBe('https://enterprise.example.test');
    expect(parsed?.expiresAtSec).toBe(1_999_999_999);
  });

  it('defaults the individual host when endpoints are omitted', () => {
    const parsed = parseGitHubCopilotTokenResponse({ token: 'tid=only' });
    expect(parsed?.apiBaseUrl).toBe(GITHUB_COPILOT_API_BASE_URL);
  });
});

describe('parseGitHubCopilotModelsResponse', () => {
  it('keeps chat models and drops non-chat rows', () => {
    const models = parseGitHubCopilotModelsResponse({
      data: [
        {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
          capabilities: {
            type: 'chat',
            limits: { max_prompt_tokens: 128000 },
            supports: { vision: true, tool_calls: true },
          },
        },
        {
          id: 'text-embedding-3-small',
          capabilities: { type: 'embeddings' },
        },
      ],
    });
    expect(models?.map((m) => m.id)).toEqual(['gpt-4.1']);
    expect(models?.[0]?.capabilities).toEqual(['tool_use', 'image_in']);
  });
});

describe('ensureGitHubCopilotSession', () => {
  it('exchanges a user token and caches until shortly before expiry', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        token: 'tid=sess;exp=2000000000',
        expires_at: 2_000_000_000,
        endpoints: { api: 'https://copilot.example.test' },
      }),
    );
    const now = () => 1_000_000_000_000;
    const first = await ensureGitHubCopilotSession('ghu_user', { fetchImpl: fetchMock, now });
    const second = await ensureGitHubCopilotSession('ghu_user', { fetchImpl: fetchMock, now });
    expect(first.token).toBe('tid=sess;exp=2000000000');
    expect(first.apiBaseUrl).toBe('https://copilot.example.test');
    expect(second.token).toBe(first.token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GITHUB_COPILOT_TOKEN_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('token ghu_user');
    expect(headers['Editor-Version']).toBe('SuperLiora/1.0.0');
    expect(headers['Copilot-Integration-Id']).toBe('vscode-chat');
  });

  it('refreshes on force after a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'tid=one', expires_at: 2_000_000_000 }))
      .mockResolvedValueOnce(jsonResponse({ token: 'tid=two', expires_at: 2_000_000_000 }));
    await ensureGitHubCopilotSession('ghu_user', { fetchImpl: fetchMock, now: () => 1_000 });
    const refreshed = await ensureGitHubCopilotSession('ghu_user', {
      fetchImpl: fetchMock,
      force: true,
      now: () => 1_000,
    });
    expect(refreshed.token).toBe('tid=two');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('parseGitHubCopilotQuotaSnapshots', () => {
  it('maps premium_interactions remaining into used/limit', () => {
    const rows = parseGitHubCopilotQuotaSnapshots({
      quota_snapshots: {
        premium_interactions: { entitlement: 300, remaining: 250, unlimited: false },
        chat: { entitlement: 0, remaining: 0, unlimited: true },
      },
    });
    expect(rows).toEqual([
      { key: 'premium_interactions', label: 'Premium interactions', used: 50, limit: 300, unlimited: false },
      { key: 'chat', label: 'Chat', used: 0, limit: 1, unlimited: true },
    ]);
  });
});

describe('fetchProviderUsage github-copilot', () => {
  it('returns a real snapshot from /copilot_internal/user', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/copilot_internal/user')) {
        return jsonResponse({
          quota_snapshots: {
            premium_interactions: { entitlement: 100, remaining: 40, unlimited: false },
          },
        });
      }
      if (String(url).includes('/copilot_internal/v2/token')) {
        return jsonResponse({
          token: 'tid=sess',
          expires_at: 2_000_000_000,
          endpoints: { api: 'https://copilot.example.test' },
        });
      }
      return jsonResponse({ data: [] }, 200, {
        'x-ratelimit-limit-requests': '60',
        'x-ratelimit-remaining-requests': '12',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const snap = await fetchProviderUsage('github-copilot', 'ghu_user');
    expect(snap.available).toBe(true);
    expect(snap.displayName).toBe('GitHub Copilot');
    expect(snap.summary).toMatchObject({ label: 'Premium interactions', used: 60, limit: 100 });
    expect(snap.limits.some((row) => row.label === 'Requests' && row.used === 48 && row.limit === 60)).toBe(
      true,
    );
  });
});

describe('OAuthProviderManager paste_token', () => {
  it('persists a pasted GitHub token after a successful session exchange', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        token: 'tid=sess',
        expires_at: 2_000_000_000,
        endpoints: { api: 'https://copilot.example.test' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const manager = new OAuthProviderManager({ storage: new MemoryStorage() });
    const token = await manager.login(
      GITHUB_COPILOT_PROVIDER_ID,
      {},
      { pastedToken: 'ghu_pasted', storageKey: 'github-copilot-test' },
    );
    expect(token.accessToken).toBe('ghu_pasted');
    expect(token.refreshToken).toBe('ghu_pasted');
    expect(githubCopilotUserTokenInfo('ghu_pasted').accessToken).toBe('ghu_pasted');
    expect(await manager.getCachedAccessToken(GITHUB_COPILOT_PROVIDER_ID, 'github-copilot-test')).toBe(
      'ghu_pasted',
    );
  });
});
