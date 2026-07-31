import { describe, expect, it } from 'vitest';

import { inferUltraPlanPhaseFromPlanContent } from '#/mission';

describe('ultrawork/plan-phase.ts — inferUltraPlanPhaseFromPlanContent', () => {
  it('returns undefined for empty or whitespace-only content', () => {
    expect(inferUltraPlanPhaseFromPlanContent('')).toBeUndefined();
    expect(inferUltraPlanPhaseFromPlanContent('   \n  \n')).toBeUndefined();
  });

  it('returns "design" when only the seed-spec body is present', () => {
    // All three seed-spec anchors must be present (each followed by
    // non-whitespace) for the body gate to flip; missing the Verification
    // Plan keeps the plan in undefined territory.
    const content = [
      'Verifiable UltraGoal: ship the harness',
      'Acceptance Criteria: tests pass',
      'Verification Plan: run vitest',
    ].join('\n');
    expect(inferUltraPlanPhaseFromPlanContent(content)).toBe('design');
  });

  it('returns "review" when seed spec + swarm decision are present', () => {
    const content = [
      'Verifiable UltraGoal: ship the harness',
      'Acceptance Criteria: tests pass',
      'Verification Plan: run vitest',
      'Swarm decision: ENGAGE',
    ].join('\n');
    expect(inferUltraPlanPhaseFromPlanContent(content)).toBe('review');
  });

  it('returns "write" as soon as the execution plan OR work graph is sketched', () => {
    const execOnly = '## Execution Plan\n\n- step 1\n- step 2';
    expect(inferUltraPlanPhaseFromPlanContent(execOnly)).toBe('write');

    const graphOnly = '## WorkGraph\n\n- node a\n- node b';
    expect(inferUltraPlanPhaseFromPlanContent(graphOnly)).toBe('write');
  });

  it('returns "exit" when execution plan + work graph + swarm decision + seed spec are all present', () => {
    const content = [
      'Verifiable UltraGoal: ship the harness',
      'Acceptance Criteria: tests pass',
      'Verification Plan: run vitest',
      '',
      '## Execution Plan',
      '- step 1',
      '- step 2',
      '',
      '## WorkGraph',
      '- node a',
      '',
      'Swarm decision: ADAPTIVE',
    ].join('\n');
    expect(inferUltraPlanPhaseFromPlanContent(content)).toBe('exit');
  });

  it('treats the swarm decision case-insensitively', () => {
    const content = [
      '## Execution Plan',
      '- x',
      '## WorkGraph',
      '- y',
      'Verifiable UltraGoal: g',
      'Acceptance Criteria: c',
      'Verification Plan: v',
      'Swarm decision: engage',
    ].join('\n');
    expect(inferUltraPlanPhaseFromPlanContent(content)).toBe('exit');
  });

  it('rejects a Swarm decision line that does not match ENGAGE/ADAPTIVE/DEFER', () => {
    const content = [
      '## Execution Plan',
      '- x',
      '## WorkGraph',
      '- y',
      'Verifiable UltraGoal: g',
      'Acceptance Criteria: c',
      'Verification Plan: v',
      'Swarm decision: maybe',
    ].join('\n');
    // All four gate conditions are required for `exit`; without a valid
    // swarm decision the plan still counts as `write`.
    expect(inferUltraPlanPhaseFromPlanContent(content)).toBe('write');
  });

  it('returns undefined when no recognised headings are present', () => {
    expect(inferUltraPlanPhaseFromPlanContent('just a free-form note\nwith no headings')).toBeUndefined();
  });
});
