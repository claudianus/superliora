import { describe, expect, it } from 'vitest';

import { ultraSwarmDecision, ultraSwarmEngageNextAction } from '#/agent/plan/ultra-swarm-decision';

describe('ultra-swarm-decision — ultraSwarmDecision', () => {
  it('parses the explicit "swarm decision: ENGAGE" line (case-insensitive)', () => {
    expect(ultraSwarmDecision('Plan...\nswarm decision: engage\nmore')).toBe('ENGAGE');
    expect(ultraSwarmDecision('swarm decision: ADAPTIVE')).toBe('ADAPTIVE');
    expect(ultraSwarmDecision('swarm decision: defer')).toBe('DEFER');
  });

  it('falls back to a "Decision: X" line when the explicit line is missing', () => {
    expect(ultraSwarmDecision('- Decision: ENGAGE')).toBe('ENGAGE');
    expect(ultraSwarmDecision('1) Decision: ADAPTIVE')).toBe('ADAPTIVE');
    expect(ultraSwarmDecision('**Decision: DEFER**')).toBe('DEFER');
  });

  it('returns undefined when no decision line is present', () => {
    expect(ultraSwarmDecision('no decision here')).toBeUndefined();
  });

  it('returns undefined for an unknown value', () => {
    expect(ultraSwarmDecision('swarm decision: MAYBE')).toBeUndefined();
  });
});

describe('ultra-swarm-decision — ultraSwarmEngageNextAction', () => {
  it('returns undefined when the plan does not ENGAGE', () => {
    expect(ultraSwarmEngageNextAction('swarm decision: DEFER')).toBeUndefined();
    expect(ultraSwarmEngageNextAction('no decision')).toBeUndefined();
  });

  it('returns the ENGAGE next-action line with the seeded-node id list when seeded', () => {
    const out = ultraSwarmEngageNextAction('swarm decision: ENGAGE', {
      seeded: true,
      nodeIds: ['ac_1', 'ac_2'],
    });
    expect(out).toContain('Swarm ENGAGE approved');
    expect(out).toContain('Approved plan WorkGraph nodes are already seeded');
    expect(out).toContain('work_node_ids: ac_1, ac_2');
    expect(out).toContain('capability coverage matrix');
  });

  it('returns the unseeded next-action line when the graph is not seeded', () => {
    const out = ultraSwarmEngageNextAction('swarm decision: ENGAGE', { seeded: false, nodeIds: [] });
    expect(out).toContain('Swarm ENGAGE approved');
    expect(out).toContain('Pass relevant UltraworkGraph work_node_ids after seeding the graph');
  });

  it('uses the default unseeded shape when the seeded argument is omitted', () => {
    const out = ultraSwarmEngageNextAction('swarm decision: ENGAGE');
    expect(out).toContain('Pass relevant UltraworkGraph work_node_ids after seeding the graph');
  });

  it('mentions the DEFER waiver escape hatch', () => {
    const out = ultraSwarmEngageNextAction('swarm decision: ENGAGE');
    expect(out).toContain('DEFER with a waiver');
  });
});
