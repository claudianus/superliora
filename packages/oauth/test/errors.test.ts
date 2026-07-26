import { describe, expect, it } from 'vitest';

import {
  DeviceCodeExpiredError,
  DeviceCodeTimeoutError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from '../src/errors';

describe('oauth/errors — class hierarchy', () => {
  it('every subclass extends OAuthError', () => {
    const samples: OAuthError[] = [
      new OAuthError('a'),
      new OAuthUnauthorizedError('a'),
      new OAuthConnectionError('a'),
      new DeviceCodeExpiredError(),
      new DeviceCodeTimeoutError(),
      new RetryableRefreshError('a'),
    ];
    for (const err of samples) {
      expect(err).toBeInstanceOf(OAuthError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('preserves the message and exposes the class name on .name', () => {
    const cases: Array<[new (msg: string) => OAuthError, string]> = [
      [OAuthUnauthorizedError, 'OAuthUnauthorizedError'],
      [OAuthConnectionError, 'OAuthConnectionError'],
      [RetryableRefreshError, 'RetryableRefreshError'],
    ];
    for (const [Cls, name] of cases) {
      const e = new Cls('boom');
      expect(e.message).toBe('boom');
      expect(e.name).toBe(name);
    }
  });

  it('exposes default messages for the device-code flow errors', () => {
    expect(new DeviceCodeExpiredError().message).toMatch(/expired/);
    expect(new DeviceCodeTimeoutError().message).toMatch(/timed out/);
  });

  it('accepts an explicit override for the device-code error messages', () => {
    expect(new DeviceCodeExpiredError('custom expired').message).toBe('custom expired');
    expect(new DeviceCodeTimeoutError('custom timeout').message).toBe('custom timeout');
  });

  it('is catchable as OAuthError for any of the subclasses', () => {
    const throws = (): never => {
      throw new OAuthUnauthorizedError('401');
    };
    expect(() => throws()).toThrow(OAuthError);
    expect(() => throws()).toThrow(OAuthUnauthorizedError);
  });
});
