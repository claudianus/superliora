import { describe, expect, it } from 'vitest';

import { credentialHealthCacheKey } from '../src/credential-health';

describe('oauth/credential-health — credentialHealthCacheKey', () => {
  it('produces a deterministic, non-empty cache key for the same provider+credential', () => {
    const a = credentialHealthCacheKey('kimi', 'cred-A');
    const b = credentialHealthCacheKey('kimi', 'cred-A');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('differentiates by providerId', () => {
    expect(credentialHealthCacheKey('kimi', 'cred-A')).not.toBe(
      credentialHealthCacheKey('openai', 'cred-A'),
    );
  });

  it('differentiates by credentialKey', () => {
    expect(credentialHealthCacheKey('kimi', 'cred-A')).not.toBe(
      credentialHealthCacheKey('kimi', 'cred-B'),
    );
  });

  it('uses "default" as the credential key when omitted', () => {
    expect(credentialHealthCacheKey('kimi', undefined)).toBe(
      credentialHealthCacheKey('kimi', 'default'),
    );
  });

  it('trims surrounding whitespace from both inputs', () => {
    expect(credentialHealthCacheKey('  kimi  ', '  cred-A  ')).toBe(
      credentialHealthCacheKey('kimi', 'cred-A'),
    );
  });
});
