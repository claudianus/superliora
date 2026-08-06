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
