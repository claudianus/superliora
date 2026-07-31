import { describe, expect, it } from 'vitest';

import {
  NEVER_HALT_OAUTH_REFRESH_FAILED_REASON,
  NEVER_HALT_SEARCH_429_TOOL_OUTPUT,
  runNeverHaltBreaker429LoopDispatchChaos,
  runNeverHaltDegradedLoopDispatchChaos,
  simulateNeverHaltChaosSequence,
  simulateNeverHaltDegradedChaos,
  simulateNeverHaltInterventionQueueChaos,
  simulateNeverHaltOAuthChaosSequence,
} from '../../src/runtime/never-halt-chaos';

describe('Never-Halt chaos — intervention queue non-blocking', () => {
  it('queues ask-mode approval while parallel tools continue without aborting the goal tick', () => {
    const result = simulateNeverHaltInterventionQueueChaos(44_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.detail).toContain('goal tick completed');
    expect(result.phases).toEqual([
      'enqueue_approval',
      'parallel_tools_continue',
      'resolve_approval',
    ]);
    expect(result.pendingInterventions).toBe(0);
    expect(result.parallelToolsInFlight).toBe(2);
  });
});

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

  it('runs search 429 + oauth refresh through loop-dispatch without aborting the goal tick', async () => {
    const result = await runNeverHaltDegradedLoopDispatchChaos(66_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.detail).toContain('goal tick completed');
    expect(result.degradedEvents).toHaveLength(2);
    expect(result.degradedEvents).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'tool_result_degraded',
        toolCallId: 'chaos-brave-429',
      }),
    );
    expect(result.degradedEvents).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'oauth',
        reason: NEVER_HALT_OAUTH_REFRESH_FAILED_REASON,
        atMs: 66_000,
      }),
    );
  });

  it('runs breaker 429 + degraded tool result through loop-dispatch without aborting the goal tick', async () => {
    const result = await runNeverHaltBreaker429LoopDispatchChaos(55_000);

    expect(result.goalTickCompleted).toBe(true);
    expect(result.detail).toContain('goal tick completed');
    expect(result.degradedEvents.length).toBeGreaterThanOrEqual(2);
    expect(result.degradedEvents).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'brave 429',
        atMs: 55_000,
      }),
    );
    expect(result.degradedEvents).toContainEqual(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'search',
        reason: 'tool_result_degraded',
        toolCallId: 'chaos-breaker-429',
      }),
    );
  });
});
