import { describe, expect, it } from 'vitest';

import { renderJobDeskInjection } from '../../src/agent/injection/job-desk';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '../../src/profile/main-profile';
import { delegateConductorGoalDesk, shouldDelegateGoalToDesk } from '../../src/tools/builtin/goal/goal-desk';
import {
  conductorCancelGoal,
  conductorGetGoal,
  conductorPauseGoal,
  snapshotFromGoalDeskBinding,
} from '../../src/tools/builtin/goal/goal-desk-facade';
import {
  DEFAULT_GOAL_DESK_COMPLETION_CRITERION,
  readGoalSessionBinding,
  resolveCompletionCriterion,
  syncGoalDeskParentFromDriver,
} from '../../src/tools/builtin/goal/goal-session-binding';
import { getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { profileForJobKind, summarizeJobStrip } from '../../src/tools/builtin/job/job-runtime';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

function fakeConductorAgent(store: ToolStore) {
  return {
    type: 'main' as const,
    config: { profileName: SOVEREIGN_CONDUCTOR_PROFILE_NAME },
    tools: { toolStore: store, getStore: () => store },
    subagentHost: undefined,
    emitEvent: () => {},
  } as never;
}

describe('goal-desk kind routing', () => {
  it('maps goal-desk to goal-desk profile (no worktree)', () => {
    expect(profileForJobKind('goal-desk')).toBe('goal-desk');
  });

  it('resolves default completion criterion', () => {
    expect(resolveCompletionCriterion('Ship a dashboard')).toBe(
      DEFAULT_GOAL_DESK_COMPLETION_CRITERION,
    );
    expect(resolveCompletionCriterion('Keep going until pnpm test passes')).toMatch(/pnpm test/);
  });
});

describe('delegateConductorGoalDesk', () => {
  it('creates desk umbrella + goal-driver child and binds the session', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    expect(shouldDelegateGoalToDesk(agent)).toBe(true);

    const result = await delegateConductorGoalDesk(agent, {
      objective: 'Ship the metrics dashboard',
    });

    expect(result.desk.kind).toBe('goal-desk');
    expect(result.driver.kind).toBe('goal-driver');
    expect(result.driver.parentJobId).toBe(result.desk.id);
    expect(result.driver.goalCompletionCriterion).toBe(DEFAULT_GOAL_DESK_COMPLETION_CRITERION);
    expect(readGoalSessionBinding(store)?.deskJobId).toBe(result.desk.id);
    expect(listJobs(store)).toHaveLength(2);

    const snap = snapshotFromGoalDeskBinding(result.binding);
    expect(snap.execution).toBe('goal-desk');
    expect(snap.deskJobId).toBe(result.desk.id);
    expect(snap.status).toBe('active');
  });

  it('propagates gateCommand onto the goal-driver Job and snapshot', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const result = await delegateConductorGoalDesk(agent, {
      objective: 'Keep checks green',
      gateCommand: 'pnpm test',
    });
    expect(result.driver.goalGateCommand).toBe('pnpm test');
    expect(result.binding.gateCommand).toBe('pnpm test');
    expect(snapshotFromGoalDeskBinding(result.binding).gateCommand).toBe('pnpm test');
  });

  it('skips LLM spawn for the goal-desk umbrella', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk } = await delegateConductorGoalDesk(agent, {
      objective: 'Fix flaky auth test',
      completionCriterion: 'auth suite green',
    });
    // Promote to running as scheduler would.
    const { patchJob } = await import('../../src/tools/builtin/job/job-ledger');
    patchJob(store, desk.id, { status: 'running' });
    const launched = await launchJobWorker({
      store,
      agent: agent as never,
      job: getJob(store, desk.id)!,
    });
    expect(launched.ok).toBe(true);
    expect(launched.workerAgentId).toBeUndefined();
  });

  it('rejects a second active goal without replace', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    await delegateConductorGoalDesk(agent, { objective: 'First goal' });
    await expect(delegateConductorGoalDesk(agent, { objective: 'Second goal' })).rejects.toMatchObject(
      { code: 'goal.already_exists' },
    );
  });
});

describe('conductor goal facade', () => {
  it('pause and cancel update the binding', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    await delegateConductorGoalDesk(agent, { objective: 'Keep going until done' });

    const paused = conductorPauseGoal(agent);
    expect(paused.status).toBe('paused');
    expect(paused.execution).toBe('goal-desk');
    expect(conductorGetGoal(agent).goal?.status).toBe('paused');

    conductorCancelGoal(agent);
    expect(conductorGetGoal(agent).goal).toBeNull();
  });
});

describe('goal-desk driver sync + desk Next move', () => {
  it('mirrors driver done onto the desk umbrella and binding', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk, driver } = await delegateConductorGoalDesk(agent, {
      objective: 'Land the feature',
    });
    patchJob(store, desk.id, { status: 'running' });
    patchJob(store, driver.id, {
      status: 'done',
      resultSummary: 'verified: tests green',
    });
    syncGoalDeskParentFromDriver(store, getJob(store, driver.id)!);

    expect(getJob(store, desk.id)?.status).toBe('done');
    expect(readGoalSessionBinding(store)?.status).toBe('done');
    expect(conductorGetGoal(agent).goal?.status).toBe('complete');
  });

  it('injects Goal Desk Next-move guidance when a goal-desk job completes', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk } = await delegateConductorGoalDesk(agent, {
      objective: 'Ship dashboard',
    });
    patchJob(store, desk.id, { status: 'done', resultSummary: 'driver finished' });
    const text = renderJobDeskInjection(
      [
        {
          id: 'evt_gd',
          kind: 'job.completed',
          jobId: desk.id,
          status: 'done',
          title: 'Goal Desk',
          summary: 'driver finished',
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
      summarizeJobStrip(store),
      { store },
    );
    expect(text).toMatch(/Next move: Goal Job/);
    expect(text).toMatch(/JobInspect/);
  });
});
