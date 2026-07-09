import { describe, expect, it } from 'vitest';
import { ultraSwarmDecision, ultraSwarmEngageNextAction } from '../../src/agent/plan/ultra-swarm-decision';
import {
  routeFromPlanSignals,
  intensityToDefaultExpertCount,
  type SwarmRoutingIntensity,
} from '../../src/agent/plan/ultra-swarm-routing';

describe('ultraSwarmDecision', () => {
  describe('ternary decision parsing', () => {
    it('parses ENGAGE from "Swarm decision: ENGAGE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ENGAGE - multi-lane work')).toBe('ENGAGE');
    });

    it('parses DEFER from "Swarm decision: DEFER"', () => {
      expect(ultraSwarmDecision('Swarm decision: DEFER - single-owner task')).toBe('DEFER');
    });

    it('parses ADAPTIVE from "Swarm decision: ADAPTIVE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ADAPTIVE - moderate complexity')).toBe('ADAPTIVE');
    });

    it('parses ADAPTIVE from a "- Decision: ADAPTIVE" field line', () => {
      expect(ultraSwarmDecision('- Decision: ADAPTIVE')).toBe('ADAPTIVE');
    });

    it('returns undefined when no decision line is present', () => {
      expect(ultraSwarmDecision('some plan without a swarm decision')).toBeUndefined();
    });

    it('is case-insensitive for ADAPTIVE', () => {
      expect(ultraSwarmDecision('Swarm decision: adaptive')).toBe('ADAPTIVE');
    });
  });

  describe('ultraSwarmEngageNextAction', () => {
    it('returns undefined for DEFER', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: DEFER')).toBeUndefined();
    });

    it('returns undefined for ADAPTIVE (next-action guidance is ENGAGE-only)', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ADAPTIVE')).toBeUndefined();
    });

    it('returns guidance string for ENGAGE', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ENGAGE')).toContain('UltraSwarm ENGAGE is binding');
    });
  });
});

describe('intensityToDefaultExpertCount', () => {
  it('returns 4 for light', () => {
    expect(intensityToDefaultExpertCount('light')).toBe(4);
  });
  it('returns 12 for standard', () => {
    expect(intensityToDefaultExpertCount('standard')).toBe(12);
  });
  it('returns 24 for heavy', () => {
    expect(intensityToDefaultExpertCount('heavy')).toBe(24);
  });
});

describe('routeFromPlanSignals', () => {
  it('routes ENGAGE + heavy when plan declares both', () => {
    const plan = 'Swarm decision: ENGAGE\nSwarm intensity: heavy';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('ENGAGE');
    expect(result!.intensity).toBe('heavy');
    expect(result!.estimatedExperts).toBe(24);
  });

  it('routes ADAPTIVE + standard by default for ADAPTIVE without explicit intensity', () => {
    const plan = 'Swarm decision: ADAPTIVE - moderate';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('ADAPTIVE');
    expect(result!.intensity).toBe('standard');
    expect(result!.estimatedExperts).toBe(12);
  });

  it('routes DEFER with light intensity and 0 experts', () => {
    const plan = 'Swarm decision: DEFER - single-owner task';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('DEFER');
    expect(result!.intensity).toBe('light');
    expect(result!.estimatedExperts).toBe(0);
  });

  it('defaults ENGAGE to heavy when intensity line is absent', () => {
    const plan = 'Swarm decision: ENGAGE - multi-lane';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.intensity).toBe('heavy');
  });

  it('respects explicit Swarm intensity even for ADAPTIVE', () => {
    const plan = 'Swarm decision: ADAPTIVE\nSwarm intensity: light';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.intensity).toBe('light');
    expect(result!.estimatedExperts).toBe(4);
  });

  it('returns undefined when plan has no decision line', () => {
    expect(routeFromPlanSignals('no decision here')).toBeUndefined();
  });

  it('always provides a non-empty rationale', () => {
    const result = routeFromPlanSignals('Swarm decision: ADAPTIVE');
    expect(result).toBeDefined();
    expect(result!.rationale.length).toBeGreaterThan(0);
  });
});

import { UltraSwarmEngageGate, type UltraSwarmEngageGateData } from '../../src/agent/plan/ultra-swarm-engage-gate';
import type { Agent } from '../../src/agent';

function createMockAgent(): { agent: Agent; logs: unknown[] } {
  const logs: unknown[] = [];
  const agent = { records: { logRecord: (record: unknown) => logs.push(record) } } as unknown as Agent;
  return { agent, logs };
}

describe('UltraSwarmEngageGate routing field', () => {
  it('engages with a routing result and exposes it via data()', () => {
    const { agent, logs } = createMockAgent();
    const gate = new UltraSwarmEngageGate(agent);
    const input: UltraSwarmEngageGateData = {
      planPath: '/tmp/plan.md',
      reason: 'multi-lane',
      routing: {
        decision: 'ADAPTIVE',
        intensity: 'standard',
        estimatedExperts: 12,
        rationale: 'Moderate complexity',
      },
    };
    gate.engage(input);
    expect(gate.isActive).toBe(true);
    expect(gate.data()?.routing?.decision).toBe('ADAPTIVE');
    expect(gate.data()?.routing?.estimatedExperts).toBe(12);
    expect(logs).toContainEqual(expect.objectContaining({ type: 'ultra_swarm_engage_gate.set' }));
  });

  it('engages without routing (backward compatible)', () => {
    const { agent } = createMockAgent();
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({ planPath: '/tmp/plan.md' });
    expect(gate.data()?.routing).toBeUndefined();
  });
});
