/**
 * Commit backstop for Conductor job worktrees.
 *
 * Land-to-main merges the worktree *branch*; a worker that never commits
 * leaves its work invisible to the merge and destroyed by worktree GC. The
 * backstop snapshots a dirty tree at worker completion and again before
 * land, so uncommitted work cannot be lost structurally. Git failures never
 * throw into job paths — they come back as a result error for ledger notes.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { landJobToMain } from '../../src/tools/builtin/job/job-land';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import {
  commitJobWorktreeIfDirty,
  JOB_WORKTREE_SNAPSHOT_MESSAGE_PREFIX,
  type WorktreeGitRunner,
} from '../../src/tools/builtin/job/job-worktree-commit';
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

interface GitCall {
  readonly cwd: string;
  readonly args: readonly string[];
}

interface FakeGitOptions {
  readonly statusStdout?: string;
  readonly failStatus?: boolean;
  readonly failCommit?: boolean;
  readonly configuredIdentity?: boolean;
}

/** Command name, skipping any inline `-c key=value` config overrides. */
function gitCommand(args: readonly string[]): string {
  if (args.includes('commit')) return 'commit';
  return args[0] ?? '';
}

function fakeGit(opts: FakeGitOptions = {}) {
  const calls: GitCall[] = [];
  const run: WorktreeGitRunner = async (cwd, args) => {
    calls.push({ cwd, args });
    const command = gitCommand(args);
    if (command === 'status') {
      return opts.failStatus
        ? { ok: false, stdout: '', stderr: 'not a git repository' }
        : { ok: true, stdout: opts.statusStdout ?? '', stderr: '' };
    }
    if (command === 'config') {
      return opts.configuredIdentity
        ? { ok: true, stdout: 'Jane Doe\n', stderr: '' }
        : { ok: false, stdout: '', stderr: 'unset' };
    }
    if (command === 'commit') {
      return opts.failCommit
        ? { ok: false, stdout: '', stderr: 'hook rejected' }
        : { ok: true, stdout: '[main abc123] snapshot', stderr: '' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  return { run, calls };
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});

describe('commitJobWorktreeIfDirty', () => {
  it('does nothing on a clean tree', async () => {
    const { run, calls } = fakeGit();
    const result = await commitJobWorktreeIfDirty({
      worktreePath: '/wt',
      jobId: 'job_clean',
      run,
    });

    expect(result).toEqual({ committed: false });
    expect(calls.map((c) => c.args[0])).toEqual(['status']);
  });

  it('commits a dirty tree with a standard message and fallback identity', async () => {
    const { run, calls } = fakeGit({ statusStdout: ' M src/a.ts\n?? src/b.ts\n' });
    const result = await commitJobWorktreeIfDirty({
      worktreePath: '/wt',
      jobId: 'job_dirty',
      jobTitle: 'fix the thing',
      run,
    });

    expect(result.committed).toBe(true);
    const sequence = calls.map((c) => gitCommand(c.args));
    expect(sequence).toEqual(['status', 'add', 'config', 'config', 'commit']);

    const commit = calls.find((c) => c.args.includes('commit'))!;
    const message = commit.args[commit.args.indexOf('-m') + 1]!;
    expect(message).toContain(JOB_WORKTREE_SNAPSHOT_MESSAGE_PREFIX);
    expect(message).toContain('job_dirty');
    expect(message).toContain('fix the thing');
    // No identity configured → inline -c overrides, never config mutation.
    expect(commit.args).toContain('-c');
    expect(commit.args).toContain('user.name=SuperLiora');
    expect(commit.args).toContain('--no-gpg-sign');
  });

  it('respects an already-configured git identity', async () => {
    const { run, calls } = fakeGit({ statusStdout: ' M a.ts', configuredIdentity: true });
    const result = await commitJobWorktreeIfDirty({
      worktreePath: '/wt',
      jobId: 'job_id',
      run,
    });

    expect(result.committed).toBe(true);
    const commit = calls.find((c) => c.args.includes('commit'))!;
    expect(commit.args).not.toContain('user.name=SuperLiora');
  });

  it('returns an error instead of throwing when git fails', async () => {
    const statusFail = await commitJobWorktreeIfDirty({
      worktreePath: '/wt',
      jobId: 'job_x',
      run: fakeGit({ failStatus: true }).run,
    });
    expect(statusFail.committed).toBe(false);
    expect(statusFail.error).toContain('git status failed');

    const commitFail = await commitJobWorktreeIfDirty({
      worktreePath: '/wt',
      jobId: 'job_x',
      run: fakeGit({ statusStdout: ' M a.ts', failCommit: true }).run,
    });
    expect(commitFail.committed).toBe(false);
    expect(commitFail.error).toContain('hook rejected');
  });
});

describe('landJobToMain commit backstop', () => {
  function doneJobWithWorktree(store: ToolStore) {
    const job = createJob(store, { title: 'land me', kind: 'implement' });
    const done = patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/land/${job.id}`,
      resultSummary: 'worker finished',
    });
    if (!done) throw new Error('failed to prepare job');
    return done;
  }

  function landGit(opts: FakeGitOptions & { readonly branch?: string }) {
    const calls: GitCall[] = [];
    const runGit = async (cwd: string, args: readonly string[]) => {
      calls.push({ cwd, args });
      const command = gitCommand(args);
      if (command === 'rev-parse') {
        return { code: 0, stdout: `${opts.branch ?? 'job/branch'}\n`, stderr: '' };
      }
      if (command === 'status') {
        return opts.failStatus
          ? { code: 1, stdout: '', stderr: 'not a git repository' }
          : { code: 0, stdout: opts.statusStdout ?? '', stderr: '' };
      }
      if (command === 'config') {
        return { code: 0, stdout: 'Jane Doe\n', stderr: '' };
      }
      if (command === 'commit') {
        return opts.failCommit
          ? { code: 1, stdout: '', stderr: 'hook rejected' }
          : { code: 0, stdout: '[job/branch abc] snapshot', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { runGit, calls };
  }

  it('snapshots a dirty worktree onto the branch before merging', async () => {
    const store = memoryStore();
    const job = doneJobWithWorktree(store);
    const { runGit, calls } = landGit({ statusStdout: ' M src/a.ts\n' });

    const result = await landJobToMain({
      store,
      job,
      repoPath: '/repo/main',
      gcOnSuccess: false,
      runGit,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    const commands = calls.map((c) => gitCommand(c.args));
    const commitAt = commands.indexOf('commit');
    const mergeAt = commands.indexOf('merge');
    expect(commitAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(commitAt);
    expect(getJob(store, job.id)?.notes).toContain('snapshotted uncommitted worker changes');
  });

  it('holds the land when the dirty tree cannot be snapshotted', async () => {
    const store = memoryStore();
    const job = doneJobWithWorktree(store);
    const { runGit, calls } = landGit({ statusStdout: ' M src/a.ts\n', failCommit: true });

    const result = await landJobToMain({
      store,
      job,
      repoPath: '/repo/main',
      gcOnSuccess: false,
      runGit,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(calls.some((c) => c.args[0] === 'merge')).toBe(false);
    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(getJob(store, job.id)?.notes).toContain('snapshot failed');
  });
});

describe('worker contract commit discipline', () => {
  it('worktree jobs explicitly authorize local commits; others stay silent', () => {
    const store = memoryStore();
    const withWorktree = patchJob(store, createJob(store, { title: 'wt', kind: 'implement' }).id, {
      worktreePath: '/tmp/wt/job',
    })!;

    const prompt = jobPrompt(withWorktree, store);
    expect(prompt).toContain('Commit your work in the job worktree before finishing');
    expect(prompt).toContain('explicitly authorizes those commits');
    expect(prompt).toContain('never push');

    const noWorktree = createJob(store, { title: 'plain', kind: 'implement' });
    expect(jobPrompt(noWorktree, store)).not.toContain('Commit your work in the job worktree');
  });
});
