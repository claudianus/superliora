import { describe, expect, it } from 'vitest';

import { hasFabricatedDeferral } from '../../../src/tools/support/fabricated-defer';

describe('fabricated-defer', () => {
  it('flags invented deferral buckets and user-attributed deferrals', () => {
    expect(hasFabricatedDeferral('- [ ] polish UI — DEFERRED to daylight')).toBe(true);
    expect(hasFabricatedDeferral('Item approved-tonight with a one-line justification')).toBe(true);
    expect(hasFabricatedDeferral('deferred per user: skip the flaky suite')).toBe(true);
    expect(hasFabricatedDeferral('Deferred to tomorrow after standup')).toBe(true);
  });

  it('allows honest agent deferrals and unrelated prose', () => {
    expect(hasFabricatedDeferral('Agent deferred: waiting on API key from user')).toBe(false);
    expect(hasFabricatedDeferral('Daylight saving starts next month')).toBe(false);
    expect(hasFabricatedDeferral('Approved per user request in PR discussion #12')).toBe(false);
    expect(hasFabricatedDeferral('')).toBe(false);
  });
});
