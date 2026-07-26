import { describe, expect, it } from 'vitest';

import { intensityToDefaultExpertCount, routeFromPlanSignals } from '../../../src/agent/plan/ultra-swarm-routing';

describe('plan/ultra-swarm-routing.ts — intensityToDefaultExpertCount', () => {
  it('returns the documented expert count per intensity tier', () => {
    expect(intensityToDefaultExpertCount('light')).toBe(4);
    expect(intensityToDefaultExpertCount('standard')).toBe(12);
    expect(intensityToDefaultExpertCount('heavy')).toBe(24);
  });
});

describe('plan/ultra-swarm-routing.ts — routeFromPlanSignals', () => {
  it('returns undefined when the plan has no swarm decision heading', () => {
    expect(routeFromPlanSignals('just a free-form plan')).toBeUndefined();
  });

  it('returns the default intensity + estimatedExperts for ENGAGE', () => {
    const out = routeFromPlanSignals(
      'Verifiable UltraGoal: g\nAcceptance Criteria: c\nVerification Plan: v\n## Execution Plan\n- x\n## WorkGraph\n- y\nSwarm decision: ENGAGE',
    );
    expect(out?.decision).toBe('ENGAGE');
    expect(out?.intensity).toBe('heavy');
    expect(out?.estimatedExperts).toBe(24);
  });

  it('downgrades to 0 experts when DEFER wins (without a force override)', () => {
    const out = routeFromPlanSignals('Swarm decision: DEFER');
    expect(out?.decision).toBe('DEFER');
    expect(out?.intensity).toBe('light');
    expect(out?.estimatedExperts).toBe(0);
  });

  it('upgrades a DEFER to ADAPTIVE when the user forces swarm via --swarm flag', () => {
    const out = routeFromPlanSignals('Swarm decision: DEFER --swarm');
    expect(out?.decision).toBe('ADAPTIVE');
    expect(out?.intensity).toBe('standard');
    expect(out?.estimatedExperts).toBe(12);
  });

  it('upgrades a DEFER to ADAPTIVE when the user forces swarm via "Force Swarm: yes"', () => {
    const out = routeFromPlanSignals('Swarm decision: DEFER\nForce Swarm: yes');
    expect(out?.decision).toBe('ADAPTIVE');
  });

  it('honors an explicit "swarm intensity: light" override', () => {
    const out = routeFromPlanSignals(
      'Verifiable UltraGoal: g\nAcceptance Criteria: c\nVerification Plan: v\n## Execution Plan\n- x\n## WorkGraph\n- y\nSwarm decision: ENGAGE\nswarm intensity: light',
    );
    expect(out?.intensity).toBe('light');
    expect(out?.estimatedExperts).toBe(4);
  });

  it('emits a stable rationale per decision', () => {
    const engage = routeFromPlanSignals('Swarm decision: ENGAGE\n## Execution Plan\n- x\n## WorkGraph\n- y\nVerifiable UltraGoal: g\nAcceptance Criteria: c\nVerification Plan: v');
    const adapt = routeFromPlanSignals('Swarm decision: ADAPTIVE');
    const defer = routeFromPlanSignals('Swarm decision: DEFER');
    expect(engage?.rationale).toMatch(/full specialist swarm/);
    expect(adapt?.rationale).toMatch(/scaled-down swarm/);
    expect(defer?.rationale).toMatch(/Single-owner/);
  });
});
