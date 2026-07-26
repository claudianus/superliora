import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  GOAL_COMPLETE_REJECT_COOLDOWN_TURNS,
  GoalMode,
  type GoalChange,
  type GoalSnapshot,
} from '../../src/agent/goal';
import {
  parseGoalPredicateCriterion,
  type GoalPredicateSpec,
} from '../../src/agent/goal/predicate';
import {
  evaluateGoalPredicate,
  isAllowedTestFile,
  resolveWithinRoot,
} from '../../src/agent/goal/predicate-runner';
import type { AgentRecord } from '../../src/agent/records';
import type { AgentReplayRecord } from '../../src/rpc/resumed';
import type { TelemetryProperties } from '../../src/telemetry';

interface TelemetryRecord {
  readonly event: string;
  readonly properties: TelemetryProperties;
}

function makeGoalMode(options?: {
  readonly cwd?: string;
  readonly ultraworkRun?: unknown;
}) {
  const records: AgentRecord[] = [];
  const replay: AgentReplayRecord[] = [];
  const events: Array<{
    readonly type: string;
    readonly snapshot?: GoalSnapshot | null;
    readonly change?: GoalChange;
  }> = [];
  const telemetry: TelemetryRecord[] = [];
  const reminders: Array<{ readonly content: string; readonly origin: unknown }> = [];
  const warnings: Array<{ readonly message: string; readonly props: unknown }> = [];

  const agent = {
    config: { cwd: options?.cwd ?? process.cwd() },
    log: {
      warn: (message: string, props?: unknown) => {
        warnings.push({ message, props });
      },
    },
    records: {
      logRecord: (record: AgentRecord) => {
        records.push(record);
      },
    },
    emitEvent: (event: {
      readonly type: string;
      readonly snapshot?: GoalSnapshot | null;
      readonly change?: GoalChange;
    }) => {
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
    ultrawork:
      options?.ultraworkRun === undefined
        ? undefined
        : {
            getRun: () => options.ultraworkRun,
          },
  } as unknown as Agent;

  return {
    goals: new GoalMode(agent),
    records,
    events,
    telemetry,
    reminders,
    warnings,
  };
}

describe('parseGoalPredicateCriterion', () => {
  it('returns empty for missing or blank criteria', () => {
    expect(parseGoalPredicateCriterion(undefined)).toEqual({ kind: 'empty' });
    expect(parseGoalPredicateCriterion('   ')).toEqual({ kind: 'empty' });
  });

  it('parses JSON fence and predicate:v1: prefix', () => {
    const fence = parseGoalPredicateCriterion(
      'done when\n```goal-predicate\n{"version":1,"requiredPaths":["a.ts"]}\n```',
    );
    expect(fence).toMatchObject({
      kind: 'structured',
      spec: { version: 1, requiredPaths: ['a.ts'] },
    });

    const prefix = parseGoalPredicateCriterion(
      'predicate:v1: {"version":1,"requiredTestFiles":["packages/x/test/a.test.ts"]}',
    );
    expect(prefix).toMatchObject({
      kind: 'structured',
      spec: { version: 1, requiredTestFiles: ['packages/x/test/a.test.ts'] },
    });
  });

  it('treats free text as legacy', () => {
    expect(parseGoalPredicateCriterion('all tests pass')).toEqual({
      kind: 'legacy',
      text: 'all tests pass',
    });
  });
});

describe('evaluateGoalPredicate', () => {
  it('fails missing required paths and passes when injected exists', async () => {
    const root = '/tmp/goal-predicate-ws';
    const existing = new Set([`${root}/ok.ts`]);
    const fail = await evaluateGoalPredicate({
      spec: { version: 1, requiredPaths: ['missing.ts'] },
      workspaceRoot: root,
      runTests: false,
      pathExists: async (abs) => existing.has(abs),
    });
    expect(fail.ok).toBe(false);
    expect(fail.failures[0]?.code).toBe('missing_path');

    const pass = await evaluateGoalPredicate({
      spec: { version: 1, requiredPaths: ['ok.ts'] },
      workspaceRoot: root,
      runTests: false,
      pathExists: async (abs) => existing.has(abs),
    });
    expect(pass.ok).toBe(true);
  });

  it('rejects path escape and non-test files', () => {
    const root = '/tmp/goal-predicate-ws';
    expect(resolveWithinRoot(root, '../etc/passwd')).toBeNull();
    expect(isAllowedTestFile(root, `${root}/src/index.ts`)).toBe(false);
    expect(isAllowedTestFile(root, `${root}/test/foo.test.ts`)).toBe(true);
  });

  it('runs whitelist vitest hook when provided', async () => {
    const root = '/tmp/goal-predicate-ws';
    const runVitestFile = vi.fn(async () => ({ ok: true, detail: 'exit 0' }));
    const result = await evaluateGoalPredicate({
      spec: {
        version: 1,
        requiredTestFiles: ['packages/agent-core/test/agent/goal-predicate.test.ts'],
      } satisfies GoalPredicateSpec,
      workspaceRoot: root,
      pathExists: async () => true,
      runVitestFile,
    });
    expect(result.ok).toBe(true);
    expect(runVitestFile).toHaveBeenCalledOnce();
  });
});

describe('GoalMode markComplete predicate + cooldown', () => {
  it('rejects structured predicate failure and keeps goal active', async () => {
    const { goals, reminders, telemetry } = makeGoalMode({ cwd: '/tmp/goal-predicate-ws' });
    await goals.createGoal({
      objective: 'Ship with predicate',
      completionCriterion: '```json\n{"version":1,"requiredPaths":["does-not-exist.ts"]}\n```',
    });

    const completed = await goals.markComplete({}, 'model');
    expect(completed).toBeNull();
    expect(goals.getGoal().goal?.status).toBe('active');
    expect(goals.getLastCompletionRejection()?.code).toBe('predicate_failed');
    expect(reminders.some((r) => String(r.content).includes('predicate_failed') || String(r.content).includes('false complete'))).toBe(
      true,
    );
    expect(telemetry.some((t) => t.event === 'goal_complete_audit_rejected')).toBe(true);
  });

  it('enforces reject cooldown N turns after a false complete', async () => {
    const { goals } = makeGoalMode({ cwd: '/tmp/goal-predicate-ws' });
    await goals.createGoal({
      objective: 'Cooldown check',
      completionCriterion: '```json\n{"version":1,"requiredPaths":["missing.ts"]}\n```',
    });

    expect(await goals.markComplete({}, 'model')).toBeNull();
    expect(goals.getCompletionRejectStreak()).toBe(1);
    const prior = goals.getLastCompletionRejection();
    expect(prior?.code).toBe('predicate_failed');
    const priorAction = prior?.nextActions[0];
    expect(priorAction).toBeTruthy();

    // Immediate re-attempt → cooldown (no turn elapsed).
    expect(await goals.markComplete({}, 'model')).toBeNull();
    const cooldown = goals.getLastCompletionRejection();
    expect(cooldown?.code).toBe('reject_cooldown');
    // Prior audit nextActions survive cooldown so the model keeps repair steps.
    expect(cooldown?.reasons.some((r) => r.includes('Prior rejection code: predicate_failed'))).toBe(
      true,
    );
    if (priorAction !== undefined) {
      expect(cooldown?.nextActions.some((a) => a === priorAction || a.includes(priorAction.slice(0, 24)))).toBe(
        true,
      );
    }
    // Cooldown keeps up to 3 prior nextActions (not just the first).
    const priorCount = Math.min(prior?.nextActions.length ?? 0, 3);
    const resurfaced = (prior?.nextActions.slice(0, priorCount) ?? []).filter((action) =>
      (cooldown?.nextActions ?? []).includes(action),
    );
    expect(resurfaced.length).toBe(priorCount);

    // Advance goal turns past cooldown, still missing path → predicate again.
    for (let i = 0; i < GOAL_COMPLETE_REJECT_COOLDOWN_TURNS; i++) {
      await goals.incrementTurn();
    }
    expect(await goals.markComplete({}, 'model')).toBeNull();
    expect(goals.getLastCompletionRejection()?.code).toBe('predicate_failed');
  });

  it('allows legacy free-text complete without structured predicate', async () => {
    const { goals } = makeGoalMode();
    await goals.createGoal({
      objective: 'Legacy',
      completionCriterion: 'tests pass',
    });
    const completed = await goals.markComplete({ reason: 'done' }, 'model');
    expect(completed?.status).toBe('complete');
    expect(goals.getGoal().goal).toBeNull();
  });
});


describe('GoalMode no-progress streak', () => {
  it('increments streak only when signature is unchanged', () => {
    const { goals } = makeGoalMode();
    // create active goal not required for noteGoalTurnProgress internals, but safer
    return goals.createGoal({ objective: 'progress' }).then(() => {
      expect(goals.noteGoalTurnProgress('sig-a')).toBe(0);
      expect(goals.noteGoalTurnProgress('sig-a')).toBe(1);
      expect(goals.noteGoalTurnProgress('sig-a')).toBe(2);
      expect(goals.noteGoalTurnProgress('sig-b')).toBe(0);
      expect(goals.getNoProgressStreak()).toBe(0);
      expect(goals.noteGoalTurnProgress('sig-b')).toBe(1);
    });
  });
});

