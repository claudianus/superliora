import { describe, expect, it } from 'vitest';

import {
  allocateManagedKimiOAuthAccountKey,
  ManagedKimiCodeModelsAuthError,
  parseModelProtocol,
  resolveKimiCodeOAuthKey,
} from '../src/kimi';
import {
  defaultBaseUrl,
  normalizeBaseUrl,
  normalizeEndpoint,
} from '../src/kimi/managed-kimi-code-url';

const profileProvider = { type: 'kimi' as const, label: 'profile-A' };

describe('oauth/managed-kimi-code — pure helpers', () => {
  describe('parseModelProtocol', () => {
    it('returns the protocol for the canonical "anthropic" literal', () => {
      expect(parseModelProtocol('anthropic')).toBe('anthropic');
    });

    it('returns undefined for unknown, empty, or non-string values', () => {
      expect(parseModelProtocol('openai')).toBeUndefined();
      expect(parseModelProtocol('')).toBeUndefined();
      expect(parseModelProtocol(undefined)).toBeUndefined();
      expect(parseModelProtocol(null)).toBeUndefined();
      expect(parseModelProtocol(42)).toBeUndefined();
    });
  });

  describe('allocateManagedKimiOAuthAccountKey', () => {
    it('returns a stable object for the same inputs', () => {
      const a = allocateManagedKimiOAuthAccountKey(profileProvider);
      const b = allocateManagedKimiOAuthAccountKey(profileProvider);
      expect(a).toEqual(b);
    });
  });

  it('normalizes long slash suffixes without changing internal URL slashes', () => {
    const baseUrl = 'https://api.example.test/proxy//coding/v1';
    const suffix = '/'.repeat(20_000);
    expect(defaultBaseUrl(`${baseUrl}${suffix}`)).toBe(baseUrl);
    expect(normalizeBaseUrl(`${baseUrl}${suffix}`)).toBe(baseUrl);
    expect(normalizeEndpoint(` \t${baseUrl}${suffix}\n `)).toBe(baseUrl);
    expect(normalizeBaseUrl(`${baseUrl}${suffix}tail`)).toBe(`${baseUrl}${suffix}tail`);
    expect(normalizeBaseUrl(suffix)).toBe('');
  });

  it('reuses the credential slot for equivalent hosts and separates different public endpoints', () => {
    const endpoints = {
      oauthHost: 'https://auth.example.test',
      baseUrl: 'https://api.example.test/coding/v1',
    };
    const key = resolveKimiCodeOAuthKey(endpoints);
    expect(resolveKimiCodeOAuthKey({
      oauthHost: ` \t${endpoints.oauthHost}/// `,
      baseUrl: `${endpoints.baseUrl}///`,
    })).toBe(key);
    expect(resolveKimiCodeOAuthKey({
      ...endpoints,
      oauthHost: 'https://other-auth.example.test',
    })).not.toBe(key);
    expect(resolveKimiCodeOAuthKey({
      ...endpoints,
      baseUrl: 'https://other-api.example.test/coding/v1',
    })).not.toBe(key);
  });

  it('ManagedKimiCodeModelsAuthError is catchable as an Error', () => {
    const err = new ManagedKimiCodeModelsAuthError({
      status: 401,
      baseUrl: 'https://example.test',
      message: 'caused',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ManagedKimiCodeModelsAuthError');
  });
});
