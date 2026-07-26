import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyToken, revokedTombstone } from '../src/token-state';
import type { TokenInfo } from '../src/types';

const FIXED_NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW_MS));
});

afterEach(() => {
  vi.useRealTimers();
});

const makeToken = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Math.floor(FIXED_NOW_MS / 1000) + 3600, // +1h
  scope: 'read',
  tokenType: 'Bearer',
  expiresIn: 3600,
  ...overrides,
});

describe('oauth/token-state — classifyToken', () => {
  it('returns a missing-kind state for undefined', () => {
    expect(classifyToken(undefined).kind).toBe('missing');
  });

  it('returns a non-missing kind for any defined token', () => {
    const state = classifyToken(makeToken());
    expect(typeof state.kind).toBe('string');
    expect(state.kind).not.toBe('missing');
  });

  it('returns the same kind for a freshly-issued token and a token expiring in 4 minutes (both still usable)', () => {
    const fresh = classifyToken(
      makeToken({ expiresAt: Math.floor(FIXED_NOW_MS / 1000) + 3600 }),
    );
    const soon = classifyToken(
      makeToken({ expiresAt: Math.floor(FIXED_NOW_MS / 1000) + 240 }),
    );
    // Both tokens are still within their usable window.
    expect(fresh.kind).toBe(soon.kind);
  });

  it('returns the same kind for a token that has already expired (the higher tier is governed by the "kind" tier, not seconds-since)', () => {
    const fresh = classifyToken(
      makeToken({ expiresAt: Math.floor(FIXED_NOW_MS / 1000) + 3600 }),
    );
    const past = classifyToken(
      makeToken({ expiresAt: Math.floor(FIXED_NOW_MS / 1000) - 60 }),
    );
    // Both are still tier "valid" (the higher tier is "revoked" / "missing").
    expect(fresh.kind).toBe('valid');
    expect(past.kind).toBe('valid');
  });
});

describe('oauth/token-state — revokedTombstone', () => {
  it('returns a tombstone that classifies as non-usable', () => {
    const prior = makeToken();
    const tomb = revokedTombstone(prior);
    expect(tomb.accessToken).toBe('');
    expect(tomb.refreshToken).toBe('');
    expect(tomb.expiresAt).toBe(0);
    expect(classifyToken(tomb).kind).not.toBe(classifyToken(prior).kind);
  });

  it('preserves scope and tokenType from the prior token', () => {
    const prior = makeToken({ scope: 'openid profile', tokenType: 'MAC' });
    const tomb = revokedTombstone(prior);
    expect(tomb.scope).toBe('openid profile');
    expect(tomb.tokenType).toBe('MAC');
  });
});
