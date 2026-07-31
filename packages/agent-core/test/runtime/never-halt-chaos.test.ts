import { describe, expect, it } from 'vitest';

import {
  simulateNeverHaltChaosSequence,
  simulateNeverHaltDegradedChaos,
  simulateNeverHaltOAuthChaosSequence,
} from '../../src/runtime/never-halt-chaos';

describe('Never-Halt chaos — runtime.degraded soft-survive', () => {
  it('fires search breaker + oauth degrade without aborting the goal tick', () => {
    const result = simulateNeverHaltDegradedChaos(99_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.detail).toContain('goal tick completed');
    expect(result.degradedEvents).toHaveLength(2);
    expect(result.degradedEvents[0]).toMatchObject({
      type: 'runtime.degraded',
      scope: 'search',
      reason: 'brave 429',
      atMs: 99_000,
    });
    expect(result.degradedEvents[1]).toMatchObject({
      type: 'runtime.degraded',
      scope: 'oauth',
      atMs: 99_000,
    });
  });

  it('runs breaker open→degraded→half-open→recover without aborting the goal tick', () => {
    const result = simulateNeverHaltChaosSequence(88_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.phases).toEqual(['open', 'degraded', 'half_open', 'recovered']);
    expect(result.breakerStates).toEqual(['open', 'open', 'half_open', 'closed']);
    expect(result.detail).toContain('goal tick completed');
    expect(result.degradedEvents).toHaveLength(1);
    expect(result.degradedEvents[0]).toMatchObject({
      type: 'runtime.degraded',
      scope: 'search',
      reason: 'brave 429',
      atMs: 88_000,
    });
  });

  it('runs oauth refresh fail→degraded→recover without aborting the goal tick', () => {
    const result = simulateNeverHaltOAuthChaosSequence(77_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.phases).toEqual(['fail', 'degraded', 'recovered']);
    expect(result.refreshOutcomes).toEqual([
      { success: false, reason: 'network_or_other' },
      { success: true },
    ]);
    expect(result.detail).toContain('goal tick completed');
    expect(result.degradedEvents).toHaveLength(1);
    expect(result.degradedEvents[0]).toMatchObject({
      type: 'runtime.degraded',
      scope: 'oauth',
      reason: 'oauth_refresh_failed',
      atMs: 77_000,
    });
  });
});
