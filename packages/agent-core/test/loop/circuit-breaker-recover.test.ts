import { beforeEach, describe, expect, it } from 'vitest';

import {
  CIRCUIT_BREAKER_RECOVERED_CODE,
  ToolGuardState,
  formatCircuitBreakerProbeFailedTip,
  formatCircuitBreakerRecoveredTip,
} from '../../src/loop';

describe('tool circuit breaker recovery (Loop29a)', () => {
  let guards: ToolGuardState;

  beforeEach(() => {
    guards = new ToolGuardState();
  });

  it('keeps breaker state private to each agent', () => {
    const other = new ToolGuardState();
    for (let i = 0; i < 5; i++) {
      guards.recordToolFailureForCircuitBreaker('Bash');
    }
    expect(guards.isToolCircuitOpen('Bash')).toBe(true);
    // A subagent (or a second server session) must not inherit the trip.
    expect(other.isToolCircuitOpen('Bash')).toBe(false);
  });

  it('keeps breaker state across turn resets and clears on session reset', () => {
    for (let i = 0; i < 5; i++) {
      guards.recordToolFailureForCircuitBreaker('Bash');
    }
    guards.resetForTurn();
    expect(guards.isToolCircuitOpen('Bash')).toBe(true);
    guards.resetCircuitBreakers();
    expect(guards.isToolCircuitOpen('Bash')).toBe(false);
  });

  it('formats recovered tip with prior state', () => {
    const tip = formatCircuitBreakerRecoveredTip('Bash', 'half-open');
    expect(tip.startsWith(CIRCUIT_BREAKER_RECOVERED_CODE)).toBe(true);
    expect(tip).toContain('Bash');
    expect(tip).toContain('half-open');
    expect(tip).toContain(`code=${CIRCUIT_BREAKER_RECOVERED_CODE}`);
  });

  it('formats probe-failed tip with open marker', () => {
    const tip = formatCircuitBreakerProbeFailedTip('Edit');
    expect(tip).toContain('CIRCUIT_BREAKER_OPEN');
    expect(tip).toContain('Edit');
    expect(tip).toContain('half-open probe failed');
  });

  it('returns prior state when success closes a non-closed breaker', () => {
    // Trip to open: 5 failures in window.
    for (let i = 0; i < 5; i++) {
      guards.recordToolFailureForCircuitBreaker('Bash');
    }
    expect(guards.getCircuitBreakerState('Bash')).toBe('open');
    expect(guards.isToolCircuitOpen('Bash')).toBe(true);

    // Force cooldown expiry so next check transitions open → half-open.
    // Access via successive failures is not needed — mutate cooldown by waiting is flaky.
    // Instead: record failure after manual half-open isn't public; simulate recovery from open.
    // recordToolSuccessForCircuitBreaker closes from any non-closed state.
    const prior = guards.recordToolSuccessForCircuitBreaker('Bash');
    expect(prior).toBe('open');
    expect(guards.getCircuitBreakerState('Bash')).toBe('closed');
    expect(guards.recordToolSuccessForCircuitBreaker('Bash')).toBeUndefined();
  });

  it('allows one half-open probe after cooldown and closes on success', () => {
    for (let i = 0; i < 5; i++) {
      guards.recordToolFailureForCircuitBreaker('Write');
    }
    expect(guards.getCircuitBreakerState('Write')).toBe('open');

    // Manually expire cooldown by re-recording after faking time is unavailable;
    // isToolCircuitOpen only transitions when now >= cooldownUntil.
    // Use a spy-less approach: force state via failure path after patching Date.
    const realNow = Date.now;
    try {
      const openAt = realNow();
      Date.now = () => openAt + 31_000;
      expect(guards.isToolCircuitOpen('Write')).toBe(false); // half-open probe allowed
      expect(guards.getCircuitBreakerState('Write')).toBe('half-open');
      const prior = guards.recordToolSuccessForCircuitBreaker('Write');
      expect(prior).toBe('half-open');
      expect(guards.getCircuitBreakerState('Write')).toBe('closed');
    } finally {
      Date.now = realNow;
    }
  });

  it('re-opens on half-open probe failure', () => {
    for (let i = 0; i < 5; i++) {
      guards.recordToolFailureForCircuitBreaker('ApplyPatch');
    }
    const realNow = Date.now;
    try {
      const openAt = realNow();
      Date.now = () => openAt + 31_000;
      expect(guards.isToolCircuitOpen('ApplyPatch')).toBe(false);
      expect(guards.getCircuitBreakerState('ApplyPatch')).toBe('half-open');
      const opened = guards.recordToolFailureForCircuitBreaker('ApplyPatch');
      expect(opened).toBe(true);
      expect(guards.getCircuitBreakerState('ApplyPatch')).toBe('open');
    } finally {
      Date.now = realNow;
    }
  });
});
