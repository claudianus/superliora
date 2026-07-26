import { describe, expect, it } from 'vitest';

import { extractApiErrorMessage } from '../src/api-error';

describe('oauth/api-error — extractApiErrorMessage', () => {
  it('returns undefined for null, undefined, and primitives', () => {
    expect(extractApiErrorMessage(null)).toBeUndefined();
    expect(extractApiErrorMessage(undefined)).toBeUndefined();
    expect(extractApiErrorMessage('plain text')).toBeUndefined();
    expect(extractApiErrorMessage(42)).toBeUndefined();
  });

  it('reads the canonical OAuth error_description key', () => {
    expect(extractApiErrorMessage({ error_description: 'invalid_grant' })).toBe('invalid_grant');
  });

  it('falls back to message, then detail when error_description is missing', () => {
    expect(extractApiErrorMessage({ message: 'bad request' })).toBe('bad request');
    expect(extractApiErrorMessage({ detail: 'no detail' })).toBe('no detail');
  });

  it('prefers the top-level error string when no direct key matches', () => {
    expect(extractApiErrorMessage({ error: 'rate_limited' })).toBe('rate_limited');
  });

  it('digs into a nested error object', () => {
    expect(
      extractApiErrorMessage({ error: { message: 'nested failure', code: 500 } }),
    ).toBe('nested failure');
  });

  it('walks an array of errors and returns the first one with a usable message', () => {
    expect(
      extractApiErrorMessage({
        errors: [{ message: 'first' }, { error_description: 'second' }],
      }),
    ).toBe('first');
  });

  it('returns the first message in a top-level array of payloads', () => {
    expect(
      extractApiErrorMessage([{ message: 'a' }, { message: 'b' }]),
    ).toBe('a');
  });

  it('ignores empty-string values to avoid a non-actionable error message', () => {
    expect(extractApiErrorMessage({ error_description: '' })).toBeUndefined();
    expect(extractApiErrorMessage({ error: '' })).toBeUndefined();
  });
});
