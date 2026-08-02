import { describe, expect, it } from 'vitest';

import type { GoalSnapshot } from '@superliora/sdk';

import {
  GOAL_XP_PULSE_BADGE_TTL_MS,
  formatGoalXpPulseFooterBadge,
  shouldGoalXpPulse,
} from '#/tui/utils/goal/goal-xp-pulse';

const baseGoal = (over: Partial<GoalSnapshot> = {}): GoalSnapshot =>
  ({
    goalId: 'g1',
    objective: 'ship it',
    status: 'active',
    turnsUsed: 1,
    tokensUsed: 100,
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

describe('shouldGoalXpPulse', () => {
  it('pulses when turns or tokens increase on the same goal', () => {
    const prev = baseGoal({ turnsUsed: 2, tokensUsed: 200 });
    expect(shouldGoalXpPulse(prev, baseGoal({ turnsUsed: 3, tokensUsed: 200 }))).toBe(true);
    expect(shouldGoalXpPulse(prev, baseGoal({ turnsUsed: 2, tokensUsed: 250 }))).toBe(true);
  });

  it('skips first snapshot, completion, and flat stats', () => {
    const prev = baseGoal();
    expect(shouldGoalXpPulse(undefined, prev)).toBe(false);
    expect(shouldGoalXpPulse(prev, baseGoal({ status: 'complete' }))).toBe(false);
    expect(shouldGoalXpPulse(prev, baseGoal({ turnsUsed: 1, tokensUsed: 100 }))).toBe(false);
    expect(shouldGoalXpPulse(prev, baseGoal({ goalId: 'g2', turnsUsed: 5 }))).toBe(false);
  });
});

describe('formatGoalXpPulseFooterBadge', () => {
  const atMs = 1_000_000;

  it('shows xp within TTL', () => {
    expect(
      formatGoalXpPulseFooterBadge({ atMs }, atMs + GOAL_XP_PULSE_BADGE_TTL_MS - 1, 'compact'),
    ).toEqual({
      text: 'xp',
      severity: 'info',
    });
  });

  it('hides at and after TTL', () => {
    expect(
      formatGoalXpPulseFooterBadge({ atMs }, atMs + GOAL_XP_PULSE_BADGE_TTL_MS, 'compact'),
    ).toBeNull();
  });
});
