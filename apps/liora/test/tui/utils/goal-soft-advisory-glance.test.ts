import { describe, expect, it } from 'vitest';

import { VERIFICATION_SENSOR_GOAL_DONE_TIP } from '@superliora/sdk';

import {
  formatGoalSoftAdvisoryOpsDisplayLine,
  goalSoftAdvisoryPatchFromToolResult,
  resetGoalSoftAdvisoryLedger,
} from '#/tui/utils/goal/goal-soft-advisory-glance';

describe('goalSoftAdvisoryPatchFromToolResult', () => {
  it('sets AppState advisory after RunProjectChecks failure and clears on pass', () => {
    const sessionId = 'sess-goal-advisory';
    resetGoalSoftAdvisoryLedger(sessionId);

    const failPatch = goalSoftAdvisoryPatchFromToolResult(
      sessionId,
      'RunProjectChecks',
      {},
      true,
      JSON.stringify({ summary: 'lint failed' }),
    );
    expect(failPatch.goalSoftAdvisory).toContain('RunProjectChecks failed');
    expect(failPatch.goalSoftAdvisory).toContain('lint failed');

    const passPatch = goalSoftAdvisoryPatchFromToolResult(
      sessionId,
      'RunProjectChecks',
      {},
      false,
      JSON.stringify({ exitCode: 0 }),
    );
    expect(passPatch.goalSoftAdvisory).toBeNull();
  });
});

describe('formatGoalSoftAdvisoryOpsDisplayLine', () => {
  it('shows live advisory when wired', () => {
    expect(formatGoalSoftAdvisoryOpsDisplayLine('Soft sensor: Bash failed — oops')).toBe(
      'Soft sensor: Bash failed — oops',
    );
  });

  it('falls back to W6 soft tip when advisory is absent', () => {
    expect(formatGoalSoftAdvisoryOpsDisplayLine(null)).toBe(VERIFICATION_SENSOR_GOAL_DONE_TIP);
    expect(formatGoalSoftAdvisoryOpsDisplayLine(undefined)).toBe(VERIFICATION_SENSOR_GOAL_DONE_TIP);
  });
});
