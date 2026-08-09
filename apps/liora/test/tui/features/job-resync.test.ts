import { describe, expect, it, vi } from 'vitest';

import type { JobSnapshot } from '@superliora/protocol';

import { JobBoardStore } from '#/tui/features/control-tower/job-board-store';
import { resyncJobBoardFromSession } from '#/tui/features/control-tower/job-resync';

function snap(id: string, status: JobSnapshot['status'] = 'running'): JobSnapshot {
  return {
    id,
    title: `t-${id}`,
    status,
    kind: 'task',
    priority: 1,
    briefPreview: { successCriteria: ['ok'] },
    gateChecklist: {
      visual: 'na',
      review: 'pass',
      tests: 'pass',
      typecheck: 'pass',
    },
  };
}

describe('job board resync (F18)', () => {
  it('applySnapshots replaces cards and preserves inbox unread', () => {
    const store = new JobBoardStore();
    store.applyJobUpdated({
      type: 'job.updated',
      schemaVersion: 3,
      job: snap('job_old', 'queued'),
    });
    store.applyJobInbox({
      type: 'job.inbox',
      schemaVersion: 3,
      eventId: 'e1',
      jobId: 'job_old',
      kind: 'job.completed',
      status: 'done',
      title: 'done',
    });
    expect(store.snapshot().unreadInbox).toBe(1);

    store.applySnapshots([snap('job_a'), snap('job_b', 'blocked')]);
    const next = store.snapshot();
    expect(next.jobs.map((j) => j.id).sort()).toEqual(['job_a', 'job_b']);
    expect(next.jobs.find((j) => j.id === 'job_a')?.gateChecklist?.tests).toBe('pass');
    expect(next.unreadInbox).toBe(1);
    expect(next.blocked).toBe(1);
    expect(next.running).toBe(1);
  });

  it('resyncJobBoardFromSession pulls jobList into the desk', async () => {
    const store = new JobBoardStore();
    const desk = {
      applySnapshots: (jobs: readonly JobSnapshot[]) => {
        store.applySnapshots(jobs);
      },
      publishFromStore: vi.fn(),
    };
    const host = {
      controlTowerDesk: desk,
      requireSession: () => ({
        jobList: async () => [snap('job_sync')],
      }),
    };
    await expect(resyncJobBoardFromSession(host)).resolves.toBe(true);
    expect(store.snapshot().jobs).toHaveLength(1);
    expect(store.snapshot().jobs[0]?.id).toBe('job_sync');
    expect(desk.publishFromStore).toHaveBeenCalledOnce();
  });
});
