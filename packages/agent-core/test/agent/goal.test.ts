import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  GoalMode,
  type GoalChange,
  type GoalSnapshot,
} from '../../src/agent/goal';
import type { AgentRecord } from '../../src/agent/records';
import type { AgentReplayRecord } from '../../src/rpc/resumed';
import { ErrorCodes } from '../../src/errors';
import type { TelemetryProperties } from '../../src/telemetry';

interface TelemetryRecord {
  readonly event: string;
  readonly properties: TelemetryProperties;
}

function makeGoalMode(options: { readonly cwd?: string } = {}) {
  const records: AgentRecord[] = [];
  const replay: AgentReplayRecord[] = [];
  const events: Array<{ readonly type: string; readonly snapshot?: GoalSnapshot | null; readonly change?: GoalChange }> = [];
  const telemetry: TelemetryRecord[] = [];
  const reminders: Array<{ readonly content: string; readonly origin: unknown }> = [];
  const agent = {
    config: { cwd: options.cwd ?? process.cwd() },
    records: {
      logRecord: (record: AgentRecord) => {
        records.push(record);
      },
    },
    emitEvent: (event: { readonly type: string; readonly snapshot?: GoalSnapshot | null; readonly change?: GoalChange }) => {
      events.push(event);
    },
    telemetry: {
      track: (event: string, properties: TelemetryProperties) => {
        telemetry.push({ event, properties });
      },
    },
    context: {
      appendSystemReminder: (content: string, origin: unknown) => {
        reminders.push({ content, origin });
      },
    },
    replayBuilder: {
      push: (record: AgentReplayRecord) => {
        replay.push(record);
      },
    },
  } as unknown as Agent;

  return {
    goals: new GoalMode(agent),
    records,
    replay,
    events,
    telemetry,
    reminders,
  };
}

describe('GoalMode creation', () => {
  it('creates a goal and exposes it through getGoal', async () => {
    const { goals } = makeGoalMode();

    const snapshot = await goals.createGoal({ objective: 'Ship feature X' });

    expect(snapshot.objective).toBe('Ship feature X');
    expect(snapshot.status).toBe('active');
    expect(goals.getGoal().goal?.goalId).toBe(snapshot.goalId);
  });

  it('stores a completion criterion when provided', async () => {
    const { goals } = makeGoalMode();

    const snapshot = await goals.createGoal({
      objective: 'Ship feature X',
      completionCriterion: ' tests pass ',
    });

    expect(snapshot.completionCriterion).toBe('tests pass');
    expect(goals.getGoal().goal?.completionCriterion).toBe('tests pass');
  });

  it('sets no default work caps when none is provided', async () => {
    const { goals } = makeGoalMode();

    const snapshot = await goals.createGoal({ objective: 'Do work' });

    expect(snapshot.budget.turnBudget).toBeNull();
    expect(snapshot.budget.tokenBudget).toBeNull();
    expect(snapshot.budget.wallClockBudgetMs).toBeNull();
    expect(snapshot.budget.overBudget).toBe(false);
  });

  it('rejects empty and too-long objectives', async () => {
    const { goals } = makeGoalMode();

    await expect(goals.createGoal({ objective: '   ' })).rejects.toMatchObject({
      code: ErrorCodes.GOAL_OBJECTIVE_EMPTY,
    });
    await expect(goals.createGoal({ objective: 'x'.repeat(4001) })).rejects.toMatchObject({
      code: ErrorCodes.GOAL_OBJECTIVE_TOO_LONG,
    });
  });

  it('rejects duplicate active, paused, and blocked goals without replace', async () => {
    const { goals } = makeGoalMode();

    await goals.createGoal({ objective: 'first' });
    await expect(goals.createGoal({ objective: 'second' })).rejects.toMatchObject({
      code: ErrorCodes.GOAL_ALREADY_EXISTS,
    });
    await goals.pauseGoal();
    await expect(goals.createGoal({ objective: 'second' })).rejects.toMatchObject({
      code: ErrorCodes.GOAL_ALREADY_EXISTS,
    });
    await goals.resumeGoal();
    await goals.markBlocked({ reason: 'stuck' });
    await expect(goals.createGoal({ objective: 'second' })).rejects.toMatchObject({
      code: ErrorCodes.GOAL_ALREADY_EXISTS,
    });
  });

  it('replaces an existing goal when replace is set', async () => {
    const { goals, records } = makeGoalMode();

    const first = await goals.createGoal({ objective: 'first' });
    const second = await goals.createGoal({ objective: 'second', replace: true });

    expect(second.goalId).not.toBe(first.goalId);
    expect(goals.getGoal().goal?.objective).toBe('second');
    expect(records.map((record) => record.type)).toEqual(['goal.create', 'goal.clear', 'goal.create']);
  });
});

