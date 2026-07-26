import { describe, expect, it } from 'vitest';

import {
  assertKimiHostIdentity,
  createKimiUserAgent,
  SUPERLIORA_PLATFORM,
  type KimiHostIdentity,
} from '../src/identity';

describe('oauth/identity — pure helpers', () => {
  it('exposes a non-empty platform literal', () => {
    expect(typeof SUPERLIORA_PLATFORM).toBe('string');
    expect(SUPERLIORA_PLATFORM.length).toBeGreaterThan(0);
  });

  it('returns a non-empty user agent for a valid identity', () => {
    const ua = createKimiUserAgent({ userAgentProduct: 'superliora-cli', version: '1.2.3' });
    expect(ua).toMatch(/superliora-cli/);
    expect(ua).toMatch(/1\.2\.3/);
  });

  it('assertKimiHostIdentity returns the identity when valid', () => {
    const id: KimiHostIdentity = { userAgentProduct: 'superliora', version: '0.1.0' };
    expect(assertKimiHostIdentity(id)).toBe(id);
  });

  it('assertKimiHostIdentity throws on undefined', () => {
    expect(() => assertKimiHostIdentity(undefined)).toThrow(/required/i);
  });

  it('assertKimiHostIdentity throws on undefined identity', () => {
    expect(() => assertKimiHostIdentity(undefined)).toThrow();
  });
});
