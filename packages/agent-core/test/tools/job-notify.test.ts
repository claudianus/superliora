/**
 * Exceptional Job status → inbox + Conductor wake (single choke point).
 */

import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { CONDUCTOR_WAKE_ORIGIN } from '../../src/session/job/conductor-wake';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import {
  isJobExceptionalStatus,
  notifyJobTerminal,
  patchJobAndNotify,
} from '../../src/tools/builtin/job/job-notify';
import { assignJobWorktree, scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import { cancelJobWorker, interruptRunningJobs } from '../../src/tools/builtin/job/job-worker';
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

function fakeMainAgent() {
  const prompts: { origin: unknown }[] = [];
  const agent = {
    type: 'main',
    kaos: undefined,
    config: { cwd: '/repo' },
    log: undefined,
    subagentHost: undefined,
    turn: {
      hasActiveTurn: false,
      prompt(_input: unknown, origin: unknown) {
        prompts.push({ origin });
        return 1;
      },
    },
  } as unknown as Agent;
  return { agent, prompts };
}

describe('isJobExceptionalStatus', () => {
  it('covers terminal and hold statuses only', () => {
    expect(isJobExceptionalStatus('done')).toBe(true);
    expect(isJobExceptionalStatus('failed')).toBe(true);
    expect(isJobExceptionalStatus('blocked')).toBe(true);
    expect(isJobExceptionalStatus('needs_user')).toBe(true);
    expect(isJobExceptionalStatus('cancelled')).toBe(true);
    expect(isJobExceptionalStatus('interrupted')).toBe(true);
    expect(isJobExceptionalStatus('queued')).toBe(false);
    expect(isJobExceptionalStatus('running')).toBe(false);
  });
});

describe('patchJobAndNotify', () => {
  it('wakes Conductor on status transition into blocked', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'wt fail' });
    const { agent, prompts } = fakeMainAgent();

    patchJobAndNotify(
      store,
      job.id,
      { status: 'blocked', notes: 'worktree_failed: boom' },
      { agent, summary: 'worktree_failed: boom' },
    );

    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(listUnreadJobInbox(store).some((e) => e.kind === 'job.blocked')).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.origin).toEqual(CONDUCTOR_WAKE_ORIGIN);
  });

  it('stays quiet on same-status re-patch', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'already blocked' });
    patchJob(store, job.id, { status: 'blocked' });
    const { agent, prompts } = fakeMainAgent();

    patchJobAndNotify(
      store,
      job.id,
      { status: 'blocked', notes: 'still blocked' },
      { agent, summary: 'still blocked' },
    );

    expect(prompts).toHaveLength(0);
    expect(listUnreadJobInbox(store)).toHaveLength(0);
  });

  it('does not wake on queued→running', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'start' });
    const { agent, prompts } = fakeMainAgent();

    patchJobAndNotify(store, job.id, { status: 'running' }, { agent });

    expect(prompts).toHaveLength(0);
    expect(listUnreadJobInbox(store)).toHaveLength(0);
  });
});

describe('exceptional path coverage', () => {
  it('schedule worktree_required blocks wake Conductor', async () => {
    const store = memoryStore();
    createJob(store, { title: 'needs wt', kind: 'implement' });
    const { agent, prompts } = fakeMainAgent();

    const result = await scheduleQueuedJobs({
      store,
      agent,
      requireWorktree: true,
      // kaos/repoPath missing → worktree_required
    });

    expect(result.blocked.length).toBeGreaterThan(0);
    expect(listUnreadJobInbox(store).some((e) => e.kind === 'job.blocked')).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('assignJobWorktree failure wakes Conductor', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'create fails' });
    const { agent, prompts } = fakeMainAgent();

    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: '/repo',
      ensureGitRepo: false,
      agent,
      createWorktree: async () => {
        throw new Error('disk full');
      },
    });

    expect(assigned.error).toContain('disk full');
    expect(assigned.job?.status).toBe('blocked');
    expect(listUnreadJobInbox(store).some((e) => e.jobId === job.id)).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('cancelJobWorker passes agent into wake', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'cancel me' });
    patchJob(store, job.id, { status: 'running' });
    const { agent, prompts } = fakeMainAgent();

    await cancelJobWorker({ store, agent, jobId: job.id, reason: 'user cancel' });

    expect(getJob(store, job.id)?.status).toBe('cancelled');
    expect(listUnreadJobInbox(store).some((e) => e.kind === 'job.cancelled')).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('interruptRunningJobs wakes when agent is provided', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'interrupt me' });
    patchJob(store, job.id, { status: 'running' });
    const { agent, prompts } = fakeMainAgent();

    interruptRunningJobs({ store, agent, reason: 'session closed' });

    expect(getJob(store, job.id)?.status).toBe('interrupted');
    expect(listUnreadJobInbox(store).some((e) => e.kind === 'job.interrupted')).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('notifyJobTerminal no-ops for non-exceptional status', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'running' });
    const { agent, prompts } = fakeMainAgent();

    notifyJobTerminal({ store, job, status: 'running', agent });

    expect(prompts).toHaveLength(0);
    expect(listUnreadJobInbox(store)).toHaveLength(0);
  });
});
