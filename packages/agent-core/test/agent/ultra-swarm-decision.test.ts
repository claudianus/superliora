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
      expect(ultraSwarmEngageNextAction('Swarm decision: ENGAGE')).toContain('UltraSwarm ENGAGE approved');
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
  const agent = {
    records: { logRecord: (record: unknown) => logs.push(record) },
    emitEvent: () => undefined,
    ultrawork: { getRun: () => null },
  } as unknown as Agent;
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

import { resolveMaxExperts } from '../../src/tools/builtin/collaboration/ultra-swarm';

describe('resolveMaxExperts', () => {
  it('returns MAX when tool intensity is max', () => {
    expect(resolveMaxExperts('max', undefined, undefined)).toBe(128);
  });

  it('returns routing.estimatedExperts when tool intensity is omitted and routing exists', () => {
    expect(resolveMaxExperts(undefined, { estimatedExperts: 4 }, undefined)).toBe(4);
    expect(resolveMaxExperts(undefined, { estimatedExperts: 12 }, undefined)).toBe(12);
  });

  it('falls back to 24 when neither tool intensity nor routing is present', () => {
    expect(resolveMaxExperts(undefined, undefined, undefined)).toBe(24);
  });

  it('respects explicit max_experts override over routing', () => {
    expect(resolveMaxExperts(undefined, { estimatedExperts: 24 }, 8)).toBe(8);
  });

  it('treats balanced/premium as explicit (ignores routing)', () => {
    expect(resolveMaxExperts('balanced', { estimatedExperts: 4 }, undefined)).toBe(24);
    expect(resolveMaxExperts('premium', { estimatedExperts: 4 }, undefined)).toBe(24);
  });
});

describe('routeFromPlanSignals DEFER override', () => {
  it('upgrades DEFER to ADAPTIVE when "--swarm" flag is present', () => {
    const plan = 'Swarm decision: DEFER - single-owner\n--swarm';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('ADAPTIVE');
    expect(result!.intensity).toBe('standard');
    expect(result!.estimatedExperts).toBe(12);
  });

  it('upgrades DEFER when "Force Swarm: yes" keyword is present (case-insensitive)', () => {
    const plan = 'Swarm decision: DEFER\nForce Swarm: yes';
    const result = routeFromPlanSignals(plan);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('ADAPTIVE');
  });

  it('does not change ENGAGE/ADAPTIVE when flag is present (no downgrade)', () => {
    expect(routeFromPlanSignals('Swarm decision: ENGAGE\n--swarm')?.decision).toBe('ENGAGE');
    expect(routeFromPlanSignals('Swarm decision: ADAPTIVE\n--swarm')?.decision).toBe('ADAPTIVE');
  });

  it('override does not trigger when no DEFER decision exists', () => {
    expect(routeFromPlanSignals('no decision\n--swarm')).toBeUndefined();
  });
});

describe('UltraSwarmEngageGate emits routing event', () => {
  function createEmittingMockAgent(runId: string | null): {
    agent: Agent;
    events: unknown[];
  } {
    const events: unknown[] = [];
    const agent = {
      records: { logRecord: () => undefined },
      emitEvent: (event: unknown) => events.push(event),
      ultrawork: { getRun: () => (runId === null ? null : { id: runId }) },
      homedir: undefined,
      type: 'main',
    } as unknown as Agent;
    return { agent, events };
  }

  it('emits ultrawork.routing.decided when engaging with routing and a run exists', () => {
    const { agent, events } = createEmittingMockAgent('run-42');
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({
      planPath: '/tmp/plan.md',
      routing: {
        decision: 'ADAPTIVE',
        intensity: 'standard',
        estimatedExperts: 12,
        rationale: 'moderate',
      },
    });
    const routingEvent = events.find(
      (e) => (e as { type: string }).type === 'ultrawork.routing.decided',
    ) as { runId: string; decision: string } | undefined;
    expect(routingEvent).toBeDefined();
    expect(routingEvent!.runId).toBe('run-42');
    expect(routingEvent!.decision).toBe('ADAPTIVE');
  });

  it('does not emit when engaging without routing (backward compatible)', () => {
    const { agent, events } = createEmittingMockAgent('run-42');
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({ planPath: '/tmp/plan.md' });
    const routingEvent = events.find(
      (e) => (e as { type: string }).type === 'ultrawork.routing.decided',
    );
    expect(routingEvent).toBeUndefined();
  });

  it('does not emit when no ultrawork run exists (runId unavailable)', () => {
    const { agent, events } = createEmittingMockAgent(null);
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({
      planPath: '/tmp/plan.md',
      routing: {
        decision: 'ENGAGE',
        intensity: 'heavy',
        estimatedExperts: 24,
        rationale: 'multi-lane',
      },
    });
    const routingEvent = events.find(
      (e) => (e as { type: string }).type === 'ultrawork.routing.decided',
    );
    expect(routingEvent).toBeUndefined();
  });
});


import { buildResumeWithSteering } from '../../src/ultrawork/interrupted-work-resume';
import {
  createUltraSwarmRunContext,
  requestUltraSwarmSteer,
  consumeUltraSwarmSteerRequests,
} from '../../src/agent/ultra-swarm-run';
import type { TeamPlan } from '@superliora/protocol';

describe('buildResumeWithSteering', () => {
  it('returns recovery prompt alone when user text is empty', () => {
    expect(buildResumeWithSteering('recovery', '   ')).toBe('recovery');
  });

  it('appends user steering section to recovery prompt', () => {
    const out = buildResumeWithSteering('recovery cursor', 'focus on security');
    expect(out).toContain('recovery cursor');
    expect(out).toContain('User steering for this resume');
    expect(out).toContain('focus on security');
  });
});

describe('UltraSwarm steer request queue', () => {
  const team = { experts: [], maxExperts: 1, reason: 'test' } as unknown as TeamPlan;

  it('queues and consumes steer requests', () => {
    const run = createUltraSwarmRunContext({
      runId: 'r1',
      parentToolCallId: 't1',
      team,
      busEnabled: true,
    });
    expect(requestUltraSwarmSteer(run, ' go left ')).toBe(true);
    expect(run.pausedForSteer).toBe(true);
    expect(requestUltraSwarmSteer(run, '  ')).toBe(false);
    expect(consumeUltraSwarmSteerRequests(run)).toEqual(['go left']);
    expect(consumeUltraSwarmSteerRequests(run)).toEqual([]);
  });

  it('returns false when no run is active', () => {
    expect(requestUltraSwarmSteer(undefined, 'x')).toBe(false);
  });
});
