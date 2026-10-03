import { describe, expect, it } from 'vitest';

import {
  jobCancel,
  jobCreate,
  jobList,
  jobPause,
  jobPush,
  jobResume,
  jobSetProjectMode,
} from '../../src/tools/builtin/job/job-rpc-api';
import {
  createJob,
  emptyJobLedger,
  getJob,
  patchJob,
  writeJobLedger,
} from '../../src/tools/builtin/job/job-ledger';
import {
  CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT,
  setConductorProjectModeMaxConcurrent,
} from '../../src/tools/builtin/job/job-project-mode';
import { closeJobAdmissions, resolveConductorPoolConfig } from '../../src/tools/builtin/job/job-runtime';
import { jobRecordToSnapshot } from '../../src/tools/builtin/job/job-emit';
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

describe('job-rpc-api', () => {
  it('jobList returns snapshots for ledger jobs', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const created = await jobCreate(store, {
      title: 'Fix auth',
      kind: 'implement',
      successCriteria: ['tests green'],
      mustNotTouch: ['apps/liora'],
    });
    expect(created.jobs).toHaveLength(1);

    const listed = jobList(store);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Fix auth');
    expect(listed[0]?.briefPreview?.successCriteria).toEqual(['tests green']);
  });


  it('jobCancel marks the job cancelled', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const created = await jobCreate(store, { title: 'Cancel me', kind: 'task' });
    const jobId = created.jobs[0]!.id;
    const result = await jobCancel(store, { jobId, reason: 'user stop' });
    expect(result.ok).toBe(true);
    expect(result.job?.status).toBe('cancelled');
    expect(getJob(store, jobId)?.status).toBe('cancelled');
  });

  it('pauses a queued card and resumes the same job without inventing a new worker', async () => {
    const store = memoryStore();
    const created = await jobCreate(store, { title: 'Pause me', prompt: 'Original request' });
    const jobId = created.jobs[0]!.id;
    expect((await jobPause(store, { jobId })).job?.status).toBe('interrupted');
    const resumed = await jobResume(store, { jobId });
    expect(resumed.ok).toBe(true);
    expect(getJob(store, jobId)).toMatchObject({ status: 'queued', prompt: 'Original request' });
    expect(jobList(store)).toHaveLength(1);
  });

  it.each(['queued', 'running', 'cancelled', 'interrupted'] as const)(
    'rejects publication of a %s job without changing its state or dispatching work',
    async (status) => {
      const store = memoryStore();
      const source = createJob(store, { title: 'Unsettled publication' });
      patchJob(store, source.id, { status });

      const result = await jobPush(store, {
        jobId: source.id, approve: true, forceUserConfirm: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain(`is ${status}`);
      expect(result.pushJob).toBeUndefined();
      expect(getJob(store, source.id)?.status).toBe(status);
      expect(jobList(store).map((job) => job.id)).toEqual([source.id]);
    },
  );

  it('does not acknowledge a held push when the native runtime is closed', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'Closed publication' });
    patchJob(store, source.id, { status: 'done' });
    closeJobAdmissions(store);

    const result = await jobPush(store, {
      jobId: source.id, approve: true, forceUserConfirm: true,
    });

    expect(result).toMatchObject({ ok: false, error: 'Job runtime is closed.' });
    expect(result.pushJob).toBeUndefined();
    expect(getJob(store, source.id)?.status).toBe('done');
    expect(jobList(store).map((job) => job.id)).toEqual([source.id]);
  });

  it('jobRecordToSnapshot includes v3 landReceipt when present', () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'Landed', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      landReceipt: {
        mergeSha: 'deadbeef',
        branch: 'liora/job',
        verifiedAt: '2026-08-09T00:00:00.000Z',
      },
    });
    const snap = jobRecordToSnapshot(getJob(store, job.id)!);
    expect(snap.landReceipt).toEqual({
      mergeSha: 'deadbeef',
      branch: 'liora/job',
      merged: true,
    });
  });

});

describe('conductor project mode pool', () => {
  it('projectMode overrides default; env still wins', () => {
    expect(
      resolveConductorPoolConfig({}, { projectMode: 'hotfix' }).maxConcurrentJobs,
    ).toBe(CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT.hotfix);
    expect(
      resolveConductorPoolConfig(
        { SUPERLIORA_CONDUCTOR_MAX_CONCURRENT: '9' },
        { projectMode: 'hotfix' },
      ).maxConcurrentJobs,
    ).toBe(9);

    const store = memoryStore();
    setConductorProjectModeMaxConcurrent(store, 'review');
    expect(resolveConductorPoolConfig({}, { store }).maxConcurrentJobs).toBe(3);
  });

  it('jobSetProjectMode persists mode and returns pool default', () => {
    const store = memoryStore();
    const result = jobSetProjectMode(store, 'greenfield');
    expect(result.mode).toBe('greenfield');
    expect(result.maxConcurrent).toBe(CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT.greenfield);
    expect(resolveConductorPoolConfig({}, { store }).maxConcurrentJobs).toBe(4);
  });
});

