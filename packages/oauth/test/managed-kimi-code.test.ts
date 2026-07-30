import { describe, expect, it } from 'vitest';

import {
  allocateManagedKimiOAuthAccountKey,
  ManagedKimiCodeModelsAuthError,
  MANAGED_KIMI_API_PROVIDER,
  parseModelProtocol,
  SUPERLIORA_OAUTH_KEY,
  SUPERLIORA_PLATFORM_ID,
  SUPERLIORA_PROVIDER_NAME,
} from '../src/kimi';

describe('oauth/managed-kimi-code — pure helpers', () => {
  it('exposes the documented SuperLiora / managed-kimi constants', () => {
    expect(SUPERLIORA_PLATFORM_ID).toBe('kimi-code');
    expect(MANAGED_KIMI_API_PROVIDER).toBe('managed:kimi-api');
    expect(SUPERLIORA_PROVIDER_NAME).toBe('managed:kimi-api');
    expect(SUPERLIORA_OAUTH_KEY).toBe('oauth/kimi-code');
  });

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
      const a = allocateManagedKimiOAuthAccountKey('profile-A', 'managed:kimi-api');
      const b = allocateManagedKimiOAuthAccountKey('profile-A', 'managed:kimi-api');
      expect(a).toEqual(b);
    });

    it('returns a non-null object', () => {
      const a = allocateManagedKimiOAuthAccountKey('profile-A', 'managed:kimi-api');
      expect(a).not.toBeNull();
      expect(typeof a).toBe('object');
    });
  });

  it('ManagedKimiCodeModelsAuthError is catchable as an Error', () => {
    const err = new ManagedKimiCodeModelsAuthError('https://example.test', new Error('caused'));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ManagedKimiCodeModelsAuthError');
  });
});
