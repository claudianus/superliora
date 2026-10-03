import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../src/agent';
import { type FanoutTask, spawnOneAgent } from '../../src/fleet/spawn-agents';
import type { SubagentCompletion } from '../../src/session/subagent/subagent-host-types';
import { __resetJobWorkerHandlesForTests, bindJobWorkerHost, getJobWorkerHandle, type JobWorkerHost } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { cancelJobWorker, launchJobWorker, resumeJobs } from '../../src/tools/builtin/job/job-worker';
import { countRunningPoolJobs, nextQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import { isSessionWorktreeOwned } from '../../src/session/worktree';
import type { ToolStore } from '../../src/tools/store';

vi.mock('../../src/session/job/job-offload', () => ({ requestJobSchedulePump: vi.fn(async () => {}), cancelQueuedJobWorkerSpawn: vi.fn(() => false) }));

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
}

async function settleCompletion() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function workerFixture(store: ToolStore, workerAgentId: string) {
  const result = Promise.withResolvers<SubagentCompletion>();
  let physical: boolean | undefined;
  let allowCleanup = true;
  const handle = {
    agentId: workerAgentId, profileName: 'agent', resumed: false,
    get resourcesSettled() { return physical; },
    completion: result.promise,
  };
  const host = {
    async stopAndJoin() {
      if (physical === false) {
        if (!allowCleanup) throw new Error('Child disposal remains unconfirmed');
        physical = true;
      }
      return true;
    },
  } as JobWorkerHost;
  bindJobWorkerHost(store, host);
  return {
    handle, host,
    complete(value: SubagentCompletion) { physical = true; result.resolve(value); },
    fail(error: Error) { physical = true; result.reject(error); },
    failCleanup(error: Error) { physical = false; allowCleanup = false; result.reject(error); },
    releaseCleanup() { allowCleanup = true; },
  };
}

const agent = { config: { cwd: '/repo' } } as Agent;