describe('GoalMode lifecycle', () => {
  it('emits typed lifecycle and completion changes', async () => {
    const { goals, events } = makeGoalMode();

    await goals.createGoal({ objective: 'work', completionCriterion: 'tests pass' });
    expect(events.at(-1)?.change).toBeUndefined();

    await goals.pauseGoal();
    expect(events.at(-1)?.change).toMatchObject({ kind: 'lifecycle', status: 'paused' });

    await goals.resumeGoal();
    expect(events.at(-1)?.change).toMatchObject({ kind: 'lifecycle', status: 'active' });

    await goals.markComplete({ reason: 'done' }, 'model');
    const completion = events.find((event) => event.change?.kind === 'completion')?.change;
    expect(completion).toMatchObject({ kind: 'completion', status: 'complete', reason: 'done' });
    expect(goals.getGoal().goal).toBeNull();
    expect(events.at(-1)?.snapshot).toBeNull();
  });

  it('keeps blocked goals resumable', async () => {
    const { goals } = makeGoalMode();

    await goals.createGoal({ objective: 'work', completionCriterion: 'tests pass' });
    const blocked = await goals.markBlocked({ reason: 'need creds' });
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.terminalReason).toBe('need creds');

    const resumed = await goals.resumeGoal();
    expect(resumed.status).toBe('active');
    expect(resumed.terminalReason).toBeUndefined();
  });

  it('pauseOnInterrupt parks active goals and no-ops for stopped goals', async () => {
    const { goals } = makeGoalMode();

    await goals.createGoal({ objective: 'work', completionCriterion: 'tests pass' });
    const paused = await goals.pauseOnInterrupt({ reason: 'Paused after interruption' });
    expect(paused?.status).toBe('paused');
    expect(paused?.terminalReason).toBe('Paused after interruption');

    expect(await goals.pauseOnInterrupt({ reason: 'again' })).toBeNull();
    expect(goals.getGoal().goal?.status).toBe('paused');
  });

  it('cancelGoal discards the goal and throws when missing', async () => {
    const { goals, reminders } = makeGoalMode();

    await goals.createGoal({ objective: 'work' });
    const removed = await goals.cancelGoal();
    expect(removed.status).toBe('active');
    expect(goals.getGoal()).toEqual({ goal: null });
    expect(reminders).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('Ignore earlier active-goal reminders'),
        origin: { kind: 'system_trigger', name: 'goal_cancelled' },
      }),
    ]);
    await expect(goals.cancelGoal()).rejects.toMatchObject({ code: ErrorCodes.GOAL_NOT_FOUND });
  });
});

describe('GoalMode gate command', () => {
  // Gate commands run via the system shell in a temp cwd that is not a git
  // worktree, so the workspace hash is unavailable and every attempt runs.
  async function makeGatedGoal(gateCommand: string) {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('pathe');
    const cwd = await mkdtemp(path.join(tmpdir(), 'goal-gate-'));
    const harness = makeGoalMode({ cwd });
    await harness.goals.createGoal({ objective: 'work', gateCommand });
    return harness;
  }

  it('stores the gate command on the snapshot and the create record', async () => {
    const { goals, records } = await makeGatedGoal('exit 0');
    expect(goals.getGoal().goal?.gateCommand).toBe('exit 0');
    const create = records.find((record) => record.type === 'goal.create');
    expect(create).toMatchObject({ gateCommand: 'exit 0' });
  });

  it('rejects completion when the gate fails and keeps the goal active', async () => {
    const { goals } = await makeGatedGoal('exit 1');

    const completed = await goals.markComplete({ reason: 'done' }, 'model');

    expect(completed).toBeNull();
    expect(goals.getGoal().goal?.status).toBe('active');
    expect(goals.getLastCompletionRejection()?.code).toBe('gate_failed');
  });

  it('completes when the gate passes', async () => {
    const { goals } = await makeGatedGoal('exit 0');

    const completed = await goals.markComplete({ reason: 'done' }, 'model');

    expect(completed?.status).toBe('complete');
    expect(goals.getGoal().goal).toBeNull();
  });

  it('restores the gate command from the create record on replay', async () => {
    const { goals, records } = await makeGatedGoal('npm run check');
    const create = records.find((record) => record.type === 'goal.create');
    expect(create).toBeDefined();

    const restored = makeGoalMode();
    restored.goals.restoreCreate(create as never);

    expect(restored.goals.getGoal().goal?.gateCommand).toBe('npm run check');
  });

  it('blocks the goal once the gate retry budget is exhausted', async () => {
    const { goals } = await makeGatedGoal('exit 1');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await goals.markComplete({ reason: 'done' }, 'model')).toBeNull();
      expect(goals.getLastCompletionRejection()?.code).toBe('gate_failed');
      // Burn through the reject cooldown so the next attempt reaches the gate.
      for (let turn = 0; turn < 3; turn += 1) await goals.incrementTurn();
    }

    const blocked = await goals.markComplete({ reason: 'done' }, 'model');

    expect(blocked?.status).toBe('blocked');
    expect(goals.getGoal().goal?.status).toBe('blocked');
    expect(goals.getLastCompletionRejection()?.code).toBe('gate_retry_exhausted');
  });
});

