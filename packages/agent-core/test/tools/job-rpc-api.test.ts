import { describe, expect, it } from 'vitest';

import {
  jobCancel,
  jobCreate,
  jobList,
  jobPreviewSplit,
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
import { resolveConductorPoolConfig } from '../../src/tools/builtin/job/job-runtime';
import { jobRecordToSnapshot } from '../../src/tools/builtin/job/job-emit';
import type { ToolStore } from '../../src/tools/store';
import { FLAG_DEFINITIONS } from '../../src/flags/registry';

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
    expect(created.text).toContain('brief.success_criteria');
    expect(created.text).toContain('brief.must_not_touch');

    const listed = jobList(store);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Fix auth');
    expect(listed[0]?.briefPreview?.successCriteria).toEqual(['tests green']);
  });

  it('jobPreviewSplit returns multi-intent slices', () => {
    const intents = jobPreviewSplit('1. Fix login\n2. Add tests');
    expect(intents.length).toBeGreaterThanOrEqual(2);
    expect(intents[0]?.title.length).toBeGreaterThan(0);
  });

  it('jobCreate autoSplit creates multiple jobs', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const created = await jobCreate(store, {
      title: 'Batch',
      prompt: '1. Fix login\n2. Add tests',
      autoSplit: true,
    });
    expect(created.jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobList(store).length).toBe(created.jobs.length);
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

  it('jobRecordToSnapshot includes v4 effectPreview', () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, {
      title: 'Host effect',
      kind: 'task',
      taskTrack: 'general',
      taskTrackSource: 'inferred',
    });
    const snap = jobRecordToSnapshot(getJob(store, job.id)!);
    expect(snap.effectPreview?.isolation).toBe('checkout');
    expect(snap.effectPreview?.chip).toContain('checkout');
    expect(snap.effectPreview?.summary).toContain('Conductor judged');
    expect(snap.effectPreview?.taskTrack).toBe('general');
    expect(snap.effectPreview?.taskTrackSource).toBe('inferred');
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

describe('conductor_ux_v2 flag', () => {
  it('is registered with default true', () => {
    const flag = FLAG_DEFINITIONS.find((d) => d.id === 'conductor_ux_v2');
    expect(flag).toBeDefined();
    expect(flag?.default).toBe(true);
    expect(flag?.env).toBe('SUPERLIORA_EXPERIMENTAL_CONDUCTOR_UX_V2');
  });
});
