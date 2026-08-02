import { describe, expect, it } from 'vitest';

/** Mirrors Loop28b TUI branch: step-budget soft tip detection. */
function isStepBudgetSoftWarn(code: string | undefined, message: string): boolean {
  return code === 'step-budget-sensor' || message.startsWith('STEP_BUDGET:');
}

describe('step-budget soft warn detection (Loop28b)', () => {
  it('matches sensor origin code', () => {
    expect(isStepBudgetSoftWarn('step-budget-sensor', 'anything')).toBe(true);
  });

  it('matches STEP_BUDGET message prefix', () => {
    expect(
      isStepBudgetSoftWarn(undefined, 'STEP_BUDGET: 2 step(s) remaining (8/10 this turn).'),
    ).toBe(true);
  });

  it('ignores ordinary warnings', () => {
    expect(isStepBudgetSoftWarn('provider.rate_limit', 'slow down')).toBe(false);
    expect(isStepBudgetSoftWarn(undefined, 'Warning: generic')).toBe(false);
  });
});
