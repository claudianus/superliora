import { describe, expect, it } from 'vitest';

import { isDurableInjectionType } from '../../src/memory/store-query';

describe('isDurableInjectionType', () => {
  it('treats procedure prefs as durable injection types', () => {
    expect(isDurableInjectionType('procedure')).toBe(true);
    expect(isDurableInjectionType('fact')).toBe(true);
    expect(isDurableInjectionType('rule')).toBe(true);
    expect(isDurableInjectionType('event')).toBe(false);
  });
});
