import { describe, expect, it } from 'vitest';

import {
  GOAL_FALSE_COMPLETE_CODE,
  GOAL_SOFT_ADVISORY_PREFIX,
  formatGoalFalseCompleteNotice,
  formatGoalSoftAdvisoryNotice,
  isGoalFalseCompleteOutput,
  isGoalSoftAdvisoryOutput,
} from '../../../../src/tui/utils/tools/goal-completion-notice';

describe('goal completion notices (Loop36a)', () => {
  it('detects soft advisory prefix', () => {
    expect(
      isGoalSoftAdvisoryOutput(
        `${GOAL_SOFT_ADVISORY_PREFIX} Advisory (soft — not blocking):\n- plain Goal`,
      ),
    ).toBe(true);
    expect(isGoalSoftAdvisoryOutput('Goal marked complete.')).toBe(false);
  });

  it('detects false-complete rejects', () => {
    expect(
      isGoalFalseCompleteOutput(
        `${GOAL_FALSE_COMPLETE_CODE}: Goal completion rejected (false-complete guard).`,
      ),
    ).toBe(true);
    expect(
      isGoalFalseCompleteOutput('Goal completion rejected (false-complete guard).\ncode: x'),
    ).toBe(true);
    expect(isGoalFalseCompleteOutput('ok')).toBe(false);
  });

  it('formats soft advisory notice', () => {
    const notice = formatGoalSoftAdvisoryNotice();
    expect(notice.title).toContain('soft advisory');
    expect(notice.coalesceKey).toBe('goal-soft-advisory');
    expect(notice.severity).toBe('info');
  });

  it('formats false-complete notice', () => {
    const notice = formatGoalFalseCompleteNotice();
    expect(notice.title).toContain('rejected');
    expect(notice.coalesceKey).toBe('goal-false-complete');
    expect(notice.severity).toBe('warning');
  });
});
