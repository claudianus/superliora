import { describe, expect, it } from 'vitest';

import { resolveKimiTokenStorageName } from '../src/toolkit';

describe('oauth/toolkit — resolveKimiTokenStorageName', () => {
  it('returns "kimi-code" when no provider / key override is provided', () => {
    expect(resolveKimiTokenStorageName({})).toBe('kimi-code');
  });

  it('returns "kimi-code" for the canonical oauth key "kimi-code"', () => {
    expect(resolveKimiTokenStorageName({ oauthKey: 'kimi-code' })).toBe('kimi-code');
  });

  it('returns "kimi-code" for the canonical oauth key "oauth/kimi-code"', () => {
    expect(resolveKimiTokenStorageName({ oauthKey: 'oauth/kimi-code' })).toBe('kimi-code');
  });

  it('returns a non-empty custom storage name for an alternative oauth key', () => {
    const result = resolveKimiTokenStorageName({ oauthKey: 'oauth/some-other' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws when the provider name is not the managed kimi-api provider', () => {
    expect(() => resolveKimiTokenStorageName({ providerName: 'openai' })).toThrow(/openai/);
  });
});
