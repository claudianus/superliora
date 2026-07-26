import { describe, expect, it } from 'vitest';

import {
  formatSeededWorkGraphNotice,
  parseWorkGraphNodesFromPlan,
} from '#/agent/plan/work-graph-from-plan';

describe('agent/plan/work-graph-from-plan — pure helpers', () => {
  describe('parseWorkGraphNodesFromPlan', () => {
    it('returns undefined when the plan has no WorkGraph section', () => {
      expect(parseWorkGraphNodesFromPlan('# Goal\nShip the harness.')).toBeUndefined();
    });

    it('parses a markdown table with the canonical columns', () => {
      const plan = [
        '# Plan',
        '',
        '## WorkGraph',
        '',
        '| node id | title | stage | required evidence |',
        '| ------- | ----- | ----- | ----------------- |',
        '| ac_1    | First | swarm | unit_test_pass    |',
        '| ac_2    | Second| verify| integration_pass  |',
        '',
      ].join('\n');
      const nodes = parseWorkGraphNodesFromPlan(plan);
      expect(nodes).toBeDefined();
      expect(nodes).toHaveLength(2);
      expect(nodes?.[0]?.id).toBe('ac_1');
      expect(nodes?.[0]?.stage).toBe('swarm');
      expect(nodes?.[0]?.title).toBe('First');
      expect(nodes?.[0]?.requiredEvidence).toEqual(['unit_test_pass']);
    });

    it('normalises stage synonyms (implementation → swarm, review → swarm)', () => {
      const plan = [
        '## WorkGraph',
        '',
        '| node id | stage         |',
        '| ------- | ------------- |',
        '| ac_1    | implementation|',
        '| ac_2    | review        |',
        '',
      ].join('\n');
      const nodes = parseWorkGraphNodesFromPlan(plan);
      expect(nodes?.map((n) => n.stage)).toEqual(['swarm', 'swarm']);
    });

    it('falls back to bullet parsing when the table is empty', () => {
      const plan = [
        '## WorkGraph',
        '',
        '- node id: ac_1 stage: swarm required evidence: unit_test_pass',
        '- node id: ac_2 stage: verify required evidence: integration_pass',
        '',
      ].join('\n');
      const nodes = parseWorkGraphNodesFromPlan(plan);
      expect(nodes).toHaveLength(2);
      expect(nodes?.[0]?.id).toBe('ac_1');
      expect(nodes?.[0]?.stage).toBe('swarm');
      expect(nodes?.[1]?.stage).toBe('verify');
    });

    it('returns undefined when bullets lack a valid stage', () => {
      const plan = [
        '## WorkGraph',
        '',
        '- node id: ac_1 stage: bogus required evidence: unit_test_pass',
        '',
      ].join('\n');
      expect(parseWorkGraphNodesFromPlan(plan)).toBeUndefined();
    });

    it('stops the section at the next top-level heading', () => {
      const plan = [
        '## WorkGraph',
        '',
        '| node id | stage |',
        '| ------- | ----- |',
        '| ac_1    | swarm |',
        '',
        '## Next',
        '',
        '| node id | stage |',
        '| ------- | ----- |',
        '| ac_2    | swarm |',
        '',
      ].join('\n');
      const nodes = parseWorkGraphNodesFromPlan(plan);
      expect(nodes).toHaveLength(1);
      expect(nodes?.[0]?.id).toBe('ac_1');
    });
  });

  describe('formatSeededWorkGraphNotice', () => {
    it('returns undefined for an unseeded result', () => {
      expect(formatSeededWorkGraphNotice({ seeded: false, nodeIds: [] })).toBeUndefined();
    });

    it('returns undefined when seeded but nodeIds is empty', () => {
      expect(formatSeededWorkGraphNotice({ seeded: true, nodeIds: [] })).toBeUndefined();
    });

    it('formats a complete notice with the run id and node ids', () => {
      const notice = formatSeededWorkGraphNotice({
        seeded: true,
        runId: 'run-42',
        nodeIds: ['ac_1', 'ac_2', 'ac_3'],
      });
      expect(notice).toBeDefined();
      expect(notice).toContain('UltraworkGraph was seeded');
      expect(notice).toContain('run_id: run-42');
      expect(notice).toContain('work_node_ids: ac_1, ac_2, ac_3');
      expect(notice).toContain('UltraSwarm');
    });

    it('falls back to "ultra-plan" when runId is missing', () => {
      const notice = formatSeededWorkGraphNotice({ seeded: true, nodeIds: ['ac_1'] });
      expect(notice).toContain('run_id: ultra-plan');
    });
  });
});
