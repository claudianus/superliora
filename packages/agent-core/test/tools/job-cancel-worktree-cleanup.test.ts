/**
 * `cancelJobWorker` worktree hygiene: a job cancelled before any worker ever
 * bound to it holds only a pristine baseline worktree — it must be dropped
 * immediately instead of waiting out the failed-worktree TTL. Jobs that ran a
 * worker keep the 7-day forensics retention.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/session/worktree', () => ({
  removeSessionWorktree: vi.fn(async () => ({
    name: 'conductor-jtest',
    path: 'Z:/home/worktrees/repo/conductor-jtest',
    repoRoot: 'C:/repo',
    branch: 'liora/conductor-jtest',
    baseRef: 'HEAD',
    createdAt: '2026-08-30T00:00:00.000Z',
    lastAccessedAt: '2026-08-30T00:00:00.000Z',
  })),
}));
vi.mock('../../src/session/job/job-offload', () => ({
  requestJobSchedulePump: vi.fn(),
}));
vi.mock('../../src/session/job/conductor-wake', () => ({
  requestConductorWake: vi.fn(),
}));

import { removeSessionWorktree } from '../../src/session/worktree';
import { cancelJobWorker } from '../../src/tools/builtin/job/job-worker';
import {
  createJob,
  emptyJobLedger,
  getJob,
  writeJobLedger,
} from '../../src/tools/builtin/job/job-ledger';
import type { Agent } from '../../src/agent';
import type { ToolStore } from '../../src/tools/store';

const removeMock = vi.mocked(removeSessionWorktree);

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

const agent = {
  kaos: {},
  log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
} as unknown as Agent;

describe('cancelJobWorker pristine worktree cleanup', () => {
  beforeEach(() => {
    removeMock.mockClear();
  });

  it('removes the worktree immediately when no worker ever ran', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'plan portfolio', kind: 'mission' });
    const { patchJob } = await import('../../src/tools/builtin/job/job-ledger');
    patchJob(store, job.id, {
      status: 'blocked',
      worktreePath: 'Z:/home/worktrees/repo/conductor-jtest',
      worktreeBranch: 'liora/conductor-jtest',
    });

    const result = await cancelJobWorker({
      store,
      agent,
      jobId: job.id,
      reason: 'spawn blocked twice',
    });

    expect(result.ok).toBe(true);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0]?.[1]?.nameOrPath).toBe(
      'Z:/home/worktrees/repo/conductor-jtest',
    );
    await vi.waitFor(() => {
      expect(getJob(store, job.id)?.worktreePath).toBeUndefined();
      expect(getJob(store, job.id)?.worktreeBranch).toBeUndefined();
      expect(getJob(store, job.id)?.notes).toContain('pristine worktree removed');
    });
  });

  it('keeps the worktree when a worker ran (forensics retention)', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'implement auth', kind: 'implement' });
    const { patchJob } = await import('../../src/tools/builtin/job/job-ledger');
    patchJob(store, job.id, {
      status: 'running',
      worktreePath: 'Z:/home/worktrees/repo/conductor-jlive',
      worktreeBranch: 'liora/conductor-jlive',
      workerAgentId: 'worker-1',
    });

    await cancelJobWorker({ store, agent, jobId: job.id, reason: 'user stop' });

    expect(removeMock).not.toHaveBeenCalled();
    expect(getJob(store, job.id)?.worktreePath).toBe(
      'Z:/home/worktrees/repo/conductor-jlive',
    );
  });

  it('keeps the worktree for a never-ran job whose session name the operator pinned', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'pinned plan', kind: 'mission' });
    const { patchJob } = await import('../../src/tools/builtin/job/job-ledger');
    patchJob(store, job.id, {
      status: 'blocked',
      worktreePath: 'Z:/home/worktrees/repo/conductor-jpin',
      sessionNamePinned: true,
    });

    await cancelJobWorker({ store, agent, jobId: job.id });

    expect(removeMock).not.toHaveBeenCalled();
    expect(getJob(store, job.id)?.worktreePath).toBe(
      'Z:/home/worktrees/repo/conductor-jpin',
    );
  });
});
