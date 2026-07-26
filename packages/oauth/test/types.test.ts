import { describe, expect, it } from 'vitest';

import { isRecord } from '../src/utils';
import { tokenFromWire, tokenToWire, type TokenInfo } from '../src/types';

const SAMPLE: TokenInfo = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1700000000,
  scope: 'read write',
  tokenType: 'Bearer',
  expiresIn: 3600,
};

describe('oauth/utils — isRecord', () => {
  it('accepts plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejects arrays, null, primitives, and undefined', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('a')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('oauth/types — token wire (de)serialization', () => {
  it('tokenToWire maps camelCase fields to snake_case keys', () => {
    expect(tokenToWire(SAMPLE)).toEqual({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_at: 1700000000,
      scope: 'read write',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('tokenFromWire round-trips a fully populated wire record', () => {
    expect(
      tokenFromWire({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_at: 1700000000,
        scope: 'read write',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    ).toEqual(SAMPLE);
  });

  it('tokenFromWire fills missing string fields with empty strings', () => {
    expect(tokenFromWire({})).toEqual({
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      scope: '',
      tokenType: '',
      expiresIn: 0,
    });
  });

  it('tokenFromWire coerces non-numeric expires_at / expires_in to 0', () => {
    expect(
      tokenFromWire({
        access_token: 'a',
        expires_at: 'soon' as unknown as number,
        expires_in: { ms: 1 } as unknown as number,
      }),
    ).toMatchObject({
      accessToken: 'a',
      expiresAt: 0,
      expiresIn: 0,
    });
  });

  it('tokenToWire → tokenFromWire is a lossless round-trip', () => {
    expect(tokenFromWire(tokenToWire(SAMPLE))).toEqual(SAMPLE);
  });
});
