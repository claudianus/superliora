import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import {
  createJob,
  getJob,
  listJobs,
  patchJob,
} from '../../src/tools/builtin/job/job-ledger';
import {
  jobIdFromLeaseRunId,
  ownershipPathsOverlap,
} from '../../src/tools/builtin/job/job-ownership';
import { nextQueuedJobs, scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
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

describe('job ownership schedule gate', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it('detects overlapping ownership paths', () => {
    expect(ownershipPathsOverlap(['a/Boss.js'], ['a/Boss.js'])).toBe('a/Boss.js');
    expect(ownershipPathsOverlap(['a/Boss.js'], ['a/Other.js'])).toBeUndefined();
    expect(ownershipPathsOverlap(undefined, ['a/Boss.js'])).toBeUndefined();
    expect(jobIdFromLeaseRunId('job:job_abc:deadbeef')).toBe('job_abc');
  });

  it('defers a queued job while a running job holds the same ownership path', async () => {
    const store = memoryStore();
    const holder = createJob(store, {
      title: 'finish boss',
      priority: 5,
      ownershipPaths: ['Boss.js'],
    });
    patchJob(store, holder.id, { status: 'running' });
    const waiter = createJob(store, {
      title: 'animate boss',
      priority: 9,
      ownershipPaths: ['Boss.js'],
    });

    expect(nextQueuedJobs(store, 10).map((j) => j.id)).toEqual([]);
    const deferred = getJob(store, waiter.id);
    expect(deferred?.status).toBe('queued');
    expect(deferred?.notes).toMatch(/ownership_deferred:.*held_by=/);
    expect(deferred?.notes).toContain(holder.id);

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(result.started).toHaveLength(0);
    expect(getJob(store, waiter.id)?.status).toBe('queued');
  });

  it('starts the waiter after the holder leaves running', async () => {
    const store = memoryStore();
    const holder = createJob(store, {
      title: 'finish boss',
      ownershipPaths: ['Boss.js'],
    });
    patchJob(store, holder.id, { status: 'running' });
    const waiter = createJob(store, {
      title: 'animate boss',
      priority: 1,
      ownershipPaths: ['Boss.js'],
    });
    expect(nextQueuedJobs(store, 10)).toHaveLength(0);

    patchJob(store, holder.id, { status: 'done' });
    const ready = nextQueuedJobs(store, 10);
    expect(ready.map((j) => j.id)).toEqual([waiter.id]);

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(result.started.map((j) => j.id)).toEqual([waiter.id]);
    expect(getJob(store, waiter.id)?.status).toBe('running');
  });

  it('promotes only one of two overlapping siblings in the same schedule tick', async () => {
    const store = memoryStore();
    const a = createJob(store, {
      title: 'A',
      priority: 10,
      ownershipPaths: ['Boss.js'],
    });
    const b = createJob(store, {
      title: 'B',
      priority: 9,
      ownershipPaths: ['Boss.js'],
    });

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.id).toBe(a.id);
    expect(getJob(store, a.id)?.status).toBe('running');
    expect(getJob(store, b.id)?.status).toBe('queued');
    expect(getJob(store, b.id)?.notes).toMatch(/ownership_deferred:/);
    expect(listJobs(store).filter((j) => j.status === 'running')).toHaveLength(1);
  });

  it('re-queues on Ownership conflict spawn instead of failing', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'animate',
      kind: 'implement',
      ownershipPaths: ['Boss.js'],
    });
    const running = patchJob(store, job.id, {
      status: 'running',
      worktreePath: `/tmp/own/${job.id}`,
    });
    if (!running) throw new Error('promote failed');

    const spawnOne = vi.fn(async () => {
      throw new Error(
        'Ownership conflict on Boss.js: already claimed by owner=agent_x run=job:job_holder:abcd1234. Resolve the overlap before fan-out.',
      );
    });
    const agent = { subagentHost: { spawn: async () => ({}) }, log: undefined } as never;

    const result = await launchJobWorker({
      store,
      agent,
      job: running,
      spawnOne: spawnOne as never,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Ownership conflict/);
    const after = getJob(store, job.id);
    expect(after?.status).toBe('queued');
    expect(after?.resultSummary).toBeUndefined();
    expect(after?.notes).toMatch(/ownership_deferred:.*held_by=job_holder/);
    expect(after?.notes).not.toMatch(/spawn_failed:/);
  });

  it('verify workers do not pass ownership to spawn', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Verify: footer',
      kind: 'verify',
      ownershipPaths: ['Footer.tsx'],
    });
    const running = patchJob(store, job.id, {
      status: 'running',
      worktreePath: `/tmp/own/${job.id}`,
    });
    if (!running) throw new Error('promote failed');

    let sawOwnership: readonly string[] | undefined = ['sentinel'];
    const spawnOne = vi.fn(async (_host: unknown, _spec: unknown, task: { ownership?: string[] }) => {
      sawOwnership = task.ownership;
      return {
        agentId: 'agent_verify',
        profileName: 'verify',
        resumed: false,
        completion: Promise.resolve({ result: 'ok' }),
      };
    });
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({
      store,
      agent,
      job: running,
      spawnOne: spawnOne as never,
    });
    expect(result.ok).toBe(true);
    expect(sawOwnership).toBeUndefined();
  });
});
