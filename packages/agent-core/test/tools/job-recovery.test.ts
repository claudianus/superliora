import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../src/agent';
import { requestJobSchedulePump } from '../../src/session/job/job-offload';
import { recoverJobsAfterResume } from '../../src/tools/builtin/job/job-recovery';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { __resetJobWorkerHandlesForTests, registerJobWorkerHandle } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

vi.mock('../../src/session/job/job-offload', () => ({ requestJobSchedulePump: vi.fn(async () => {}), cancelQueuedJobWorkerSpawn: vi.fn(() => false) }));

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
  vi.clearAllMocks();
});

describe('durable Job recovery', () => {
  it('reconciles stale workers and holds every pending kind without starting work', async () => {
    const store = memoryStore();
    const task = createJob(store, { title: 'Task', kind: 'implement' });
    const merge = createJob(store, { title: 'Land', kind: 'merge' });
    const queued = createJob(store, { title: 'Queued' });
    const question = createJob(store, { title: 'Question' });
    patchJob(store, task.id, { status: 'running' });
    patchJob(store, merge.id, { status: 'running' });
    patchJob(store, question.id, { status: 'needs_user' });
    const agent = { config: { cwd: '/repo' } } as Agent;
    const result = await recoverJobsAfterResume({ store, agent });
    expect(result.reconciled.map((job) => job.id)).toEqual([task.id, merge.id]);
    expect(result.held).toHaveLength(4);
    expect(getJob(store, task.id)?.status).toBe('interrupted');
    expect(getJob(store, merge.id)?.status).toBe('interrupted');
    expect(getJob(store, queued.id)?.status).toBe('queued');
    expect(getJob(store, question.id)?.status).toBe('needs_user');
    expect(listUnreadJobInbox(store).filter((event) => event.kind === 'recovery.held')).toHaveLength(4);
    expect(requestJobSchedulePump).not.toHaveBeenCalled();
  });

  it('does not declare an admitted worker stale while its teardown is pending', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'Live worker' });
    patchJob(store, job.id, { status: 'running' });
    const controller = new AbortController();
    registerJobWorkerHandle(store, job.id, controller);
    controller.abort();
    const result = await recoverJobsAfterResume({ store });
    expect(result.reconciled).toHaveLength(0);
    expect(getJob(store, job.id)?.status).toBe('running');
  });
});
