/**
 * Loop36a — surface Goal completion soft advisories and false-complete rejects.
 *
 * UpdateGoal(complete) may return soft tips (plain goal without evidence gate)
 * or isError false-complete rejects. Without notices the operator only sees a
 * tool card while the model may still claim "done".
 */

export const GOAL_SOFT_ADVISORY_PREFIX = 'GOAL_SOFT_ADVISORY:';
export const GOAL_FALSE_COMPLETE_CODE = 'GOAL_FALSE_COMPLETE';

export type GoalCompletionNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'goal-soft-advisory' | 'goal-false-complete';
  readonly severity: 'info' | 'warning' | 'error';
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isGoalSoftAdvisoryOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(GOAL_SOFT_ADVISORY_PREFIX) || text.includes('Advisory (soft — not blocking)');
}

export function isGoalFalseCompleteOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return (
    text.includes(GOAL_FALSE_COMPLETE_CODE) ||
    text.includes('Goal completion rejected (false-complete guard)')
  );
}

export function formatGoalSoftAdvisoryNotice(): GoalCompletionNotice {
  return {
    title: 'Goal complete — soft advisory',
    detail:
      'UpdateGoal(complete) accepted without a live WorkGraph evidence hard gate (or with sticky check failures). Confirm RunProjectChecks / proof before treating the goal as fully done.',
    status: 'Goal complete with soft advisory — verify evidence',
    coalesceKey: 'goal-soft-advisory',
    severity: 'info',
  };
}

export function formatGoalFalseCompleteNotice(): GoalCompletionNotice {
  return {
    title: 'Goal complete rejected',
    detail:
      'False-complete guard rejected UpdateGoal(complete) (missing WorkGraph evidence). Keep implementing and verifying — do not claim done yet.',
    status: 'Goal complete rejected — continue work',
    coalesceKey: 'goal-false-complete',
    severity: 'warning',
  };
}