describe('autonomous Job workers', () => {
  afterEach(__resetJobWorkerHandlesForTests);

  it('launches without awaiting completion and records observed result without a review chain', async () => {
    const store = memoryStore();
    const created = createJob(store, { title: 'Fix race', prompt: 'Fix the race using your preferred approach.' });
    const job = patchJob(store, created.id, { status: 'running' })!;
    const worker = workerFixture(store, 'worker_test');
    let task: FanoutTask | undefined;
    const spawnOne = vi.fn<typeof spawnOneAgent>(async (_host, _spec, input) => { task = input; return worker.handle; });
    expect((await launchJobWorker({ store, job, agent, spawnOne })).ok).toBe(true);
    expect(task?.prompt).toBe(created.prompt);
    expect(task?.permissionMode).toBeUndefined();
    expect(getJob(store, job.id)?.status).toBe('running');
    worker.complete({ status: 'completed', result: 'Fixed the race. No tests run.', filesChanged: ['src/race.ts'], context: { agentId: 'worker_test', contextTokens: 120 } });
    await settleCompletion();
    expect(getJob(store, job.id)).toMatchObject({ status: 'done', resultSummary: 'Fixed the race. No tests run.', filesChanged: ['src/race.ts'] });
    expect(listJobs(store)).toHaveLength(1);
    expect(getJobWorkerHandle(job.id)).toBeUndefined();
  });

  it('records a worker failure without relaunching it', async () => {
    const store = memoryStore();
    const created = createJob(store, { title: 'Fail honestly' });
    const job = patchJob(store, created.id, { status: 'running' })!;
    const worker = workerFixture(store, 'worker_fail');
    const spawnOne = vi.fn(async () => worker.handle);
    await launchJobWorker({ store, job, agent, spawnOne });
    worker.fail(new Error('provider disconnected'));
    await settleCompletion();
    expect(getJob(store, job.id)).toMatchObject({ status: 'failed', resultSummary: 'provider disconnected' });
    expect(spawnOne).toHaveBeenCalledTimes(1);
  });

  it.each(['cancelled', 'interrupted'] as const)('waits for physical settlement before publishing %s', async (status) => {
    const store = memoryStore();
    const created = createJob(store, { title: 'Stop me', ownershipPaths: ['src'] });
    const job = patchJob(store, created.id, { status: 'running', worktreePath: '/owned/tree' })!;
    const worker = workerFixture(store, 'worker_stopping');
    // Preparation has no Kaos probe; the same actual worker path remains owned.
    await launchJobWorker({ store, job, agent, spawnOne: vi.fn(async () => worker.handle) });
    createJob(store, { title: 'Conflicting work', ownershipPaths: ['src/file.ts'] });
    let stopped = false;
    const stop = cancelJobWorker({ store, jobId: job.id, status }).then((result) => { stopped = true; return result; });
    await settleCompletion();
    expect(getJobWorkerHandle(job.id)?.controller.signal.aborted).toBe(true);
    expect(getJob(store, job.id)?.status).toBe('running');
    expect(stopped).toBe(false);
    expect(isSessionWorktreeOwned('/owned/tree', '/repo')).toBe(true);
    expect(countRunningPoolJobs(store)).toBe(1);
    expect(nextQueuedJobs(store, 1)).toHaveLength(0);
    worker.fail(new Error('worker teardown completed'));
    expect((await stop).job?.status).toBe(status);
    expect(getJobWorkerHandle(job.id)).toBeUndefined();
    expect(isSessionWorktreeOwned('/owned/tree', '/repo')).toBe(false);
    expect(nextQueuedJobs(store, 1)).toHaveLength(1);
  });

  it('retains failed physical ownership and the first worker error until explicit cleanup', async () => {
    const store = memoryStore();
    const created = createJob(store, { title: 'Physical cleanup failure' });
    const job = patchJob(store, created.id, { status: 'running', worktreePath: '/owned/failed-tree' })!;
    const worker = workerFixture(store, 'worker_owned');
    const spawnOne = vi.fn(async () => worker.handle);
    await launchJobWorker({ store, job, agent, spawnOne });
    const failure = new Error('original provider failure');
    worker.failCleanup(failure);
    await settleCompletion();
    expect(getJob(store, job.id)?.status).toBe('running');
    expect(getJobWorkerHandle(job.id)?.failure).toBe(failure);
    expect(isSessionWorktreeOwned('/owned/failed-tree', '/repo')).toBe(true);
    await expect(cancelJobWorker({ store, jobId: job.id })).rejects.toThrow('original provider failure');
    expect(getJobWorkerHandle(job.id)).toBeDefined();
    worker.releaseCleanup();
    expect((await cancelJobWorker({ store, jobId: job.id })).job).toMatchObject({ status: 'failed', resultSummary: 'original provider failure' });
    expect(getJobWorkerHandle(job.id)).toBeUndefined();
    expect(isSessionWorktreeOwned('/owned/failed-tree', '/repo')).toBe(false);
    expect(spawnOne).toHaveBeenCalledTimes(1);
    expect((await cancelJobWorker({ store, jobId: job.id })).job).toMatchObject({ status: 'failed', resultSummary: 'original provider failure' });
  });

  it('joins the old child before an explicit answer can requeue its Job', async () => {
    const store = memoryStore();
    const created = createJob(store, { title: 'Answer needed' });
    const job = patchJob(store, created.id, { status: 'running' })!;
    const worker = workerFixture(store, 'worker_question');
    const spawnOne = vi.fn(async () => worker.handle);
    await launchJobWorker({ store, job, agent, spawnOne });
    patchJob(store, job.id, { status: 'needs_user' });
    const resume = resumeJobs({ store, jobId: job.id, answer: 'Proceed' });
    await settleCompletion();
    expect(getJob(store, job.id)?.status).toBe('needs_user');
    expect(countRunningPoolJobs(store)).toBe(1);
    worker.fail(new Error('old request waiter and child settled'));
    expect((await resume).resumed[0]?.status).toBe('queued');
    expect(getJobWorkerHandle(job.id)).toBeUndefined();
    expect(spawnOne).toHaveBeenCalledTimes(1);
  });
});
