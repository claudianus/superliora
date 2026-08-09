/**
 * Loop36a — surface Goal completion soft advisories and false-complete rejects.
 *
 * UpdateGoal(complete) may return soft tips (plain goal without evidence gate)
 * or isError false-complete rejects. Without notices the operator only sees a
 * tool card while the model may still claim "done".
 */

import { ttui } from '#/tui/utils/tui-i18n';

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
    title: ttui('tui.notice.goalCompleteSoft.title'),
    detail: ttui('tui.notice.goalCompleteSoft.detail'),
    status: ttui('tui.notice.goalCompleteSoft.status'),
    coalesceKey: 'goal-soft-advisory',
    severity: 'info',
  };
}

export function formatGoalFalseCompleteNotice(): GoalCompletionNotice {
  return {
    title: ttui('tui.notice.goalCompleteRejected.title'),
    detail: ttui('tui.notice.goalCompleteRejected.detail'),
    status: ttui('tui.notice.goalCompleteRejected.status'),
    coalesceKey: 'goal-false-complete',
    severity: 'warning',
  };
}
