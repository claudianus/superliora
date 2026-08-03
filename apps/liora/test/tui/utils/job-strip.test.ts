import { describe, expect, it } from 'vitest';

import {
  appendJobInboxEntry,
  emptyConductorJobsSnapshot,
  JOB_BOARD_MAX_CARDS,
  JOB_BOARD_MAX_INBOX,
  mergeConductorJobsSnapshot,
  parseJobLedgerCards,
  parseJobStripFromToolOutput,
  upsertConductorJobCard,
  type ConductorJobCard,
} from '#/tui/utils/job/job-strip';
import { labelConductorJobs } from '#/tui/components/chrome/footer/footer-labels';

describe('job-strip', () => {
  it('parses formatJobStripLine style output', () => {
    const snap = parseJobStripFromToolOutput('Jobs: 2▸ 1… inbox 3\nJob inbox empty.');
    expect(snap).toMatchObject({
      running: 2,
      queued: 1,
      unreadInbox: 3,
    });
  });

  it('parses JobList ledger lines', () => {
    const out = [
      'Job ledger:',
      '- job_abc [running] (task p1) one',
      '- job_def [queued] (task p0) two',
      '- job_ghi [interrupted] (implement p2) three',
    ].join('\n');
    const snap = parseJobStripFromToolOutput(out);
    expect(snap).toMatchObject({
      total: 3,
      running: 1,
      queued: 1,
      interrupted: 1,
    });
  });

  it('merges patches and labels', () => {
    const merged = mergeConductorJobsSnapshot(emptyConductorJobsSnapshot(), {
      running: 1,
      queued: 2,
      unreadInbox: 1,
      total: 3,
    });
    expect(labelConductorJobs('plain', merged)).toMatch(/Jobs/);
    expect(labelConductorJobs('compact', merged)).toMatch(/jobs:/);
  });

  it('parses per-job cards from JobList ledger lines', () => {
    const out = [
      'Job ledger:',
      '- job_a1 [running] (task p1) fix login flow paths=src/auth',
      '- job_b2 [queued] (explore p3) research renderers',
    ].join('\n');
    const cards = parseJobLedgerCards(out);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: 'job_a1',
      status: 'running',
      kind: 'task',
      priority: 1,
      title: 'fix login flow',
    });
    expect(cards[1]).toMatchObject({
      id: 'job_b2',
      status: 'queued',
      kind: 'explore',
      priority: 3,
    });
  });

  it('captures maxConcurrent from pool output', () => {
    const snap = parseJobStripFromToolOutput(
      'Jobs: 1▸ 2… inbox 0\npool: warm=2 maxConcurrent=4',
    );
    expect(snap?.maxConcurrent).toBe(4);
  });

  it('upsert replaces a card by id and trims terminal cards first', () => {
    const card = (id: string, status: ConductorJobCard['status']): ConductorJobCard => ({
      id,
      title: id,
      status,
      kind: 'task',
      priority: 1,
      updatedAtMs: 1,
    });
    let cards: readonly ConductorJobCard[] = [];
    for (let i = 0; i < JOB_BOARD_MAX_CARDS; i += 1) {
      cards = upsertConductorJobCard(
        cards,
        { id: `job_${String(i)}`, title: `job ${String(i)}`, status: 'done', kind: 'task', priority: 1 },
        undefined,
        i,
      );
    }
    expect(cards).toHaveLength(JOB_BOARD_MAX_CARDS);
    // Upserting a running job drops the oldest terminal card, not a running one.
    cards = upsertConductorJobCard(
      cards,
      { id: 'job_live', title: 'live', status: 'running', kind: 'task', priority: 2 },
      undefined,
      999,
    );
    expect(cards).toHaveLength(JOB_BOARD_MAX_CARDS);
    expect(cards.some((c) => c.id === 'job_live')).toBe(true);
    expect(cards.some((c) => c.id === 'job_0')).toBe(false);
    // Same id replaces in place instead of growing.
    cards = upsertConductorJobCard(
      cards,
      { id: 'job_live', title: 'live', status: 'done', kind: 'task', priority: 2 },
      { previousStatus: 'running' },
      1000,
    );
    expect(cards.filter((c) => c.id === 'job_live')).toHaveLength(1);
    expect(cards.find((c) => c.id === 'job_live')?.previousStatus).toBe('running');
  });

  it('caps inbox entries at JOB_BOARD_MAX_INBOX', () => {
    let inbox: ReturnType<typeof appendJobInboxEntry> = [];
    for (let i = 0; i < JOB_BOARD_MAX_INBOX + 3; i += 1) {
      inbox = appendJobInboxEntry(
        inbox,
        {
          type: 'job.inbox',
          schemaVersion: 1,
          eventId: `evt_${String(i)}`,
          kind: 'job.completed',
          jobId: `job_${String(i)}`,
          status: 'done',
          title: `job ${String(i)}`,
        },
        i,
      );
    }
    expect(inbox).toHaveLength(JOB_BOARD_MAX_INBOX);
    expect(inbox[inbox.length - 1]?.eventId).toBe(`evt_${String(JOB_BOARD_MAX_INBOX + 2)}`);
  });
});
