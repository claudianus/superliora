import { describe, expect, it } from 'vitest';

import { assignJobWorktree } from '../../src/tools/builtin/job/job-runtime';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get: (key) => data[key] as never,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

describe('assignJobWorktree remounts a missing directory', () => {
  it('reattaches from worktreeBranch when the directory is gone', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'remount me' });
    patchJob(store, job.id, {
      worktreePath: '/tmp/gone-worktree',
      worktreeBranch: 'liora/conductor-gone',
    });

    const attached: Array<{ path: string; branch: string }> = [];
    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      ensureGitRepo: false,
      worktreeDirExists: async () => false,
      attachWorktree: async (_kaos, input) => {
        attached.push({ path: input.path, branch: input.branch });
        return {
          workDir: input.path,
          meta: {} as never,
          record: {} as never,
        };
      },
    });

    expect(assigned.error).toBeUndefined();
    expect(assigned.job?.status).not.toBe('blocked');
    expect(assigned.job?.notes).toContain('remounted');
    expect(attached).toEqual([{ path: '/tmp/gone-worktree', branch: 'liora/conductor-gone' }]);
  });

  it('blocks the job when remount fails', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'cannot remount' });
    patchJob(store, job.id, {
      worktreePath: '/tmp/gone-worktree',
      worktreeBranch: 'liora/conductor-gone',
    });

    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      ensureGitRepo: false,
      worktreeDirExists: async () => false,
      attachWorktree: async () => {
        throw new Error('branch missing');
      },
    });

    expect(assigned.error).toContain('branch missing');
    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(getJob(store, job.id)?.notes).toContain('worktree_missing');
  });

  it('blocks when the directory is gone and no branch is recorded', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'no branch' });
    patchJob(store, job.id, {
      worktreePath: '/tmp/gone-worktree',
    });

    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      ensureGitRepo: false,
      worktreeDirExists: async () => false,
      attachWorktree: async () => {
        throw new Error('must not run');
      },
    });

    expect(assigned.error).toContain('no worktreeBranch');
    expect(getJob(store, job.id)?.status).toBe('blocked');
  });

  it('keeps a live worktree path without remounting', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'still there' });
    patchJob(store, job.id, {
      worktreePath: '/tmp/live-worktree',
      worktreeBranch: 'liora/conductor-live',
    });

    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      ensureGitRepo: false,
      worktreeDirExists: async () => true,
      attachWorktree: async () => {
        throw new Error('must not remount');
      },
    });

    expect(assigned.error).toBeUndefined();
    expect(assigned.job?.worktreePath).toBe('/tmp/live-worktree');
    expect(assigned.job?.notes ?? '').not.toContain('remounted');
  });
});
