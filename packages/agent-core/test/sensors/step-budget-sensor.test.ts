import { describe, expect, it } from 'vitest';

import {
  STEP_BUDGET_PREFIX,
  STEP_BUDGET_WARN_REMAINING,
  decideStepBudgetWarn,
  formatStepBudgetWarnTip,
} from '../../src/sensors/step-budget-sensor';

describe('step-budget-sensor (Loop22a)', () => {
  it('does not warn when remaining > threshold', () => {
    // max 20, step 0 → remaining 19
    const d = decideStepBudgetWarn({
      step: 0,
      maxSteps: 20,
      alreadyWarned: false,
    });
    expect(d.warn).toBe(false);
  });

  it('warns at threshold remaining (default 3)', () => {
    // max 10, step 6 → remaining 3
    const d = decideStepBudgetWarn({
      step: 6,
      maxSteps: 10,
      alreadyWarned: false,
    });
    expect(d).toEqual({
      warn: true,
      remaining: STEP_BUDGET_WARN_REMAINING,
      step: 6,
      maxSteps: 10,
    });
  });

  it('warns on last step (remaining 0)', () => {
    const d = decideStepBudgetWarn({
      step: 9,
      maxSteps: 10,
      alreadyWarned: false,
    });
    expect(d.warn).toBe(true);
    if (d.warn) expect(d.remaining).toBe(0);
  });

  it('is one-shot when alreadyWarned', () => {
    const d = decideStepBudgetWarn({
      step: 8,
      maxSteps: 10,
      alreadyWarned: true,
    });
    expect(d.warn).toBe(false);
    if (!d.warn) expect(d.reason).toContain('already warned');
  });

  it('skips invalid maxSteps', () => {
    expect(
      decideStepBudgetWarn({ step: 0, maxSteps: 0, alreadyWarned: false }).warn,
    ).toBe(false);
  });

  it('formatStepBudgetWarnTip uses STEP_BUDGET prefix', () => {
    const tip = formatStepBudgetWarnTip({ remaining: 2, step: 7, maxSteps: 10 });
    expect(tip).toContain(STEP_BUDGET_PREFIX);
    expect(tip).toContain('2 step(s) remaining');
    expect(tip).toContain('8/10');
  });
});
