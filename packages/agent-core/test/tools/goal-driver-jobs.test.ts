import { afterEach, describe, expect, it } from 'vitest';

import type { FanoutSpec, FanoutTask } from '../../src/fleet/spawn-agents';
import type { SubagentCompletion } from '../../src/session/subagent/subagent-host-types';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { profileForJobKind } from '../../src/tools/builtin/job/job-runtime';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

/**
 * Goal-driver Jobs (spec 2026-08-04-goal-driver-jobs) — vertical slice pins:
 * the driver is a Job (invariant 1), the goal binding rides the spawn task
 * mechanically (invariant 2), and the goal's terminal state maps onto the
 * ledger with the verification gate outranking it (invariants 4–5).
 */

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

async function drainMicrotasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

function runningGoalDriverJob(store: ToolStore) {
  const job = createJob(store, {
    title: 'Ship metrics dashboard',
    kind: 'goal-driver',
    prompt: 'Implement the metrics dashboard end to end.',
    goalObjective: 'Implement the metrics dashboard end to end.',
    goalCompletionCriterion: 'pnpm test passes with the dashboard suite green',
    goalBudgetLimits: { turnBudget: 40 },
  });
  const running = patchJob(store, job.id, {
    status: 'running',
    worktreePath: `/tmp/goal-driver/${job.id}`,
  });
  if (!running) throw new Error('failed to promote job to running');
  return running;
}

describe('goal-driver ledger binding', () => {
  it('JobCreate kind=goal-driver stores the goal binding from the brief', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Ship metrics dashboard',
      kind: 'goal-driver',
      prompt: 'Implement the metrics dashboard end to end.',
      goal_completion_criterion: 'pnpm test passes with the dashboard suite green',
      goal_budget: { turn_budget: 40, token_budget: 500_000 },
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(result.output).toMatch(/ACK job_/);

    const jobs = Object.values(
      (store.get('job_ledger') as { jobs: Record<string, unknown>[] }).jobs ?? [],
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0] as ReturnType<typeof getJob>;
    expect(job?.kind).toBe('goal-driver');
    expect(job?.goalObjective).toBe('Implement the metrics dashboard end to end.');
    expect(job?.goalCompletionCriterion).toBe(
      'pnpm test passes with the dashboard suite green',
    );
    expect(job?.goalBudgetLimits).toEqual({ turnBudget: 40, tokenBudget: 500_000 });
  });

  it('rejects a goal-driver brief longer than the goal objective cap', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'oversized objective',
      kind: 'goal-driver',
      prompt: 'x'.repeat(4001),
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/objective exceeds/);
  });

  it('routes goal-driver jobs to the goal-driver profile', () => {
    expect(profileForJobKind('goal-driver')).toBe('goal-driver');
  });
});

describe('goal-driver worker launch', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it('passes the goal binding mechanically on the spawn task', async () => {
    const store = memoryStore();
    const job = runningGoalDriverJob(store);

    let capturedSpec: FanoutSpec | undefined;
    let capturedTask: FanoutTask | undefined;
    let resolveCompletion!: (value: SubagentCompletion) => void;
    const completion = new Promise<SubagentCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const spawnOne = (async (_host: unknown, spec: FanoutSpec, task: FanoutTask) => {
      capturedSpec = spec;
      capturedTask = task;
      return { agentId: 'agent_driver_fake', profileName: 'goal-driver', resumed: false, completion };
    }) as never;
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({ store, agent, job, spawnOne });
    expect(result.ok).toBe(true);

    // Invariant 2: no prompt theater — the binding is runtime data on the task.
    expect(capturedTask?.profileName).toBe('goal-driver');
    expect(capturedTask?.goal).toEqual({
      objective: 'Implement the metrics dashboard end to end.',
      completionCriterion: 'pnpm test passes with the dashboard suite green',
      budgetLimits: { turnBudget: 40 },
    });
    // The worker brief states the migrated goal without asking the model to create it.
    expect(capturedTask?.prompt).toContain('Objective: Implement the metrics dashboard');
    expect(capturedTask?.prompt).not.toMatch(/create (a|the) goal/i);
    expect(capturedSpec?.runInBackground).toBe(true);

    resolveCompletion({ result: 'dashboard shipped', goalStatus: 'complete' });
    await drainMicrotasks();
    expect(getJob(store, job.id)?.status).toBe('done');
  });

  it('a blocked goal escalates to a resumable blocked job with the reason', async () => {
    const store = memoryStore();
    const job = runningGoalDriverJob(store);

    const completion = Promise.resolve<SubagentCompletion>({
      result: 'needs the analytics token to continue',
      goalStatus: 'blocked',
      goalId: 'goal_abc',
      goalTerminalReason: 'blocked by missing analytics credentials',
    });
    const spawnOne = (async () => ({
      agentId: 'agent_driver_blocked',
      profileName: 'goal-driver',
      resumed: false,
      completion,
    })) as never;
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({ store, agent, job, spawnOne });
    expect(result.ok).toBe(true);
    await drainMicrotasks();

    const updated = getJob(store, job.id);
    expect(updated?.status).toBe('blocked');
    expect(updated?.goalId).toBe('goal_abc');
    expect(updated?.resultSummary).toContain('goal blocked');
    expect(updated?.resultSummary).toContain('blocked by missing analytics credentials');
    expect(updated?.notes).toContain('worker: goal blocked');
  });

  it('the verification gate outranks a completed goal (invariant 4)', async () => {
    const store = memoryStore();
    const job = runningGoalDriverJob(store);

    const completion = Promise.resolve<SubagentCompletion>({
      result: 'claimed complete',
      goalStatus: 'complete',
      contract: {
        agent_id: 'agent_driver_fake',
        profile: 'goal-driver',
        status: 'completed',
        summary: 'claimed complete',
        files_changed: [],
        verification: { tests: 'failed', typecheck: 'not_run', lint: 'not_run' },
        verification_failed: true,
        deviations: [],
      },
    });
    const spawnOne = (async () => ({
      agentId: 'agent_driver_failed',
      profileName: 'goal-driver',
      resumed: false,
      completion,
    })) as never;
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({ store, agent, job, spawnOne });
    expect(result.ok).toBe(true);
    await drainMicrotasks();

    const updated = getJob(store, job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.resultSummary).toMatch(/^verification failed/);
  });
});
