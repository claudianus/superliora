import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  formatGoalBlockedCopy,
  goalMonitorBorderToken,
  goalMonitorSnapshotKey,
  goalMonitorStatusToken,
  goalMonitorTitle,
  isLiveGoal,
  isLiveGoalStatus,
  renderGoalMonitorLines,
} from '#/tui/components/chrome/goal-monitor';
import type { GoalSnapshot } from '@superliora/sdk';

const previousChalkLevel = chalk.level;
const previousCI = process.env['CI'];

beforeAll(() => {
  chalk.level = 3;
  process.env['CI'] = '1';
});

afterAll(() => {
  chalk.level = previousChalkLevel;
  if (previousCI === undefined) delete process.env['CI'];
  else process.env['CI'] = previousCI;
});

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'g1',
    objective: 'Ship the live goal monitor panel',
    completionCriterion: 'Panel stays visible while goal is active',
    status: 'active',
    turnsUsed: 7,
    tokensUsed: 128_400,
    wallClockMs: 252_000,
    budget: {
      turnBudget: 20,
      tokenBudget: 500_000,
      wallClockBudgetMs: 3_600_000,
      remainingTurns: 13,
      remainingTokens: 371_600,
      remainingWallClockMs: 3_348_000,
      tokenBudgetReached: false,
      turnBudgetReached: false,
      wallClockBudgetReached: false,
      overBudget: false,
    },
    ...overrides,
  } as GoalSnapshot;
}

describe('isLiveGoal / isLiveGoalStatus', () => {
  it('treats active/paused/blocked as live and complete as not', () => {
    expect(isLiveGoalStatus('active')).toBe(true);
    expect(isLiveGoalStatus('paused')).toBe(true);
    expect(isLiveGoalStatus('blocked')).toBe(true);
    expect(isLiveGoalStatus('complete')).toBe(false);
    expect(isLiveGoal(goal({ status: 'active' }))).toBe(true);
    expect(isLiveGoal(goal({ status: 'complete' }))).toBe(false);
    expect(isLiveGoal(null)).toBe(false);
    expect(isLiveGoal(undefined)).toBe(false);
  });
});

describe('goalMonitor tokens/title', () => {
  it('maps status to border and status color tokens', () => {
    expect(goalMonitorBorderToken('active')).toBe('primary');
    expect(goalMonitorBorderToken('paused')).toBe('textMuted');
    expect(goalMonitorBorderToken('blocked')).toBe('warning');
    expect(goalMonitorStatusToken('active')).toBe('primary');
    expect(goalMonitorStatusToken('blocked')).toBe('warning');
  });

  it('renders compact title for tiny profile', () => {
    const g = goal({ status: 'active' });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    expect(goalMonitorTitle(g, 'tiny')).toBe(' Goal ');
    expect(goalMonitorTitle(g, 'standard')).toBe(' Goal · active ');
  });

  it('marks Goal Desk goals in the panel title', () => {
    const g = goal({ status: 'active', execution: 'goal-desk', deskJobId: 'job_desk1' });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    expect(goalMonitorTitle(g, 'standard')).toBe(' Goal · desk · active ');
  });
});

