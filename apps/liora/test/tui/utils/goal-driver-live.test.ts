import { describe, expect, it } from 'vitest';

import {
  GOAL_DESK_SPAWN_GRACE_MS,
  goalDeskLiveKey,
  goalDriverLiveKey,
  pickGoalDriverLive,
  resolveGoalDeskLive,
} from '#/tui/utils/job/goal-driver-live';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';
import type { GoalSnapshot } from '@superliora/sdk';

function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'g1',
    objective: 'Ship it',
    status: 'active',
    turnsUsed: 0,
    tokensUsed: 0,
    wallClockMs: 0,
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
    execution: 'goal-desk',
    deskJobId: 'job_desk1',
    ...overrides,
  };
}

function card(overrides: Partial<ConductorJobCard>): ConductorJobCard {
  return {
    id: 'job_driver1',
    title: 'Goal: Ship it',
    status: 'running',
    kind: 'goal-driver',
    priority: 11,
    updatedAtMs: 100,
    ...overrides,
  };
}

describe('pickGoalDriverLive', () => {
  it('returns undefined for non-desk goals', () => {
    expect(pickGoalDriverLive(goal({ execution: 'agent' }), [card({})])).toBeUndefined();
  });

  it('prefers a running goal-driver over queued', () => {
    const live = pickGoalDriverLive(goal(), [
      card({ id: 'queued', status: 'queued', updatedAtMs: 200 }),
      card({ id: 'running', status: 'running', updatedAtMs: 50 }),
    ]);
    expect(live?.jobId).toBe('running');
  });

  it('includes phase and live activity when present', () => {
    const live = pickGoalDriverLive(goal(), [
      card({
        progress: { phase: 'running tests', recentTools: ['Bash'] },
        liveActivity: {
          toolCallId: 't1',
          name: 'Bash',
          status: 'running',
          atMs: 1,
        },
      }),
    ]);
    expect(live?.phase).toBe('running tests');
    expect(live?.liveActivity?.name).toBe('Bash');
    expect(goalDriverLiveKey(live)).toContain('Bash');
  });
});

describe('resolveGoalDeskLive', () => {
  it('spins up only inside the spawn grace when the board is empty', () => {
    expect(resolveGoalDeskLive(goal(), [], 1_000)).toEqual({ mode: 'spinning_up' });
    expect(resolveGoalDeskLive(goal(), [], GOAL_DESK_SPAWN_GRACE_MS + 1)).toEqual({
      mode: 'missing_worker',
    });
  });

  it('surfaces fleet verify while the goal-driver card is missing', () => {
    const live = resolveGoalDeskLive(
      goal(),
      [
        card({
          id: 'job_verify1',
          kind: 'verify',
          status: 'running',
          title: 'Verify: Iron Vanguard',
          updatedAtMs: 200,
        }),
      ],
      60_000,
    );
    expect(live).toMatchObject({
      mode: 'fleet',
      kind: 'verify',
      status: 'running',
    });
  });

  it('awaits Conductor after the last worker finished', () => {
    const live = resolveGoalDeskLive(
      goal(),
      [
        card({
          id: 'job_verify1',
          kind: 'verify',
          status: 'done',
          title: 'Verify: Iron Vanguard',
          updatedAtMs: 200,
        }),
      ],
      60_000,
    );
    expect(live).toEqual({
      mode: 'awaiting_conductor',
      lastKind: 'verify',
      lastTitle: 'Verify: Iron Vanguard',
      lastStatus: 'done',
    });
    expect(goalDeskLiveKey(live)).toContain('awaiting_conductor');
  });

  it('keeps a settled goal-driver visible instead of spinning up', () => {
    const live = resolveGoalDeskLive(
      goal(),
      [card({ status: 'done', updatedAtMs: 300 })],
      60_000,
    );
    expect(live).toMatchObject({ mode: 'driver', driver: { status: 'done' } });
  });
});
