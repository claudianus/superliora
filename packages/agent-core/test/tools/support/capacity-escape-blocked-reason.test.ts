import { describe, expect, it } from 'vitest';

import { isCapacityEscapeBlockedReason } from '../../../src/tools/support/capacity-escape-blocked-reason';

describe('capacity-escape-blocked-reason', () => {
  it('flags magnitude / calendar / scope-escape stalls', () => {
    expect(isCapacityEscapeBlockedReason('impossible without weeks of work')).toBe(true);
    expect(isCapacityEscapeBlockedReason('too large to finish tonight')).toBe(true);
    expect(isCapacityEscapeBlockedReason('not worth it given the magnitude of work')).toBe(true);
    expect(isCapacityEscapeBlockedReason('would take weeks for a human')).toBe(true);
    expect(isCapacityEscapeBlockedReason('need to reduce the scope first')).toBe(true);
    expect(isCapacityEscapeBlockedReason('DEFERRED to daylight')).toBe(true);
  });

  it('allows concrete external blockers', () => {
    expect(isCapacityEscapeBlockedReason('missing OPENAI_API_KEY in the environment')).toBe(false);
    expect(isCapacityEscapeBlockedReason('permission denied writing ~/.ssh/config')).toBe(false);
    expect(isCapacityEscapeBlockedReason('user must approve production deploy')).toBe(false);
    expect(isCapacityEscapeBlockedReason('registry.example.test unreachable (ECONNREFUSED)')).toBe(
      false,
    );
    expect(isCapacityEscapeBlockedReason('')).toBe(false);
  });
});
