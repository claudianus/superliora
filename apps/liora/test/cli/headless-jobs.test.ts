import { describe, expect, it, vi } from 'vitest';

import type { JobSnapshot, Session } from '@superliora/sdk';

import { GOAL_EXIT_CODES } from '#/cli/goal-prompt';
import {
  captureJobBaseline,
  collectJobsCreatedDuringRun,
  formatHeadlessJobSummaryText,
  HEADLESS_JOB_EXIT_CODES,
  headlessJobExitCode,
  summarizeHeadlessJobs,
} from '#/cli/headless-jobs';

function job(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job_1',
    title: 'ship the fix',
    status: 'done',
    kind: 'implement',
    priority: 0,
    ...overrides,
  } as JobSnapshot;
}

function sessionWithJobs(jobs: readonly JobSnapshot[]): Session {
  const jobList = vi.fn(async () => jobs);
  return { jobList } as unknown as Session;
}

describe('summarizeHeadlessJobs', () => {
  it('reports ok when every job created this run is done', () => {
    const summary = summarizeHeadlessJobs([job()]);
    expect(summary.exit).toBe('ok');
    expect(headlessJobExitCode(summary)).toBe(HEADLESS_JOB_EXIT_CODES.ok);
  });

  it('reports ok when no jobs were created', () => {
    expect(summarizeHeadlessJobs([]).exit).toBe('ok');
  });

  it('reports pending while a job is still queued/running/blocked', () => {
    for (const status of ['queued', 'running', 'blocked', 'needs_user'] as const) {
      const summary = summarizeHeadlessJobs([job({ status })]);
      expect(summary.exit).toBe('pending');
    }
    expect(headlessJobExitCode(summarizeHeadlessJobs([job({ status: 'running' })]))).toBe(
      HEADLESS_JOB_EXIT_CODES.pending,
    );
  });

  it('reports pending when a finished coding job awaits a land decision', () => {
    const summary = summarizeHeadlessJobs([job({ landChoice: 'pending' })]);
    expect(summary.exit).toBe('pending');
    // explore jobs have no land decision — a done explore is done.
    expect(summarizeHeadlessJobs([job({ kind: 'explore', landChoice: 'pending' })]).exit).toBe(
      'ok',
    );
    expect(summarizeHeadlessJobs([job({ landChoice: 'keep' })]).exit).toBe('ok');
  });

  it('reports failed when a job failed, was cancelled, or interrupted', () => {
    for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
      expect(summarizeHeadlessJobs([job({ status })]).exit).toBe('failed');
    }
    expect(headlessJobExitCode(summarizeHeadlessJobs([job({ status: 'failed' })]))).toBe(
      HEADLESS_JOB_EXIT_CODES.failed,
    );
  });

  it('failed outranks pending, which outranks ok', () => {
    expect(
      summarizeHeadlessJobs([job({ status: 'done' }), job({ id: 'job_2', status: 'running' })]).exit,
    ).toBe('pending');
    expect(
      summarizeHeadlessJobs([job({ status: 'failed' }), job({ id: 'job_2', status: 'running' })]).exit,
    ).toBe('failed');
  });

  it('keeps non-zero exit codes distinct from goal exit codes', () => {
    const all = [
      ...Object.values(HEADLESS_JOB_EXIT_CODES).filter((code) => code !== 0),
      ...Object.values(GOAL_EXIT_CODES).filter((code) => code !== 0),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('caps stored summaries in the machine payload', () => {
    const summary = summarizeHeadlessJobs([
      job({ resultSummary: 'x'.repeat(500) }),
    ]);
    expect(summary.jobs[0]?.summary?.length).toBe(300);
  });
});

describe('formatHeadlessJobSummaryText', () => {
  it('renders an empty string for no jobs', () => {
    expect(formatHeadlessJobSummaryText(summarizeHeadlessJobs([]))).toBe('');
  });

  it('renders one line per job with kind and status', () => {
    const text = formatHeadlessJobSummaryText(
      summarizeHeadlessJobs([job({ resultSummary: 'applied the patch' })]),
    );
    expect(text).toContain('[jobs] 1 job created this run');
    expect(text).toContain('[job] job_1 [implement][done] ship the fix');
    expect(text).toContain('applied the patch');
  });
});

describe('job baseline capture', () => {
  it('captures pre-existing ids so only new jobs are reported', async () => {
    const session = sessionWithJobs([job(), job({ id: 'job_2', title: 'old' })]);
    const baseline = await captureJobBaseline(session);
    expect(baseline).toEqual(new Set(['job_1', 'job_2']));

    const created = await collectJobsCreatedDuringRun(
      sessionWithJobs([job(), job({ id: 'job_2', title: 'old' }), job({ id: 'job_3', status: 'running' })]),
      baseline,
    );
    expect(created.map((entry) => entry.id)).toEqual(['job_3']);
  });

  it('degrades to no jobs when the ledger is unreachable', async () => {
    const broken = { jobList: vi.fn(async () => { throw new Error('closed'); }) } as unknown as Session;
    expect(await captureJobBaseline(broken)).toEqual(new Set());
    expect(await collectJobsCreatedDuringRun(broken, new Set())).toEqual([]);
  });
});
