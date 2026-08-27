/**
 * Land pass gate + Job Deck visibility: failed/unpassed work must not merge,
 * and gateChecklist.land / Apply hints must reflect that on the Job snapshot.
 */

import { describe, expect, it } from 'vitest';

import {
  actionHintsForInboxKind,
  jobRecordToSnapshot,
} from '../../src/tools/builtin/job/job-emit';
import { landJobToMain } from '../../src/tools/builtin/job/job-land';
import { LAND_REFUSED_NOTE } from '../../src/tools/builtin/job/job-land-gate';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { jobChooseLand } from '../../src/tools/builtin/job/job-rpc-api';
import { jobIsolationKind } from '../../src/tools/builtin/job/job-task-track';
import { onJobTerminalForVerifyChain } from '../../src/tools/builtin/job/job-verify-chain';
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

type GitResult = { code: number; stdout: string; stderr: string };

function gitStub() {
  const calls: { cwd: string; args: readonly string[] }[] = [];
  const runGit = async (cwd: string, args: readonly string[]): Promise<GitResult> => {
    calls.push({ cwd, args });
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
      return { code: 0, stdout: 'job/feature-x\n', stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { code: 0, stdout: 'abc123def456\n', stderr: '' };
    }
    if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'merge') return { code: 0, stdout: 'Merge made by ort', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, runGit };
}

describe('land pass gate', () => {
  it('does not merge a failed Job onto the operator checkout', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'failed land', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'failed',
      worktreePath: `/tmp/wt/${job.id}`,
      worktreeBranch: 'job/failed',
      resultSummary: 'worker crashed',
    });
    const { calls, runGit } = gitStub();

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.error).toContain(LAND_REFUSED_NOTE);
    expect(result.error).toContain('status=failed');
    expect(calls.some((c) => c.args[0] === 'merge')).toBe(false);
    expect(getJob(store, job.id)?.status).toBe('failed');
    expect(getJob(store, job.id)?.notes).toContain(LAND_REFUSED_NOTE);
  });

  it('does not merge a done Job whose verification contract failed', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ungreen land', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${job.id}`,
      worktreeBranch: 'job/ungreen',
      resultContract: {
        agent_id: 'agent_1',
        profile: 'coder',
        status: 'completed',
        summary: 'tests red',
        files_changed: ['src/a.ts'],
        verification: { tests: 'failed', typecheck: 'passed', lint: 'passed' },
        verification_failed: true,
        deviations: [],
      },
    });
    const { calls, runGit } = gitStub();

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.error).toContain('verification failed');
    expect(calls.some((c) => c.args[0] === 'merge')).toBe(false);
    expect(getJob(store, job.id)?.status).toBe('blocked');
  });

  it('does not commit the operator checkout when a sprint coding Job has no worktree', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'orphan sprint',
      kind: 'implement',
      deliveryClass: 'sprint',
    });
    patchJob(store, job.id, { status: 'done', resultSummary: 'worker finished' });
    const { calls, runGit } = gitStub();

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.message).toContain('Nothing merged');
    expect(calls).toHaveLength(0);
    expect(getJob(store, job.id)?.landReceipt).toBeUndefined();
  });

  it('refuses Land on a queued Job before any git runs', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'still queued', kind: 'implement' });
    patchJob(store, job.id, { worktreePath: `/tmp/wt/${job.id}`, worktreeBranch: 'job/queued' });
    const { calls, runGit } = gitStub();

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.error).toContain('status=queued');
    expect(calls).toHaveLength(0);
    expect(getJob(store, job.id)?.status).toBe('queued');
  });

  it('lands a Job that is blocked only by a prior merge-trust hold', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'trust hold retry', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'blocked',
      worktreePath: `/tmp/wt/${job.id}`,
      worktreeBranch: 'job/retry',
      resultSummary: 'worker finished',
      notes: 'merge: hold — Dangerous paths',
    });
    const { calls, runGit } = gitStub();

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(calls.some((c) => c.args[0] === 'merge')).toBe(true);
  });

  it('refuses operator Apply on a failed Job without dispatching merge', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'apply failed', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'failed',
      worktreePath: `/tmp/wt/${job.id}`,
      landChoice: 'pending',
    });

    const result = await jobChooseLand(store, { jobId: job.id, choice: 'apply' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(LAND_REFUSED_NOTE);
    expect(getJob(store, job.id)?.landChoice).toBe('pending');
    expect(listJobs(store).filter((j) => j.kind === 'merge')).toHaveLength(0);
  });
});