describe('renderGoalMonitorLines', () => {
  it('renders status, objective, criterion, and budget chips for an active goal', () => {
    const g = goal();
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 80,
      wallClockMs: g.wallClockMs,
      profile: 'standard',
    })
      .map(strip)
      .join('\n');

    expect(joined).toMatch(/active/);
    expect(joined).toContain('Ship the live goal monitor panel');
    expect(joined).toContain('when · Panel stays visible while goal is active');
    expect(joined).toMatch(/4m 12s/);
    expect(joined).toMatch(/7\/20 turns/);
    expect(joined).toMatch(/turns left|tok left|left/);
    expect(joined).toMatch(/[█░]/);
  });

  it('surfaces blocked reason', () => {
    const g = goal({ status: 'blocked', terminalReason: 'waiting on user approval' });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 80,
      wallClockMs: g.wallClockMs,
    })
      .map(strip)
      .join('\n');
    expect(joined).toContain('waiting on user approval');
    expect(joined).toMatch(/blocked|⚠/);
    expect(joined).toMatch(/\/goal resume/);
  });

  it('humanizes worker-model blockers with recovery next steps', () => {
    expect(
      formatGoalBlockedCopy(
        'no live worker model for goal-driver (tried opencode/kimi-k2.5, opencode/glm-5) — pin a live model',
      ),
    ).toMatchObject({
      headline: 'no live worker model (tried opencode/kimi-k2.5, opencode/glm-5)',
      next: '/model → live coding model · /goal resume',
    });

    const g = goal({
      status: 'blocked',
      execution: 'goal-desk',
      deskJobId: 'job_desk1',
      terminalReason:
        'no live worker model for goal-driver (tried opencode/kimi-k2.5) — pin a live model with /model',
    });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 90,
      wallClockMs: g.wallClockMs,
      deskLive: {
        mode: 'driver',
        driver: {
          jobId: 'job_driver1',
          status: 'blocked',
          title: 'Goal: Ship game',
        },
      },
    })
      .map(strip)
      .join('\n');
    expect(joined).toMatch(/no live worker model/);
    expect(joined).toMatch(/\/model/);
    expect(joined).toMatch(/\/goal resume/);
    expect(joined).toMatch(/worker blocked/);
    expect(joined).not.toContain('no live-healthy worker model in role chain');
  });

  it('omits progress strip on tiny profile', () => {
    const g = goal();
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 40,
      wallClockMs: g.wallClockMs,
      profile: 'tiny',
    })
      .map(strip)
      .join('\n');
    expect(joined).toContain('Ship the live goal monitor panel');
    expect(joined).not.toMatch(/█/);
  });

  it('shows desk chip and spinning-up worker row for fresh Goal Desk goals', () => {
    const g = goal({ execution: 'goal-desk', deskJobId: 'job_desk1', wallClockMs: 3_000 });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 80,
      wallClockMs: 3_000,
      profile: 'standard',
      deskLive: { mode: 'spinning_up' },
    })
      .map(strip)
      .join('\n');
    expect(joined).toMatch(/desk/);
    expect(joined).toMatch(/spinning up goal worker/);
  });

  it('does not claim spinning-up after workers finished with no driver', () => {
    const g = goal({ execution: 'goal-desk', deskJobId: 'job_desk1', wallClockMs: 600_000 });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 80,
      wallClockMs: 600_000,
      deskLive: {
        mode: 'awaiting_conductor',
        lastKind: 'verify',
        lastStatus: 'done',
        lastTitle: 'Verify: Iron Vanguard',
      },
    })
      .map(strip)
      .join('\n');
    expect(joined).toMatch(/awaiting Conductor/);
    expect(joined).toMatch(/verify/);
    expect(joined).not.toMatch(/spinning up goal worker/);
    expect(joined).toContain('when ·');
    expect(joined).not.toMatch(/✓ Objective met|✓ Panel/);
  });

  it('surfaces live goal-driver tool activity on the monitor', () => {
    const g = goal({ execution: 'goal-desk', deskJobId: 'job_desk1' });
    if (!isLiveGoal(g)) throw new Error('expected live goal');
    const joined = renderGoalMonitorLines({
      goal: g,
      width: 80,
      wallClockMs: g.wallClockMs,
      deskLive: {
        mode: 'driver',
        driver: {
          jobId: 'job_driver1',
          status: 'running',
          title: 'Goal: Ship dashboard',
          liveActivity: {
            toolCallId: 'tc1',
            name: 'Edit',
            target: 'apps/liora/src/tui/foo.ts',
            status: 'running',
            atMs: Date.now(),
          },
        },
      },
    })
      .map(strip)
      .join('\n');
    expect(joined).toMatch(/worker/);
    expect(joined).toContain('Edit');
    expect(joined).toContain('foo.ts');
  });
});

describe('goalMonitorSnapshotKey', () => {
  it('changes when progress or status changes', () => {
    const a = goalMonitorSnapshotKey(goal());
    const b = goalMonitorSnapshotKey(goal({ turnsUsed: 8 }));
    const c = goalMonitorSnapshotKey(goal({ status: 'paused' }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(goalMonitorSnapshotKey(null)).toBeNull();
  });
});
