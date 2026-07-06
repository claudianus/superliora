/**
 * Covers: resolveContext7ApiKey.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { resolveContext7ApiKey } from '../../../src/tools/providers/context7';

describe('resolveContext7ApiKey', () => {
  const original = process.env['CONTEXT7_API_KEY'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['CONTEXT7_API_KEY'];
    } else {
      process.env['CONTEXT7_API_KEY'] = original;
    }
  });

  it('prefers explicit apiKey from config', () => {
    expect(resolveContext7ApiKey({ apiKey: 'ctx7sk_test' })).toBe('ctx7sk_test');
  });

  it('falls back to CONTEXT7_API_KEY env by default', () => {
    process.env['CONTEXT7_API_KEY'] = 'ctx7sk_from_env';
    expect(resolveContext7ApiKey({})).toBe('ctx7sk_from_env');
  });

  it('returns undefined when disabled by empty config and env', () => {
    delete process.env['CONTEXT7_API_KEY'];
    expect(resolveContext7ApiKey({})).toBeUndefined();
  });
});
