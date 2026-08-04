import { describe, expect, it } from 'vitest';

import { JobBoardApp } from '#/tui/components/job-board/job-board';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function fakeTerminal(rows: number, columns: number) {
  return { columns, rows, write: () => {} };
}

function card(
  id: string,
  status: ConductorJobCard['status'],
  extra: Partial<ConductorJobCard> = {},
): ConductorJobCard {
  return {
    id,
    title: `work on ${id}`,
    status,
    kind: 'task',
    priority: 1,
    updatedAtMs: Date.now(),
    ...extra,
  };
}

function snapshot(
  overrides: Partial<ConductorJobsSnapshot> = {},
): ConductorJobsSnapshot {
  return {
    total: 0,
    queued: 0,
    running: 0,
    blocked: 0,
    needsUser: 0,
    interrupted: 0,
    failed: 0,
    unreadInbox: 0,
    jobs: [],
    inbox: [],
    ...overrides,
  };
}

function boardProps(snap: ConductorJobsSnapshot) {
  return {
    snapshot: snap,
    selectedJobId: snap.jobs[0]?.id,
    flashMessage: undefined,
    onSelect: () => {},
    onCancel: () => {},
    onInspect: () => {},
  };
}

describe('JobBoardApp render', () => {
  it('renders header, grouped jobs, backpressure, and footer', () => {
    const snap = snapshot({
      total: 4,
      running: 2,
      queued: 1,
      unreadInbox: 2,
      maxConcurrent: 2,
      jobs: [
        card('job_run1', 'running', { worktreePath: '/tmp/wt/job-run1' }),
        card('job_run2', 'running', { priority: 3 }),
        card('job_que1', 'queued'),
        card('job_done1', 'done'),
      ],
      inbox: [
        {
          eventId: 'evt_1',
          kind: 'job.completed',
          jobId: 'job_done1',
          title: 'work on job_done1',
          summary: 'merged cleanly',
          atMs: Date.now(),
        },
      ],
    });
    const app = new JobBoardApp(boardProps(snap), fakeTerminal(24, 100));
    const lines = app.render(100);
    expect(lines).toHaveLength(24);
    const text = stripAnsi(lines.join('\n'));
    expect(text).toContain('CONDUCTOR JOB DESK');
    expect(text).toContain('2 running');
    expect(text).toContain('1 queued');
    expect(text).toContain('backpressure: 1 queued · 2/2 slots');
    expect(text).toContain('inbox 2');
    expect(text).toContain('job_run2');
    expect(text).toContain('job_que1');
    expect(text).toContain('Jobs [4]');
    expect(text).toContain('Worktree:');
    expect(text).toMatch(/↑↓\s+navigate/);
  });

  it('shows an empty state when no jobs exist', () => {
    const app = new JobBoardApp(boardProps(snapshot()), fakeTerminal(20, 90));
    const text = stripAnsi(app.render(90).join('\n'));
    expect(text).toContain('No Conductor jobs yet.');
    expect(text).toContain('Waiting for job events');
  });

  it('falls back on a too-small terminal', () => {
    const app = new JobBoardApp(boardProps(snapshot()), fakeTerminal(8, 50));
    const text = stripAnsi(app.render(50).join('\n'));
    expect(text).toContain('Terminal too small');
  });
});
