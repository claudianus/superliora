import { describe, expect, it } from 'vitest';

import { swarmDecisionFromPlan, swarmEngageNextAction } from '#/agent/plan/swarm-decision';

describe('swarm-decision — swarmDecisionFromPlan', () => {
  it('parses the explicit "swarm decision: ENGAGE" line (case-insensitive)', () => {
    expect(swarmDecisionFromPlan('Plan...\nswarm decision: engage\nmore')).toBe('ENGAGE');
    expect(swarmDecisionFromPlan('swarm decision: ADAPTIVE')).toBe('ADAPTIVE');
    expect(swarmDecisionFromPlan('swarm decision: defer')).toBe('DEFER');
  });

  it('falls back to a "Decision: X" line when the explicit line is missing', () => {
    expect(swarmDecisionFromPlan('- Decision: ENGAGE')).toBe('ENGAGE');
    expect(swarmDecisionFromPlan('1) Decision: ADAPTIVE')).toBe('ADAPTIVE');
    expect(swarmDecisionFromPlan('**Decision: DEFER**')).toBe('DEFER');
  });

  it('returns undefined when no decision line is present', () => {
    expect(swarmDecisionFromPlan('no decision here')).toBeUndefined();
  });

  it('returns undefined for an unknown value', () => {
    expect(swarmDecisionFromPlan('swarm decision: MAYBE')).toBeUndefined();
  });
});

describe('swarm-decision — swarmEngageNextAction', () => {
  it('returns undefined when the plan does not ENGAGE', () => {
    expect(swarmEngageNextAction('swarm decision: DEFER')).toBeUndefined();
    expect(swarmEngageNextAction('no decision')).toBeUndefined();
  });

  it('returns the ENGAGE next-action line with the seeded-node id list when seeded', () => {
    const out = swarmEngageNextAction('swarm decision: ENGAGE', {
      seeded: true,
      nodeIds: ['ac_1', 'ac_2'],
    });
    expect(out).toContain('Swarm ENGAGE approved');
    expect(out).toContain('Approved plan WorkGraph nodes are already seeded');
    expect(out).toContain('work_node_ids: ac_1, ac_2');
    expect(out).toContain('capability coverage matrix');
  });

  it('returns the unseeded next-action line when the graph is not seeded', () => {
    const out = swarmEngageNextAction('swarm decision: ENGAGE', { seeded: false, nodeIds: [] });
    expect(out).toContain('Swarm ENGAGE approved');
    expect(out).toContain('Pass relevant TaskGraph work_node_ids after seeding the graph');
  });

  it('uses the default unseeded shape when the seeded argument is omitted', () => {
    const out = swarmEngageNextAction('swarm decision: ENGAGE');
    expect(out).toContain('Pass relevant TaskGraph work_node_ids after seeding the graph');
  });

  it('mentions the DEFER waiver escape hatch', () => {
    const out = swarmEngageNextAction('swarm decision: ENGAGE');
    expect(out).toContain('DEFER with a waiver');
  });
});