describe('Land/verify Job snapshot for Job Deck', () => {
  it('exposes gateChecklist.land pending on an isolated coding Job', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Sprint fix',
      kind: 'implement',
      deliveryClass: 'sprint',
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${job.id}`,
      landChoice: 'pending',
    });
    const latest = getJob(store, job.id)!;
    expect(jobIsolationKind(latest)).toBe('worktree');
    const snap = jobRecordToSnapshot(latest);
    expect(snap.gateChecklist?.land).toBe('pending');
    expect(snap.effectPreview?.isolation).toBe('worktree');
    expect(actionHintsForInboxKind('job.completed', latest)).toEqual([
      'jobKeep',
      'jobApply',
      'jobPush',
      'jobInspect',
    ]);
  });

  it('marks land fail and drops Apply when verify chain failed', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'Needs review', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${job.id}`,
      landChoice: 'pending',
      verifyVerdict: 'failed',
    });
    const latest = getJob(store, job.id)!;
    const snap = jobRecordToSnapshot(latest);
    expect(snap.gateChecklist?.land).toBe('fail');
    expect(snap.gateChecklist?.review).toBe('fail');
    expect(snap.verifyVerdict).toBe('failed');
    expect(actionHintsForInboxKind('job.completed', latest)).toEqual([
      'jobInspect',
      'jobResume',
    ]);
  });

  it('stamps parent verifyVerdict from the verify chain so Land refuses without notes scrape', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Needs review',
      kind: 'implement',
      expertId: 'maker-x',
      deliveryClass: 'review',
      surfaceKind: 'none',
    });
    patchJob(store, parent.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${parent.id}`,
      landChoice: 'pending',
    });
    await onJobTerminalForVerifyChain(store, getJob(store, parent.id)!);
    const verify = listJobs(store).find((j) => j.kind === 'verify');
    expect(verify).toBeDefined();
    patchJob(store, verify!.id, {
      status: 'done',
      verifyVerdict: 'failed',
      resultSummary: '{"verdict":"fail","findings":["red"],"required_fixes":["fix"]}',
    });
    await onJobTerminalForVerifyChain(store, getJob(store, verify!.id)!);

    const latest = getJob(store, parent.id)!;
    expect(latest.verifyVerdict).toBe('failed');
    const { calls, runGit } = gitStub();
    const result = await landJobToMain({
      store,
      job: latest,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });
    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(calls.some((c) => c.args[0] === 'merge')).toBe(false);
    const snap = jobRecordToSnapshot(getJob(store, parent.id)!);
    expect(snap.verifyVerdict).toBe('failed');
    expect(snap.gateChecklist?.land).toBe('fail');
    expect(snap.gateChecklist?.review).toBe('fail');
  });

  it('marks land pass after a verified receipt', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'Landed', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      landReceipt: {
        mergeSha: 'deadbeefcafe',
        branch: 'job/x',
        verifiedAt: '2026-08-27T00:00:00.000Z',
      },
    });
    const snap = jobRecordToSnapshot(getJob(store, job.id)!);
    expect(snap.gateChecklist?.land).toBe('pass');
    expect(actionHintsForInboxKind('job.completed', getJob(store, job.id)!)).toEqual([
      'jobInspect',
    ]);
  });
});
