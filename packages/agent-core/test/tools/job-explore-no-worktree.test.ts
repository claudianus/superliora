/**
 * P3-9 — `explore` jobs skip the worktree.
 *
 * The scheduler's worktree requirement was a single global flag, so a
 * read-only explore job paid `git worktree add` plus registry I/O for
 * isolation its profile has no write tools to need. Running in the main
 * checkout is also more accurate: uncommitted work stays visible.
 */

import { describe, expect, it } from 'vitest';

import { createJob, getJob } from '../../src/tools/builtin/job/job-ledger';
import { scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import type { JobKind } from '../../src/tools/builtin/job/job-store-key';
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

/** Records which jobs asked for a worktree; the real factory shells out to git. */
function countingWorktreeFactory(created: string[]) {
  return async (_kaos: unknown, input: { readonly name: string }) => {
    created.push(input.name);
    return { workDir: `/tmp/wt/${input.name}`, branch: `job/${input.name}` };
  };
}

async function scheduleOne(kind: JobKind, created: string[]) {
  const store = memoryStore();
  const job = createJob(store, { title: `${kind} job`, kind });
  const result = await scheduleQueuedJobs({
    store,
    kaos: {} as never,
    repoPath: '/repo',
    createWorktree: countingWorktreeFactory(created) as never,
    ensureGitRepo: false,
  });
  return { store, jobId: job.id, result };
}

describe('explore jobs skip worktree creation', () => {
  it('runs an explore job in the main checkout', async () => {
    const created: string[] = [];
    const { store, jobId, result } = await scheduleOne('explore', created);

    expect(result.started).toHaveLength(1);
    expect(getJob(store, jobId)?.status).toBe('running');
    expect(getJob(store, jobId)?.worktreePath).toBeUndefined();
    expect(created).toEqual([]);
  });

  it('skips the worktree for desk digests too (same read-only profile)', async () => {
    const created: string[] = [];
    const { store, jobId } = await scheduleOne('desk', created);

    expect(getJob(store, jobId)?.status).toBe('running');
    expect(created).toEqual([]);
  });

  it('skips the worktree for goal-desk umbrellas', async () => {
    const created: string[] = [];
    const { store, jobId } = await scheduleOne('goal-desk', created);

    expect(getJob(store, jobId)?.status).toBe('running');
    expect(getJob(store, jobId)?.worktreePath).toBeUndefined();
    expect(created).toEqual([]);
  });

  it('still isolates kinds that can write', async () => {
    for (const kind of ['implement', 'task', 'mission', 'merge'] as const) {
      const created: string[] = [];
      const { store, jobId } = await scheduleOne(kind, created);
      expect(getJob(store, jobId)?.worktreePath, kind).toBeDefined();
      expect(created, kind).toHaveLength(1);
    }
  });

  it('does not block an explore job when the repo context is missing', async () => {
    const store = memoryStore();
    const explore = createJob(store, { title: 'read the auth module', kind: 'explore' });
    const implement = createJob(store, { title: 'patch the auth module', kind: 'implement' });

    const result = await scheduleQueuedJobs({ store });

    expect(result.started.map((j) => j.id)).toEqual([explore.id]);
    expect(getJob(store, implement.id)?.status).toBe('blocked');
    expect(getJob(store, implement.id)?.notes).toContain('worktree_required');
  });
});
