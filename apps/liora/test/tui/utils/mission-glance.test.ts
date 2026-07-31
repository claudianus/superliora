import { describe, expect, it } from 'vitest';

import type { GoalSnapshot } from '@superliora/sdk';

import {
  formatActiveGoalLine,
  formatGoalQueueLine,
  formatMissionRunLine,
  buildMissionSettingsLines,
} from '#/tui/utils/mission/mission-glance';

const baseGoal = (over: Partial<GoalSnapshot> = {}): GoalSnapshot =>
  ({
    goalId: 'g1',
    objective: 'ship mission settings wire',
    status: 'active',
    turnsUsed: 4,
    tokensUsed: 1200,
    wallClockMs: 8000,
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

describe('formatMissionRunLine', () => {
  it('shows active run with stage and objective when wired', () => {
    expect(
      formatMissionRunLine({
        ultraworkMode: true,
        workDir: '/tmp',
        missionRun: {
          active: true,
          status: 'running',
          stage: 'plan',
          objective: 'Wire Mission settings panel',
        },
      }),
    ).toContain('Mission run: active · stage plan · "Wire Mission settings panel"');
  });

  it('falls back when no session and mode off', () => {
    expect(
      formatMissionRunLine({
        ultraworkMode: false,
        workDir: '/tmp',
        sessionUnavailable: true,
      }),
    ).toBe('Mission run: (session unavailable)');
  });
});

describe('formatActiveGoalLine', () => {
  it('shows live goal status and counters when wired', () => {
    expect(
      formatActiveGoalLine({
        ultraworkMode: false,
        workDir: '/tmp',
        goal: baseGoal(),
      }),
    ).toContain('Active goal: active · turns 4 · tokens 1200');
  });

  it('reports none when no active goal', () => {
    expect(
      formatActiveGoalLine({
        ultraworkMode: false,
        workDir: '/tmp',
        goal: null,
      }),
    ).toBe('Active goal: none');
  });
});

describe('formatGoalQueueLine', () => {
  it('shows queued goal count when wired', () => {
    expect(
      formatGoalQueueLine({
        ultraworkMode: false,
        workDir: '/tmp',
        goalQueueCount: 2,
      }),
    ).toBe('Upcoming goals: 2 queued goals');
  });

  it('shows empty queue', () => {
    expect(
      formatGoalQueueLine({
        ultraworkMode: false,
        workDir: '/tmp',
        goalQueueCount: 0,
      }),
    ).toBe('Upcoming goals: (empty)');
  });
});

describe('buildMissionSettingsLines', () => {
  it('includes live session section beyond static tips', () => {
    const text = buildMissionSettingsLines({
      ultraworkMode: true,
      workDir: '/tmp/proj',
      missionRun: { active: true, status: 'running', stage: 'swarm', objective: 'Ops wire' },
      goal: baseGoal({ turnsUsed: 1, tokensUsed: 200 }),
      goalQueueCount: 1,
    }).join('\n');

    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Mission run: active · stage swarm');
    expect(text).toContain('Active goal: active · turns 1 · tokens 200');
    expect(text).toContain('Upcoming goals: 1 queued goal');
    expect(text).toContain('Mission Resume: artifacts');
  });
});
