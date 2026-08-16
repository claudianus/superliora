import { describe, expect, it } from 'vitest';

import {
  LAND_LEDGER_ONLY_MESSAGE,
  landJobToMain,
} from '../../src/tools/builtin/job/job-land';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

/**
 * Land receipt (feedback: a landing report must carry command-level proof).
 *
 * A `git merge` exit code of 0 alone is not evidence that main contains the
 * branch. After a successful merge the land must verify `rev-parse HEAD` and
 * `merge-base --is-ancestor <branch> HEAD`, record a structured receipt, and
 * block — never report done — when verification fails.
 */

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

function jobWithWorktree(store: ToolStore, title: string) {
  const job = createJob(store, { title, kind: 'implement' });
  const done = patchJob(store, job.id, {
    status: 'done',
    worktreePath: `/tmp/wt/${job.id}`,
    resultSummary: 'worker finished',
  });
  if (!done) throw new Error('failed to prepare job');
  return done;
}

type GitResult = { code: number; stdout: string; stderr: string };

function gitStub(overrides?: {
  readonly headSha?: string;
  readonly headCode?: number;
  readonly ancestorCode?: number;
}) {
  const calls: { cwd: string; args: readonly string[] }[] = [];
  const runGit = async (cwd: string, args: readonly string[]): Promise<GitResult> => {
    calls.push({ cwd, args });
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
      return { code: 0, stdout: 'job/feature-x\n', stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return {
        code: overrides?.headCode ?? 0,
        stdout: overrides?.headSha !== undefined ? `${overrides.headSha}\n` : 'abc123def456\n',
        stderr: '',
      };
    }
    if (args[0] === 'merge-base') {
      return { code: overrides?.ancestorCode ?? 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'merge') {
      return { code: 0, stdout: 'Merge made by ort', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, runGit };
}

describe('landJobToMain post-merge receipt', () => {
  it('records a structured receipt after a verified merge', async () => {
    const store = memoryStore();
    const job = jobWithWorktree(store, 'receipt job');
    const { runGit } = gitStub({ headSha: 'deadbeefcafe1234' });

    const result = await landJobToMain({
      store,
      job,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    const receipt = getJob(store, job.id)?.landReceipt;
    expect(receipt?.mergeSha).toBe('deadbeefcafe1234');
    expect(receipt?.branch).toBe('job/feature-x');
    expect(receipt?.verifiedAt).toBeDefined();
    expect(getJob(store, job.id)?.notes).toContain('receipt deadbeefcaf');
    expect(result.message).toContain('deadbeefcaf');
  });

  it('blocks instead of reporting done when the branch is not an ancestor of HEAD', async () => {
    const store = memoryStore();
    const job = jobWithWorktree(store, 'ancestor fail job');
    const { runGit } = gitStub({ ancestorCode: 1 });

    const result = await landJobToMain({
      store,
      job,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.error).toContain('land verification failed');
    const stored = getJob(store, job.id);
    expect(stored?.status).toBe('blocked');
    expect(stored?.landReceipt).toBeUndefined();
    expect(stored?.notes).toContain('post-merge verification failed');
  });

  it('blocks when HEAD cannot be read after the merge', async () => {
    const store = memoryStore();
    const job = jobWithWorktree(store, 'head fail job');
    const { runGit } = gitStub({ headCode: 128, headSha: '' });

    const result = await landJobToMain({
      store,
      job,
      repoPath: '/repo/main',
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(getJob(store, job.id)?.landReceipt).toBeUndefined();
  });

  it('never reads as landed when there is no worktree (ledger-only)', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ledger only job', kind: 'implement' });

    const result = await landJobToMain({ store, job, repoPath: '/repo/main' });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.message).toBe(LAND_LEDGER_ONLY_MESSAGE);
    expect(result.message).toContain('Nothing merged');
    expect(getJob(store, job.id)?.landReceipt).toBeUndefined();
  });
});

describe('landJobToMain repoPath inference + GC\'d worktree + index.lock', () => {
  it('infers repoPath from agent session cwd when omitted (auto-land path)', async () => {
    const store = memoryStore();
    const job = jobWithWorktree(store, 'missing repoPath');
    patchJob(store, job.id, { worktreeBranch: 'job/feature-x' });
    const { runGit, calls } = gitStub({ headSha: 'aabbccddeeff0011' });
    const agent = { config: { cwd: '/repo/main-from-agent' } } as never;

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      runGit,
      agent,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.message).toContain('/repo/main-from-agent');
    expect(calls.some((c) => c.cwd === '/repo/main-from-agent' && c.args[0] === 'merge')).toBe(
      true,
    );
  });

  it('infers repoPath from git common-dir when agent cwd is also missing', async () => {
    const store = memoryStore();
    // Use a real existing directory so existsSync(worktreePath) is true for inference.
    const worktreePath = process.cwd();
    const job = createJob(store, { title: 'common-dir infer', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath,
      worktreeBranch: 'job/from-common-dir',
      resultSummary: 'done',
    });
    const calls: { cwd: string; args: readonly string[] }[] = [];
    const runGit = async (cwd: string, args: readonly string[]): Promise<GitResult> => {
      calls.push({ cwd, args });
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
        return { code: 0, stdout: '/repo/main/.git\n', stderr: '' };
      }
      if (args[0] === 'merge') return { code: 0, stdout: 'ok', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: '1122334455667788\n', stderr: '' };
      }
      if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(calls.some((c) => c.cwd === '/repo/main' && c.args[0] === 'merge')).toBe(true);
    expect(result.message).toContain('/repo/main');
  });

  it('lands from ledger worktreeBranch when the worktree directory is already GC\'d', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'gc\'d worktree land', kind: 'implement' });
    const missingPath = `/tmp/wt/does-not-exist-${job.id}`;
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: missingPath,
      worktreeBranch: 'liora/conductor-already-gc',
      resultSummary: 'done',
    });
    const calls: { cwd: string; args: readonly string[] }[] = [];
    const runGit = async (cwd: string, args: readonly string[]): Promise<GitResult> => {
      calls.push({ cwd, args });
      // Any git run against the missing worktree would be the bug under test.
      if (cwd === missingPath) {
        return {
          code: 128,
          stdout: '',
          stderr: `fatal: cannot change to '${missingPath}': No such file or directory`,
        };
      }
      if (args[0] === 'merge') return { code: 0, stdout: 'Fast-forward', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'feedface00112233\n', stderr: '' };
      }
      if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
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
    expect(calls.some((c) => c.cwd === missingPath)).toBe(false);
    expect(
      calls.some(
        (c) => c.cwd === '/repo/main' && c.args[0] === 'merge' && c.args.includes('liora/conductor-already-gc'),
      ),
    ).toBe(true);
    expect(getJob(store, job.id)?.landReceipt?.branch).toBe('liora/conductor-already-gc');
    expect(getJob(store, job.id)?.notes).toMatch(/GC'd|already GC/);
  });

  it('retries merge on index.lock then fails with a stale-lock hint', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'index lock land', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${job.id}`,
      worktreeBranch: 'liora/lock-contended',
    });
    let mergeAttempts = 0;
    const sleeps: number[] = [];
    const runGit = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      if (args[0] === 'merge') {
        mergeAttempts += 1;
        return {
          code: 128,
          stdout: '',
          stderr:
            "fatal: Unable to create '/repo/main/.git/index.lock': File exists.",
        };
      }
      if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(mergeAttempts).toBe(4);
    expect(sleeps).toEqual([50, 100, 200]);
    expect(result.error).toMatch(/index\.lock/i);
    expect(result.error).toMatch(/stale lock/i);
    expect(result.error).toContain('.git/index.lock');
    expect(getJob(store, job.id)?.status).toBe('blocked');
  });

  it('succeeds after a transient index.lock on merge', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'index lock recover', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: `/tmp/wt/${job.id}`,
      worktreeBranch: 'liora/lock-recover',
    });
    let mergeAttempts = 0;
    const runGit = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      if (args[0] === 'merge') {
        mergeAttempts += 1;
        if (mergeAttempts < 2) {
          return {
            code: 128,
            stdout: '',
            stderr: "fatal: Unable to create '/repo/main/.git/index.lock': File exists.",
          };
        }
        return { code: 0, stdout: 'Merge made by ort', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: '99aabbccddeeff00\n', stderr: '' };
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
      sleep: async () => {},
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(true);
    expect(mergeAttempts).toBe(2);
    expect(getJob(store, job.id)?.landReceipt?.branch).toBe('liora/lock-recover');
  });
});
