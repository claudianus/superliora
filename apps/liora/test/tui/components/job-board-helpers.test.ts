import { describe, expect, it } from 'vitest';

import {
  computeJobBackpressure,
  groupJobCards,
  inboxKindLabel,
  JOB_BOARD_GROUP_ORDER,
  shortJobId,
  worktreeLeaf,
} from '#/tui/components/job-board/job-board-helpers';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

function card(
  id: string,
  status: ConductorJobCard['status'],
  priority = 1,
  updatedAtMs = 0,
): ConductorJobCard {
  return { id, title: id, status, kind: 'task', priority, updatedAtMs };
}

describe('job-board-helpers', () => {
  it('groups cards in board order and sorts each group by priority desc', () => {
    const groups = groupJobCards([
      card('job_done', 'done', 5, 10),
      card('job_q1', 'queued', 1, 20),
      card('job_run', 'running', 2, 30),
      card('job_q2', 'queued', 4, 5),
    ]);
    expect(groups.map((g) => g.status)).toEqual(['running', 'queued', 'done']);
    const queued = groups[1];
    expect(queued?.cards.map((c) => c.id)).toEqual(['job_q2', 'job_q1']);
    for (const group of groups) {
      expect(JOB_BOARD_GROUP_ORDER.indexOf(group.status)).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports backpressure only while jobs are queued', () => {
    expect(computeJobBackpressure({ queued: 0, running: 6, maxConcurrent: 6 })).toBeUndefined();
    const saturated = computeJobBackpressure({ queued: 3, running: 6, maxConcurrent: 6 });
    expect(saturated?.token).toBe('warning');
    expect(saturated?.label).toContain('3 queued');
    expect(saturated?.label).toContain('6/6 slots');
    const unknownPool = computeJobBackpressure({ queued: 2, running: 1 });
    expect(unknownPool?.label).toContain('2 queued');
  });

  it('shortens ids and worktree paths', () => {
    expect(shortJobId('job_a1b2c3d4e5f6')).toBe('a1b2c3d4');
    expect(shortJobId('job_abc')).toBe('abc');
    expect(worktreeLeaf('/tmp/worktrees/superliora-x/conductor-abc')).toBe('conductor-abc');
    expect(inboxKindLabel('job.needs_user')).toBe('needs_user');
  });
});