describe('GoalMode accounting and budgets', () => {
  it('counts tokens and turns only while active', async () => {
    const { goals } = makeGoalMode();

    await goals.createGoal({ objective: 'work' });
    await goals.recordTokenUsage(30);
    await goals.incrementTurn();
    expect(goals.getGoal().goal).toMatchObject({ tokensUsed: 30, turnsUsed: 1 });

    await goals.pauseGoal();
    await goals.recordTokenUsage(12);
    await goals.incrementTurn();
    expect(goals.getGoal().goal).toMatchObject({ tokensUsed: 30, turnsUsed: 1 });
  });

  it('sets budget limits through SetGoalBudget-style updates', async () => {
    const { goals } = makeGoalMode();

    await goals.createGoal({ objective: 'work' });
    const snapshot = await goals.setBudgetLimits({
      budgetLimits: { tokenBudget: 100, turnBudget: 2, wallClockBudgetMs: 1000 },
    }, 'model');

    expect(snapshot.budget.tokenBudget).toBe(100);
    expect(snapshot.budget.turnBudget).toBe(2);
    expect(snapshot.budget.wallClockBudgetMs).toBe(1000);
  });

  it('tracks telemetry without goal text', async () => {
    const { goals, telemetry } = makeGoalMode();

    await goals.createGoal({ objective: 'private objective', replace: true });
    await goals.setBudgetLimits({ budgetLimits: { tokenBudget: 100 } }, 'model');
    await goals.incrementTurn();
    await goals.pauseGoal({ reason: 'private pause reason' });
    await goals.resumeGoal();
    await goals.markComplete({ reason: 'private completion reason' }, 'model');

    expect(telemetry.map((record) => record.event)).toEqual([
      'goal_created',
      'goal_budget_set',
      'goal_continued',
      'goal_status_changed',
      'goal_status_changed',
      'goal_status_changed',
      'goal_cleared',
    ]);
    expect(telemetry[0]?.properties).toEqual({ actor: 'user', replace: true });
    expect(telemetry[1]?.properties).toMatchObject({ actor: 'model', has_token_budget: true });
    expect(telemetry[3]?.properties).toMatchObject({ status: 'paused', actor: 'user' });
    expect(JSON.stringify(telemetry)).not.toContain('private objective');
    expect(JSON.stringify(telemetry)).not.toContain('private pause reason');
    expect(JSON.stringify(telemetry)).not.toContain('private completion reason');
  });
});

