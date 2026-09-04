import { describe, expect, it } from 'vitest';

import { parseResponseRateLimits } from '../src/rate-limit-headers';
import { AnthropicChatProvider } from '../src/providers/anthropic/anthropic';
import { KimiChatProvider } from '../src/providers/kimi/kimi';
import { OpenAIResponsesChatProvider } from '../src/providers/openai-responses';

function builtBaseUrl(provider: unknown, apiKey: string, auth: unknown): string | null {
  const client = (provider as { _buildClient: (key: string, a?: unknown) => { baseURL: string | null } })._buildClient(
    apiKey,
    auth,
  );
  return client.baseURL;
}

describe('per-request baseUrl (session host rotation)', () => {
  it('openai_responses prefers auth.baseUrl over the constructor baseUrl', () => {
    const provider = new OpenAIResponsesChatProvider({
      model: 'gpt-5.2-codex',
      apiKey: 'static-key',
      baseUrl: 'https://static.example.test/v1',
    });
    expect(builtBaseUrl(provider, 'static-key', undefined)).toBe('https://static.example.test/v1');
    expect(
      builtBaseUrl(provider, 'rotated-key', {
        apiKey: 'rotated-key',
        baseUrl: 'https://rotated.example.test/v1',
      }),
    ).toBe('https://rotated.example.test/v1');
  });

  it('anthropic prefers auth.baseUrl over the constructor baseUrl', () => {
    const provider = new AnthropicChatProvider({
      model: 'claude-sonnet-4-6',
      apiKey: 'static-key',
      baseUrl: 'https://static.example.test',
    });
    expect(builtBaseUrl(provider, 'static-key', undefined)).toBe('https://static.example.test');
    expect(
      builtBaseUrl(provider, 'rotated-key', {
        apiKey: 'rotated-key',
        baseUrl: 'https://rotated.example.test',
      }),
    ).toBe('https://rotated.example.test');
  });

  it('kimi prefers auth.baseUrl over the constructor baseUrl', () => {
    const provider = new KimiChatProvider({
      model: 'kimi-k2.7',
      apiKey: 'static-key',
      baseUrl: 'https://static.example.test/v1',
    });
    const client = (
      provider as unknown as {
        _createClient: (a?: unknown) => { baseURL: string };
      }
    )._createClient({ apiKey: 'rotated-key', baseUrl: 'https://rotated.example.test/v1' });
    expect(client.baseURL).toBe('https://rotated.example.test/v1');
  });
});

describe('parseResponseRateLimits retry-after', () => {
  it('surfaces retry-after alongside bucket headers (server backoff wins)', () => {
    const parsed = parseResponseRateLimits(
      {
        'x-ratelimit-limit-requests': '60',
        'x-ratelimit-remaining-requests': '0',
        'retry-after': '30',
      },
      1_700_000_000_000,
    );
    const retryAfter = parsed.find((entry) => entry.name === 'retry-after');
    expect(retryAfter).toBeDefined();
    expect(retryAfter?.resetAt).toBe(1_700_000_000_000 + 30_000);
    expect(parsed.some((entry) => entry.name === 'requests')).toBe(true);
  });

  it('still surfaces a lone retry-after', () => {
    const parsed = parseResponseRateLimits({ 'retry-after': '30' }, 1_700_000_000_000);
    expect(parsed).toEqual([{ name: 'retry-after', resetAt: 1_700_000_030_000 }]);
  });
});
