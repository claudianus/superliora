import { describe, expect, it } from 'vitest';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { closeJobAdmissions, nextQueuedJobs, openJobAdmissions, scheduleQueuedJobs, waitForJobScheduling } from '../../src/tools/builtin/job/job-runtime';
import { interruptRunningJobs, resumeJobs } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
}

describe('operator Job lifecycle', () => {
  it('keeps prompt and optional operator constraints without manufacturing a completion contract', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'Investigate', prompt: 'Find the cause.' });
    expect(job).toMatchObject({ prompt: 'Find the cause.', status: 'queued' });
    expect(job.successCriteria).toBeUndefined();
    patchJob(store, job.id, { status: 'done', resultSummary: 'Cause found; checks not run.' });
    expect(getJob(store, job.id)?.resultSummary).toBe('Cause found; checks not run.');
  });

  it('honors explicit dependency ordering and pool capacity', async () => {
    const store = memoryStore();
    const first = createJob(store, { title: 'First', priority: 5 });
    const dependent = createJob(store, { title: 'Second', blockedByJobIds: [first.id] });
    expect(nextQueuedJobs(store, 6).map((job) => job.id)).toEqual([first.id]);
    const scheduled = await scheduleQueuedJobs({ store, requireWorktree: false, maxConcurrent: 1 });
    expect(scheduled.started.map((job) => job.id)).toEqual([first.id]);
    patchJob(store, first.id, { status: 'done' });
    expect(nextQueuedJobs(store, 6).map((job) => job.id)).toEqual([dependent.id]);
  });

  it('pause records an interrupt and explicit resume requeues the retained worker context', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'Resume me' });
    patchJob(store, job.id, { status: 'running', worktreePath: '/repo/worktree', workerResumeAgentId: 'saved_worker' });
    await interruptRunningJobs({ store, reason: 'operator pause' });
    expect(getJob(store, job.id)?.status).toBe('interrupted');
    const resumed = await resumeJobs({ store, jobId: job.id });
    expect(resumed.ok).toBe(true);
    expect(listJobs(store)[0]).toMatchObject({ status: 'queued', worktreePath: '/repo/worktree', workerResumeAgentId: 'saved_worker' });
  });
  it('shutdown joins admitted preparation and never promotes preserved queued work', async () => {
    const store = memoryStore();
    const first = createJob(store, { title: 'Admitted work', priority: 10 });
    const queued = createJob(store, { title: 'Preserved queue' });
    const { promise: finishing, resolve: finish } = Promise.withResolvers<void>();
    const launches: string[] = [];
    const scheduling = scheduleQueuedJobs({
      store, requireWorktree: false, maxConcurrent: 1,
      launchWorker: async (job) => { launches.push(job.id); await finishing; },
    });
    closeJobAdmissions(store);
    let joined = false;
    const shutdown = waitForJobScheduling(store).then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);
    expect((await scheduleQueuedJobs({ store, requireWorktree: false })).started).toHaveLength(0);
    expect(getJob(store, queued.id)?.status).toBe('queued');
    finish();
    await scheduling;
    await shutdown;
    await interruptRunningJobs({ store, reason: 'session close' });
    expect(launches).toEqual([first.id]);
    expect(nextQueuedJobs(store, 6)).toHaveLength(0);
    openJobAdmissions(store);
    expect(getJob(store, queued.id)?.status).toBe('queued');
    expect(nextQueuedJobs(store, 6).map((job) => job.id)).toEqual([queued.id]);
  });
});
