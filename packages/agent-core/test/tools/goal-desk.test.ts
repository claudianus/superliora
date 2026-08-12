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
  GOAL_SESSION_BINDING_STORE_KEY,
  healActiveGoalDeskBinding,
  readGoalSessionBinding,
  resolveCompletionCriterion,
  syncGoalDeskParentFromDriver,
} from '../../src/tools/builtin/goal/goal-session-binding';
import {
  createJob,
  getJob,
  listJobs,
  patchJob,
  writeJobLedger,
  readJobLedger,
} from '../../src/tools/builtin/job/job-ledger';
import {
  canStartMoreJobs,
  countRunningPoolJobs,
  jobOccupiesPoolSlot,
  profileForJobKind,
  scheduleQueuedJobs,
  summarizeJobStrip,
} from '../../src/tools/builtin/job/job-runtime';
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

  it('does not occupy a Conductor pool slot while running', () => {
    expect(jobOccupiesPoolSlot({ kind: 'goal-desk' })).toBe(false);
    expect(jobOccupiesPoolSlot({ kind: 'goal-driver' })).toBe(true);
    expect(jobOccupiesPoolSlot({ kind: 'implement' })).toBe(true);
  });

  it('leaves pool capacity free so a running umbrella does not starve drivers', async () => {
    const store = memoryStore();
    // Fill the pool with one non-occupying goal-desk + capacity-1 implement slots.
    const desk = createJob(store, { title: 'Goal desk', kind: 'goal-desk', priority: 12 });
    patchJob(store, desk.id, { status: 'running' });
    for (let i = 0; i < 5; i += 1) {
      const job = createJob(store, { title: `impl ${i}`, kind: 'implement', priority: 5 });
      patchJob(store, job.id, { status: 'running' });
    }
    // 5 implement + 1 goal-desk running; pool max 6 → still 1 free slot for a driver.
    expect(countRunningPoolJobs(store)).toBe(5);
    expect(canStartMoreJobs(store, 6)).toBe(true);

    createJob(store, { title: 'goal driver', kind: 'goal-driver', priority: 11 });
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.kind).toBe('goal-driver');
    expect(canStartMoreJobs(store, 6)).toBe(false);
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

  it('create pump promotes desk and driver (not stuck spinning up)', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk, driver } = await delegateConductorGoalDesk(agent, {
      objective: 'Ship the run-and-gun vertical slice',
      completionCriterion: 'playable build',
    });
    // Umbrella stays running; driver must still schedule under it (parent gate escape).
    expect(getJob(store, desk.id)?.status).toBe('running');
    expect(getJob(store, driver.id)?.status).toBe('running');
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

  it('heals active binding when every goal-driver already settled', async () => {
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
    // Simulate a missed syncGoalDeskParentFromDriver call.
    expect(readGoalSessionBinding(store)?.status).toBe('active');

    const healed = healActiveGoalDeskBinding(store, readGoalSessionBinding(store)!, agent);
    expect(healed.status).toBe('done');
    expect(getJob(store, desk.id)?.status).toBe('done');
    expect(conductorGetGoal(agent).goal?.status).toBe('complete');
  });

  it('blocks binding when the goal-driver vanished after spawn grace', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk, driver, binding } = await delegateConductorGoalDesk(agent, {
      objective: 'Ghost driver',
    });
    patchJob(store, desk.id, { status: 'running' });
    // Drop the driver from the ledger (orphan binding).
    const ledger = readJobLedger(store);
    writeJobLedger(store, {
      schemaVersion: 1,
      jobs: ledger.jobs.filter((job) => job.id !== driver.id),
    });
    // Bypass writeGoalSessionBinding — it always stamps updatedAt=now.
    store.set(GOAL_SESSION_BINDING_STORE_KEY, {
      ...binding,
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    });

    const healed = healActiveGoalDeskBinding(store, readGoalSessionBinding(store)!, agent);
    expect(healed.status).toBe('blocked');
    expect(healed.terminalReason).toMatch(/missing from ledger/);
    expect(getJob(store, desk.id)?.status).toBe('blocked');
  });

  it('reactivates blocked binding when the bound driver is running again', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { desk, driver } = await delegateConductorGoalDesk(agent, {
      objective: 'Ship the vertical slice',
    });
    patchJob(store, desk.id, {
      status: 'blocked',
      resultSummary: 'no live worker model for goal-driver',
    });
    patchJob(store, driver.id, {
      status: 'blocked',
      resultSummary: 'no live worker model for goal-driver',
    });
    syncGoalDeskParentFromDriver(store, getJob(store, driver.id)!);
    expect(readGoalSessionBinding(store)?.status).toBe('blocked');

    patchJob(store, driver.id, { status: 'running', resultSummary: undefined });
    const healed = healActiveGoalDeskBinding(store, readGoalSessionBinding(store)!, agent);
    expect(healed.status).toBe('active');
    expect(healed.terminalReason).toBeUndefined();
    expect(getJob(store, desk.id)?.status).toBe('running');
    expect(conductorGetGoal(agent).goal?.status).toBe('active');
  });

  it('reactivates blocked binding for a same-objective orphan goal-driver', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const objective = 'Polish the run-and-gun slice';
    const { desk, driver } = await delegateConductorGoalDesk(agent, { objective });
    patchJob(store, desk.id, {
      status: 'blocked',
      resultSummary: 'no live worker model for goal-driver',
    });
    patchJob(store, driver.id, {
      status: 'failed',
      resultSummary: 'CreateGoal conflict',
    });
    store.set(GOAL_SESSION_BINDING_STORE_KEY, {
      ...readGoalSessionBinding(store)!,
      status: 'blocked',
      terminalReason: 'no live worker model for goal-driver',
    });

    // Conductor JobCreate fresh spawn (no parent_job_id) after CreateGoal conflict.
    const { createJob } = await import('../../src/tools/builtin/job/job-ledger');
    const orphan = createJob(store, {
      title: `Goal: ${objective}`.slice(0, 120),
      kind: 'goal-driver',
      priority: 11,
      prompt: objective,
      goalObjective: objective,
      goalCompletionCriterion: 'playable build',
      successCriteria: ['playable build'],
    });
    patchJob(store, orphan.id, { status: 'running' });

    const healed = healActiveGoalDeskBinding(store, readGoalSessionBinding(store)!, agent);
    expect(healed.status).toBe('active');
    expect(healed.driverJobIds).toContain(orphan.id);
    expect(getJob(store, desk.id)?.status).toBe('running');
    expect(conductorGetGoal(agent).goal?.status).toBe('active');
  });

  it('does not unpause a user-paused binding when a driver is still running', async () => {
    const store = memoryStore();
    const agent = fakeConductorAgent(store);
    const { driver } = await delegateConductorGoalDesk(agent, {
      objective: 'Keep polishing',
    });
    patchJob(store, driver.id, { status: 'running' });
    store.set(GOAL_SESSION_BINDING_STORE_KEY, {
      ...readGoalSessionBinding(store)!,
      status: 'paused',
      terminalReason: 'paused by user',
    });

    const healed = healActiveGoalDeskBinding(store, readGoalSessionBinding(store)!, agent);
    expect(healed.status).toBe('paused');
  });
});