describe('GoalMode records', () => {
  it('records only replay-relevant create/update/clear fields', async () => {
    const { goals, records } = makeGoalMode();

    await goals.createGoal({ objective: 'work', completionCriterion: 'tests pass' });
    await goals.recordTokenUsage(5);
    await goals.incrementTurn();
    await goals.setBudgetLimits({ budgetLimits: { turnBudget: 2 } }, 'model');
    await goals.markBlocked({ reason: 'stuck' });
    await goals.cancelGoal();

    expect(records).toEqual([
      expect.objectContaining({
        type: 'goal.create',
        goalId: expect.any(String),
        objective: 'work',
        completionCriterion: 'tests pass',
      }),
      expect.objectContaining({ type: 'goal.update', tokensUsed: 5 }),
      expect.objectContaining({ type: 'goal.update', turnsUsed: 1 }),
      expect.objectContaining({
        type: 'goal.update',
        budgetLimits: { turnBudget: 2 },
      }),
      expect.objectContaining({
        type: 'goal.update',
        status: 'blocked',
        reason: 'stuck',
        actor: 'runtime',
      }),
      expect.objectContaining({ type: 'goal.clear' }),
    ]);
    expect(records[0]).not.toHaveProperty('actor');
    expect(records[0]).not.toHaveProperty('budgetLimits');
    expect(records[1]).not.toHaveProperty('goalId');
    expect(records[1]).not.toHaveProperty('status');
    expect(records.at(-1)).not.toHaveProperty('goalId');
    expect(records.at(-1)).not.toHaveProperty('reason');
  });

  it('restores state from patch records', () => {
    const { goals } = makeGoalMode();

    goals.restoreCreate({
      type: 'goal.create',
      goalId: 'g1',
      objective: 'work',
      completionCriterion: 'tests pass',
      time: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    goals.restoreUpdate({ type: 'goal.update', tokensUsed: 5 });
    goals.restoreUpdate({ type: 'goal.update', turnsUsed: 1 });
    goals.restoreUpdate({ type: 'goal.update', budgetLimits: { turnBudget: 2 } });
    goals.restoreUpdate({ type: 'goal.update', status: 'blocked', reason: 'stuck' });

    expect(goals.getGoal().goal).toMatchObject({
      objective: 'work',
      completionCriterion: 'tests pass',
      status: 'blocked',
      terminalReason: 'stuck',
      tokensUsed: 5,
      turnsUsed: 1,
    });
    expect(goals.getGoal().goal?.budget.turnBudget).toBe(2);
  });

  it('projects restored goal status changes into replay records', () => {
    const { goals, replay } = makeGoalMode();

    goals.restoreCreate({
      type: 'goal.create',
      goalId: 'g1',
      objective: 'work',
      completionCriterion: 'tests pass',
      time: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    goals.restoreUpdate({ type: 'goal.update', tokensUsed: 5 });
    goals.restoreUpdate({ type: 'goal.update', turnsUsed: 1 });
    goals.restoreUpdate({
      type: 'goal.update',
      status: 'paused',
      reason: 'break',
      actor: 'runtime',
    });
    goals.restoreUpdate({ type: 'goal.update', status: 'active', actor: 'user' });
    goals.restoreUpdate({
      type: 'goal.update',
      status: 'complete',
      reason: 'done',
      actor: 'model',
    });

    expect(replay).toEqual([
      expect.objectContaining({
        type: 'goal_updated',
        snapshot: expect.objectContaining({ objective: 'work', status: 'active' }),
        change: { kind: 'created' },
      }),
      expect.objectContaining({
        type: 'goal_updated',
        snapshot: expect.objectContaining({ status: 'paused', terminalReason: 'break' }),
        change: { kind: 'lifecycle', status: 'paused', reason: 'break', actor: 'runtime' },
      }),
      expect.objectContaining({
        type: 'goal_updated',
        snapshot: expect.objectContaining({ status: 'active' }),
        change: { kind: 'lifecycle', status: 'active', reason: undefined, actor: 'user' },
      }),
      expect.objectContaining({
        type: 'goal_updated',
        snapshot: expect.objectContaining({
          status: 'complete',
          terminalReason: 'done',
          turnsUsed: 1,
          tokensUsed: 5,
        }),
        change: {
          kind: 'completion',
          status: 'complete',
          reason: 'done',
          stats: { turnsUsed: 1, tokensUsed: 5, wallClockMs: 0 },
          actor: 'model',
        },
      }),
    ]);
  });

  it('keeps resume-normalization pauses in core replay records', () => {
    const { goals, replay } = makeGoalMode();

    goals.restoreCreate({
      type: 'goal.create',
      goalId: 'g1',
      objective: 'work',
      time: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    goals.restoreUpdate({
      type: 'goal.update',
      status: 'paused',
      reason: 'Paused after agent resume',
    });

    expect(replay.at(-1)).toMatchObject({
      type: 'goal_updated',
      snapshot: { status: 'paused', terminalReason: 'Paused after agent resume' },
      change: {
        kind: 'lifecycle',
        status: 'paused',
        reason: 'Paused after agent resume',
        actor: undefined,
      },
    });
  });

  it('normalizes active replayed goals to paused', async () => {
    const { goals, records } = makeGoalMode();

    await goals.createGoal({ objective: 'resume me' });
    records.length = 0;
    goals.normalizeAfterReplay();

    expect(goals.getGoal().goal).toMatchObject({
      status: 'paused',
      terminalReason: 'Paused after agent resume',
    });
    expect(records).toEqual([
      expect.objectContaining({
        type: 'goal.update',
        status: 'paused',
        reason: 'Paused after agent resume',
      }),
    ]);
  });
});
