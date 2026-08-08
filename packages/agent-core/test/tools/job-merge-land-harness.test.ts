/**
 * Merge landing harness: kind=merge is a deterministic land executor
 * (not an LLM worker), branch resolve prefers ledger / detached SHA, and
 * git failures keep stderr in the error.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { CONDUCTOR_WAKE_ORIGIN } from '../../src/session/job/conductor-wake';
import {
  landJobToMain,
  resolveJobWorktreeMergeRef,
  runMergeLandJob,
} from '../../src/tools/builtin/job/job-land';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { assignJobWorktree } from '../../src/tools/builtin/job/job-runtime';
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

type GitResult = { code: number; stdout: string; stderr: string };

describe('resolveJobWorktreeMergeRef', () => {
  it('prefers the ledger worktreeBranch', async () => {
    const runGit = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'unused' }));
    const resolved = await resolveJobWorktreeMergeRef('/wt', runGit, 'liora/conductor-jabc');
    expect(resolved.ref).toBe('liora/conductor-jabc');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('falls back to HEAD SHA when abbrev-ref is detached', async () => {
    const runGit = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { code: 0, stdout: 'HEAD\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'deadbeefcafe1234567890ab\n', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'unexpected' };
    };
    const resolved = await resolveJobWorktreeMergeRef('/wt', runGit);
    expect(resolved.ref).toBe('deadbeefcafe1234567890ab');
  });

  it('surfaces git stderr when resolve fails', async () => {
    const runGit = async (): Promise<GitResult> => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });
    const resolved = await resolveJobWorktreeMergeRef('/missing', runGit);
    expect(resolved.ref).toBeUndefined();
    expect(resolved.error).toContain('Could not resolve branch in job worktree');
    expect(resolved.error).toContain('fatal: not a git repository');
  });
});

describe('landJobToMain branch resolve', () => {
  it('merges using a detached HEAD SHA', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'detached land', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt/detached',
      resultSummary: 'done',
    });
    const calls: { cwd: string; args: readonly string[] }[] = [];
    const runGit = async (cwd: string, args: readonly string[]): Promise<GitResult> => {
      calls.push({ cwd, args });
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { code: 0, stdout: 'HEAD\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'abc1234deadbeef\n', stderr: '' };
      }
      if (args[0] === 'merge') {
        return { code: 0, stdout: 'Fast-forward', stderr: '' };
      }
      if (args[0] === 'merge-base') {
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'status') {
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(calls.some((c) => c.args[0] === 'merge' && c.args.includes('abc1234deadbeef'))).toBe(
      true,
    );
  });

  it('keeps git stderr on resolve failure', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'bad wt', kind: 'implement' });
    patchJob(store, job.id, { status: 'done', worktreePath: '/tmp/gone' });
    const runGit = async (): Promise<GitResult> => ({
      code: 128,
      stdout: '',
      stderr: 'kaos unavailable for git land',
    });

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('kaos unavailable for git land');
    expect(getJob(store, job.id)?.notes).toContain('kaos unavailable for git land');
  });

  it('uses ledger worktreeBranch without calling abbrev-ref', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ledger branch', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt/ledger',
      worktreeBranch: 'liora/conductor-jtest',
    });
    const calls: string[][] = [];
    const runGit = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      calls.push([...args]);
      if (args[0] === 'merge') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'feedface00112233\n', stderr: '' };
      }
      if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'rev-parse' && a[1] === '--abbrev-ref')).toBe(false);
    expect(calls.some((a) => a[0] === 'merge' && a.includes('liora/conductor-jtest'))).toBe(true);
  });
});

describe('assignJobWorktree records worktreeBranch', () => {
  it('stores meta.branch on the job ledger', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'branch record' });
    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      ensureGitRepo: false,
      createWorktree: async (_kaos, input) => ({
        workDir: `/tmp/worktrees/${input.name}`,
        meta: {
          path: `/tmp/worktrees/${input.name}`,
          branch: `liora/${input.name}`,
          repoRoot: '/tmp/repo',
          name: input.name,
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
        },
        record: {
          name: input.name,
          path: `/tmp/worktrees/${input.name}`,
          repoRoot: '/tmp/repo',
          branch: `liora/${input.name}`,
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      }),
    });

    expect(assigned.error).toBeUndefined();
    expect(assigned.job?.worktreeBranch).toMatch(/^liora\//);
    expect(assigned.job?.notes).toContain(assigned.job!.worktreeBranch!);
  });
});

describe('kind=merge launch runs deterministic land (no LLM)', () => {
  it('lands the source job and never calls spawnOne', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'source', kind: 'implement' });
    patchJob(store, source.id, {
      status: 'done',
      worktreePath: '/tmp/wt/source',
      worktreeBranch: 'liora/conductor-source',
      resultSummary: 'ready',
    });
    const mergeJob = createJob(store, {
      title: `Land ${source.id}`,
      kind: 'merge',
      parentJobId: source.id,
    });
    patchJob(store, mergeJob.id, { status: 'running', notes: 'resume: re-queued' });

    const spawnOne = vi.fn(async () => {
      throw new Error('LLM spawn must not run for merge');
    });
    const runGit = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      if (args[0] === 'merge') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'aabbccddeeff0011\n', stderr: '' };
      }
      if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const agent = { kaos: undefined, config: { cwd: '/repo/main' }, subagentHost: {} } as never;
    const result = await launchJobWorker({
      store,
      agent,
      job: getJob(store, mergeJob.id)!,
      spawnOne: spawnOne as never,
      runGit,
    });

    expect(result.ok).toBe(true);
    expect(spawnOne).not.toHaveBeenCalled();
    expect(getJob(store, mergeJob.id)?.status).toBe('done');
    expect(getJob(store, source.id)?.landReceipt?.branch).toBe('liora/conductor-source');
  });

  it('blocks the merge job when parentJobId is missing', async () => {
    const store = memoryStore();
    const mergeJob = createJob(store, { title: 'orphan merge', kind: 'merge' });
    patchJob(store, mergeJob.id, { status: 'running' });

    const land = await runMergeLandJob({
      store,
      mergeJob: getJob(store, mergeJob.id)!,
      repoPath: '/repo/main',
    });

    expect(land.ok).toBe(false);
    expect(land.error).toContain('missing parentJobId');
    expect(getJob(store, mergeJob.id)?.status).toBe('blocked');
  });

  it('pushes inbox + wakes Conductor when land fails', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'source', kind: 'implement' });
    patchJob(store, source.id, {
      status: 'done',
      worktreePath: '/tmp/wt/source',
      resultSummary: 'ready',
    });
    const mergeJob = createJob(store, {
      title: `Land ${source.id}`,
      kind: 'merge',
      parentJobId: source.id,
    });
    patchJob(store, mergeJob.id, { status: 'running' });

    const prompts: { origin: unknown }[] = [];
    const agent = {
      type: 'main',
      kaos: undefined,
      config: { cwd: '/repo/main' },
      turn: {
        hasActiveTurn: false,
        prompt(_input: unknown, origin: unknown) {
          prompts.push({ origin });
          return 1;
        },
      },
    } as unknown as Agent;

    const runGit = async (): Promise<GitResult> => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });

    const land = await runMergeLandJob({
      store,
      mergeJob: getJob(store, mergeJob.id)!,
      repoPath: '/repo/main',
      runGit,
      agent,
    });

    expect(land.ok).toBe(false);
    expect(getJob(store, mergeJob.id)?.status).toBe('blocked');
    expect(getJob(store, source.id)?.status).toBe('blocked');
    const unread = listUnreadJobInbox(store);
    expect(unread.some((e) => e.jobId === mergeJob.id && e.kind === 'job.blocked')).toBe(true);
    expect(unread.some((e) => e.jobId === source.id && e.kind === 'job.blocked')).toBe(true);
    // Source + merge both notify; a live main lane coalesces via hasActiveTurn.
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts.every((p) => p.origin === CONDUCTOR_WAKE_ORIGIN)).toBe(true);
  });
});
