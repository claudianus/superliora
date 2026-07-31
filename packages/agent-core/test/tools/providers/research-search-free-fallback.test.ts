import { afterEach, describe, expect, it } from 'vitest';

import {
  ALLOW_DISABLE_FREE_FALLBACK_ENV,
  resolveResearchSearchFreeFallback,
} from '../../../src/tools/providers/research-search-free-fallback';

describe('resolveResearchSearchFreeFallback', () => {
  const envKey = ALLOW_DISABLE_FREE_FALLBACK_ENV;

  afterEach(() => {
    delete process.env[envKey];
  });

  it('defaults to on when config is unset or true', () => {
    expect(resolveResearchSearchFreeFallback(undefined)).toBe(true);
    expect(resolveResearchSearchFreeFallback(true)).toBe(true);
  });

  it('forces on when config is false without advanced override env', () => {
    expect(resolveResearchSearchFreeFallback(false)).toBe(true);
    expect(resolveResearchSearchFreeFallback(false, { [envKey]: '0' })).toBe(true);
  });

  it('honors config false only when advanced override env is set', () => {
    expect(resolveResearchSearchFreeFallback(false, { [envKey]: '1' })).toBe(false);
  });
});
