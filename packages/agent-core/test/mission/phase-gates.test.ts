import { describe, expect, it } from 'vitest';

import {
  isAllowedUltraPlanAdvance,
  isForwardOneStepPhase,
  nextUltraPlanPhase,
  ULTRA_PLAN_PHASE_ORDER,
} from '#/tools/builtin/planning/next-phase';
import { missingUltraPlanSections } from '#/tools/builtin/planning/exit-plan-mode/ultra-validation';

describe('Mission phase gates (pure)', () => {
  it('orders phases forward one step only', () => {
    expect(nextUltraPlanPhase('research')).toBe('interview');
    expect(nextUltraPlanPhase('interview')).toBe('design');
    expect(nextUltraPlanPhase('exit')).toBeUndefined();

    expect(isForwardOneStepPhase('research', 'interview')).toBe(true);
    expect(isForwardOneStepPhase('research', 'design')).toBe(false);
    expect(isForwardOneStepPhase('design', 'interview')).toBe(false);

    for (let i = 0; i < ULTRA_PLAN_PHASE_ORDER.length - 1; i++) {
      const from = ULTRA_PLAN_PHASE_ORDER[i]!;
      const to = ULTRA_PLAN_PHASE_ORDER[i + 1]!;
      expect(isForwardOneStepPhase(from, to)).toBe(true);
    }
  });

  it('allows interview→write and design→write fast paths', () => {
    expect(isAllowedUltraPlanAdvance('interview', 'write')).toBe(true);
    expect(isAllowedUltraPlanAdvance('design', 'write')).toBe(true);
    expect(isAllowedUltraPlanAdvance('research', 'write')).toBe(false);
  });

  it('flags missing minimum ExitPlanMode sections', () => {
    const empty = missingUltraPlanSections('# Plan\n\nTODO');
    expect(empty).toEqual(
      expect.arrayContaining([
        'Seed Spec',
        'AC Tree',
        'WorkGraph',
        'Evaluation Plan',
        'Execution Plan',
      ]),
    );
  });

  it('accepts a minimal complete Mission plan body', () => {
    const plan = `
## Seed Spec
- Verifiable UltraGoal: Ship auth refresh path hardened against token reuse.
- Completion Criterion: All refresh tests pass and reuse is rejected.
- Actors: api users
- Inputs: refresh tokens
- Outputs: new access tokens
- Constraints: no breaking public API
- Non-goals: rewrite OAuth provider
- Acceptance Criteria: reuse rejected; happy path green
- Verification Plan: vitest packages/auth
- Failure Modes: clock skew
- Runtime Context: node 24

## AC Tree
- [ ] ac_refresh_reject_reuse

## WorkGraph
| Node ID | AC ID | Stage | Owner | Dependencies | Required Evidence |
| n1 | ac_refresh_reject_reuse | implement | main | - | vitest |

## Swarm Decision
Swarm decision: DEFER - single lane main ownership
- Decision: DEFER
- Reason: one owner
- Specialist value: none
- Verification owner: main
- Swarm DEFER waiver: main owns all lanes

## Evaluation Plan
- Run vitest for auth package

## Execution Plan
1. Add reuse rejection test
2. Implement fix
3. Verify
`;
    const missing = missingUltraPlanSections(plan);
    expect(missing).toEqual([]);
  });
});
