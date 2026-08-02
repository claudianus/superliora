/**
 * Loop22a — step-budget early warning (soft tip, one-shot per turn).
 *
 * Research: long-running agents should surface remaining budget before hard
 * max-steps death (coding-agent-harness-2026/05-loop-engineering). Existing
 * goal-driver handles goal-mode budgets; this covers plain turn maxSteps.
 */

export const STEP_BUDGET_SENSOR_ORIGIN = 'step-budget-sensor' as const;
export const STEP_BUDGET_PREFIX = 'STEP_BUDGET:' as const;

/** Warn when remaining steps (exclusive of current) are at or below this. */
export const STEP_BUDGET_WARN_REMAINING = 3;

export interface DecideStepBudgetWarnInput {
  /** 0-based step index about to run. */
  readonly step: number;
  readonly maxSteps: number;
  /** Already warned this turn (one-shot). */
  readonly alreadyWarned: boolean;
  /** Override threshold (default {@link STEP_BUDGET_WARN_REMAINING}). */
  readonly warnWhenRemainingAtMost?: number;
}

export type StepBudgetWarnDecision =
  | { readonly warn: false; readonly reason: string }
  | {
      readonly warn: true;
      readonly remaining: number;
      readonly step: number;
      readonly maxSteps: number;
    };

/**
 * Pure decision: whether to inject a soft step-budget tip now.
 * `remaining` = maxSteps - step - 1 (steps left after the current one).
 */
export function decideStepBudgetWarn(input: DecideStepBudgetWarnInput): StepBudgetWarnDecision {
  if (input.alreadyWarned) {
    return { warn: false, reason: 'already warned this turn' };
  }
  if (!Number.isFinite(input.maxSteps) || input.maxSteps <= 0) {
    return { warn: false, reason: 'no maxSteps' };
  }
  if (!Number.isFinite(input.step) || input.step < 0) {
    return { warn: false, reason: 'invalid step' };
  }
  const remaining = input.maxSteps - input.step - 1;
  if (remaining < 0) {
    return { warn: false, reason: 'already past maxSteps' };
  }
  const threshold = input.warnWhenRemainingAtMost ?? STEP_BUDGET_WARN_REMAINING;
  if (remaining > threshold) {
    return { warn: false, reason: `remaining ${String(remaining)} > ${String(threshold)}` };
  }
  return {
    warn: true,
    remaining,
    step: input.step,
    maxSteps: input.maxSteps,
  };
}

export function formatStepBudgetWarnTip(input: {
  readonly remaining: number;
  readonly step: number;
  readonly maxSteps: number;
}): string {
  const used = input.step + 1;
  return (
    `${STEP_BUDGET_PREFIX} ${String(input.remaining)} step(s) remaining ` +
    `(${String(used)}/${String(input.maxSteps)} this turn). ` +
    `Prioritize finishing user-visible progress; avoid exploratory detours. ` +
    `If blocked, summarize status and ask rather than burning steps.`
  );
}
