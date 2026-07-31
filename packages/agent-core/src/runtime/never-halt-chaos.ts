/**
 * Never-Halt chaos stub — goal loop soft-survive when search/oauth runtime.degraded fires.
 * Internal bench + unit tests share this contract (Sovereign Reform W14).
 */

import type { OAuthRefreshOutcome } from '@superliora/oauth';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

import { buildCircuitBreakerDegradedEvent } from './circuit-breaker-degraded';
import { CircuitBreaker, type CircuitState } from './circuit-breaker';
import {
  buildOAuthRefreshDegradedEvent,
  buildOAuthRefreshDegradedEventFromOutcome,
} from './oauth-refresh-degraded';

export type NeverHaltChaosSequencePhase = 'open' | 'degraded' | 'half_open' | 'recovered';

export type NeverHaltOAuthChaosSequencePhase = 'fail' | 'degraded' | 'recovered';

export interface NeverHaltChaosTickResult {
  readonly degradedEvents: readonly RuntimeDegradedEvent[];
  readonly goalTickCompleted: boolean;
  readonly detail: string;
}

export interface NeverHaltChaosSequenceResult extends NeverHaltChaosTickResult {
  readonly phases: readonly NeverHaltChaosSequencePhase[];
  readonly breakerStates: readonly CircuitState[];
}

export interface NeverHaltOAuthChaosSequenceResult extends NeverHaltChaosTickResult {
  readonly phases: readonly NeverHaltOAuthChaosSequencePhase[];
  readonly refreshOutcomes: readonly OAuthRefreshOutcome[];
}

/**
 * Simulate search breaker open + oauth refresh degrade in one goal tick.
 * Contract: volatile runtime.degraded signals never abort the goal/turn loop.
 */
export function simulateNeverHaltDegradedChaos(atMs: number = Date.now()): NeverHaltChaosTickResult {
  const degradedEvents: RuntimeDegradedEvent[] = [
    buildCircuitBreakerDegradedEvent('search:brave', 'brave 429', atMs),
    buildOAuthRefreshDegradedEvent('OAuth refresh unauthorized; re-login required', atMs),
  ];

  let goalTickCompleted = false;
  try {
    for (const event of degradedEvents) {
      if (event.type !== 'runtime.degraded') {
        throw new Error('expected runtime.degraded');
      }
    }
    goalTickCompleted = true;
  } catch {
    goalTickCompleted = false;
  }

  return {
    degradedEvents,
    goalTickCompleted,
    detail: goalTickCompleted
      ? 'search+oauth degraded; goal tick completed'
      : 'goal tick aborted on degraded (contract violation)',
  };
}

const CHAOS_SEQUENCE_COOLDOWN_MS = 100;
const CHAOS_BREAKER_SCOPE = 'search:brave';

/**
 * Simulate breaker open → runtime.degraded → half-open → recover without network.
 * Contract: goal/turn loop keeps ticking through every phase.
 */
export function simulateNeverHaltChaosSequence(atMs: number = Date.now()): NeverHaltChaosSequenceResult {
  let now = atMs;
  const phases: NeverHaltChaosSequencePhase[] = [];
  const breakerStates: CircuitState[] = [];
  const degradedEvents: RuntimeDegradedEvent[] = [];

  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    cooldownMs: CHAOS_SEQUENCE_COOLDOWN_MS,
    now: () => now,
    onOpened: (reason) => {
      degradedEvents.push(buildCircuitBreakerDegradedEvent(CHAOS_BREAKER_SCOPE, reason, now));
    },
  });

  let goalTickCompleted = false;
  try {
    breaker.recordFailure('brave 429');
    phases.push('open');
    breakerStates.push(breaker.getState());
    if (breaker.getState() !== 'open') {
      throw new Error('expected breaker open');
    }

    phases.push('degraded');
    breakerStates.push(breaker.getState());
    for (const event of degradedEvents) {
      if (event.type !== 'runtime.degraded') {
        throw new Error('expected runtime.degraded');
      }
    }

    now += CHAOS_SEQUENCE_COOLDOWN_MS;
    phases.push('half_open');
    breakerStates.push(breaker.getState());
    if (breaker.getState() !== 'half_open') {
      throw new Error('expected breaker half_open');
    }

    breaker.recordSuccess();
    phases.push('recovered');
    breakerStates.push(breaker.getState());
    if (breaker.getState() !== 'closed') {
      throw new Error('expected breaker closed');
    }

    goalTickCompleted = true;
  } catch {
    goalTickCompleted = false;
  }

  return {
    phases,
    breakerStates,
    degradedEvents,
    goalTickCompleted,
    detail: goalTickCompleted
      ? 'breaker open→degraded→half-open→recover; goal tick completed'
      : 'goal tick aborted during chaos sequence (contract violation)',
  };
}

const OAUTH_CHAOS_RECOVERY_MS = 50;

/**
 * Simulate oauth refresh fail mid-goal → runtime.degraded → recover without network.
 * Contract: goal/turn loop keeps ticking through every phase.
 */
export function simulateNeverHaltOAuthChaosSequence(
  atMs: number = Date.now(),
): NeverHaltOAuthChaosSequenceResult {
  let now = atMs;
  const phases: NeverHaltOAuthChaosSequencePhase[] = [];
  const refreshOutcomes: OAuthRefreshOutcome[] = [];
  const degradedEvents: RuntimeDegradedEvent[] = [];

  let goalTickCompleted = false;
  try {
    const failOutcome: OAuthRefreshOutcome = { success: false, reason: 'network_or_other' };
    refreshOutcomes.push(failOutcome);
    phases.push('fail');

    const degradedEvent = buildOAuthRefreshDegradedEventFromOutcome(failOutcome, now);
    degradedEvents.push(degradedEvent);
    phases.push('degraded');
    if (degradedEvent.type !== 'runtime.degraded' || degradedEvent.scope !== 'oauth') {
      throw new Error('expected oauth runtime.degraded');
    }

    now += OAUTH_CHAOS_RECOVERY_MS;
    const recoverOutcome: OAuthRefreshOutcome = { success: true };
    refreshOutcomes.push(recoverOutcome);
    phases.push('recovered');

    goalTickCompleted = true;
  } catch {
    goalTickCompleted = false;
  }

  return {
    phases,
    refreshOutcomes,
    degradedEvents,
    goalTickCompleted,
    detail: goalTickCompleted
      ? 'oauth refresh fail→degraded→recover; goal tick completed'
      : 'goal tick aborted during oauth chaos sequence (contract violation)',
  };
}
