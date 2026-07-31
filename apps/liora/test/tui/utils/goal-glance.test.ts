import { describe, expect, it } from 'vitest';

import type { GoalSnapshot } from '@superliora/sdk';

import {
  OPS_GOAL_XP_SOFT_TIP,
  formatGoalXpOpsLine,
  resolveGoalXpOpsGlance,
} from '#/tui/utils/goal/goal-glance';

const baseGoal = (over: Partial<GoalSnapshot> = {}): GoalSnapshot =>
  ({
    goalId: 'g1',
    objective: 'ship it',
    status: 'active',
    turnsUsed: 2,
    tokensUsed: 400,
    wallClockMs: 5000,
    budget: {
      tokenBudget: null,
      turnBudget: null,
      wallClockBudgetMs: null,
      remainingTokens: null,
      remainingTurns: null,
      remainingWallClockMs: null,
      tokenBudgetReached: false,
      turnBudgetReached: false,
      wallClockBudgetReached: false,
      overBudget: false,
    },
    ...over,
  }) as GoalSnapshot;

describe('resolveGoalXpOpsGlance', () => {
  it('prefers contextOS ready pages for evidence when wired', () => {
    expect(
      resolveGoalXpOpsGlance({
        goal: baseGoal(),
        appState: { goalEvidenceCount: 1 },
        statusContextOS: {
          pageCount: 5,
          readyPageCount: 3,
          needsRehydrationPageCount: 0,
          atRiskPageCount: 0,
          missingEvidencePageCount: 0,
          evidenceIdRecallScore: 0.9,
          latestContinuityStatus: 'ready',
        },
      }),
    ).toEqual({
      turnsUsed: 2,
      tokensUsed: 400,
      evidenceCount: 3,
      xpPulseCount: 1,
    });
  });

  it('falls back to local goalEvidenceCount when contextOS pages are absent', () => {
    expect(
      resolveGoalXpOpsGlance({
        goal: baseGoal({ turnsUsed: 0, tokensUsed: 0 }),
        appState: { goalEvidenceCount: 2 },
      }),
    ).toEqual({
      turnsUsed: 0,
      tokensUsed: 0,
      evidenceCount: 2,
      xpPulseCount: 2,
    });
  });
});

describe('formatGoalXpOpsLine', () => {
  it('shows live turns and evidence when wired', () => {
    expect(
      formatGoalXpOpsLine({
        turnsUsed: 3,
        evidenceCount: 2,
      }),
    ).toBe('XP: 3 turns · 2 evidence');
  });

  it('shows evidence-only line when turns are zero', () => {
    expect(formatGoalXpOpsLine({ evidenceCount: 4 })).toBe('Evidence: 4 ready');
  });

  it('shows local progress ticks when only xpPulseCount is wired', () => {
    expect(formatGoalXpOpsLine({ xpPulseCount: 2 })).toBe('XP: 2 progress ticks');
  });

  it('falls back to the soft tip when no counters exist', () => {
    expect(formatGoalXpOpsLine(null)).toBe(OPS_GOAL_XP_SOFT_TIP);
  });
});
