import { describe, expect, it } from 'vitest';

import { DURABLE_INJECTION_TYPES } from '../../src/memory/store-query';

describe('DURABLE_INJECTION_TYPES', () => {
  it('treats procedure prefs as durable injection types', () => {
    expect(DURABLE_INJECTION_TYPES.has('procedure')).toBe(true);
    expect(DURABLE_INJECTION_TYPES.has('fact')).toBe(true);
    expect(DURABLE_INJECTION_TYPES.has('rule')).toBe(true);
    expect(DURABLE_INJECTION_TYPES.has('event')).toBe(false);
  });
});
