import { describe, expect, it } from 'vitest';

import {
  appendJobInboxEntry,
  emptyConductorJobsSnapshot,
  formatJobDuration,
  JOB_BOARD_MAX_CARDS,
  JOB_BOARD_MAX_INBOX,
  jobElapsedMs,
  longestActiveJobElapsedMs,
  mergeConductorJobsSnapshot,
  parseIsoMs,
  parseJobLedgerCards,
  parseJobStripFromToolOutput,
  patchConductorJobProgressByWorker,
  patchConductorJobUsage,
  resolveConductorJobCard,
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

  it('formats compact durations across scales', () => {
    expect(formatJobDuration(500)).toBe('0s');
    expect(formatJobDuration(42_000)).toBe('42s');
    expect(formatJobDuration(3 * 60_000 + 12_000)).toBe('3m 12s');
    expect(formatJobDuration(65 * 60_000)).toBe('1h 05m');
    expect(formatJobDuration(51 * 3_600_000)).toBe('2d 3h');
  });

  it('computes elapsed time — live cards track now, terminal cards freeze', () => {
    const created = '2026-01-01T00:00:00.000Z';
    const createdMs = parseIsoMs(created) as number;
    const running: ConductorJobCard = {
      id: 'job_run',
      title: 'run',
      status: 'running',
      kind: 'task',
      priority: 1,
      createdAtMs: createdMs,
      updatedAtMs: createdMs + 10_000,
    };
    expect(jobElapsedMs(running, createdMs + 60_000)).toBe(60_000);
    const done: ConductorJobCard = { ...running, id: 'job_done', status: 'done' };
    // Terminal cards freeze at updatedAt, not the query clock.
    expect(jobElapsedMs(done, createdMs + 60_000)).toBe(10_000);
    expect(jobElapsedMs({ ...running, createdAtMs: undefined }, createdMs)).toBeUndefined();
  });

  it('longestActiveJobElapsedMs skips terminal cards', () => {
    const base = parseIsoMs('2026-01-01T00:00:00.000Z') as number;
    const cards: ConductorJobCard[] = [
      { id: 'a', title: 'a', status: 'running', kind: 'task', priority: 1, createdAtMs: base, updatedAtMs: base },
      { id: 'b', title: 'b', status: 'queued', kind: 'task', priority: 1, createdAtMs: base + 30_000, updatedAtMs: base },
      { id: 'c', title: 'c', status: 'done', kind: 'task', priority: 1, createdAtMs: base - 999_000, updatedAtMs: base },
    ];
    expect(longestActiveJobElapsedMs(cards, base + 45_000)).toBe(45_000);
    expect(longestActiveJobElapsedMs([], base)).toBeUndefined();
  });

  it('resolveConductorJobCard accepts full, short, and unique prefix ids', () => {
    const cards: ConductorJobCard[] = [
      { id: 'job_a1b2c3d4ef00', title: 'a', status: 'running', kind: 'task', priority: 1, updatedAtMs: 0 },
      { id: 'job_b2c3d4e5ff11', title: 'b', status: 'queued', kind: 'task', priority: 1, updatedAtMs: 0 },
    ];
    expect(resolveConductorJobCard(cards, 'job_a1b2c3d4ef00')?.id).toBe('job_a1b2c3d4ef00');
    expect(resolveConductorJobCard(cards, 'a1b2c3d4')?.id).toBe('job_a1b2c3d4ef00');
    expect(resolveConductorJobCard(cards, 'b2c3')?.id).toBe('job_b2c3d4e5ff11');
    expect(resolveConductorJobCard(cards, 'nope')).toBeUndefined();
    expect(resolveConductorJobCard(cards, '')).toBeUndefined();
  });

  it('patchConductorJobUsage updates one card and preserves others', () => {
    const cards: ConductorJobCard[] = [
      { id: 'job_a', title: 'a', status: 'running', kind: 'task', priority: 1, updatedAtMs: 0 },
      { id: 'job_b', title: 'b', status: 'queued', kind: 'task', priority: 1, updatedAtMs: 0 },
    ];
    const next = patchConductorJobUsage(cards, 'job_a', { input: 10, output: 20, cacheRead: 30 });
    expect(next?.[0]?.usage).toEqual({ input: 10, output: 20, cacheRead: 30 });
    expect(next?.[1]?.usage).toBeUndefined();
    expect(patchConductorJobUsage(cards, 'missing', { input: 1, output: 0, cacheRead: 0 })).toBeUndefined();
  });

  it('patchConductorJobProgressByWorker accepts a known index for O(1) join', () => {
    const cards: ConductorJobCard[] = [
      {
        id: 'job_a',
        title: 'a',
        status: 'running',
        kind: 'task',
        priority: 1,
        updatedAtMs: 0,
        workerAgentId: 'agent_a',
      },
      {
        id: 'job_b',
        title: 'b',
        status: 'running',
        kind: 'task',
        priority: 1,
        updatedAtMs: 0,
        workerAgentId: 'agent_b',
      },
    ];
    const next = patchConductorJobProgressByWorker(
      cards,
      'agent_b',
      { lastTool: 'Bash', toolCount: 3, tokens: 50, atMs: 1_000 },
      1,
    );
    expect(next?.[1]?.progress?.recentTools).toEqual(['Bash']);
    expect(next?.[1]?.liveTokens).toBe(50);
    // Wrong known index falls back to scan.
    const fallback = patchConductorJobProgressByWorker(
      cards,
      'agent_a',
      { lastTool: 'Read', toolCount: 1, atMs: 2_000 },
      99,
    );
    expect(fallback?.[0]?.progress?.recentTools).toEqual(['Read']);
  });

  it('upsert preserves createdAtMs and stamps statusChangedAtMs on lane moves', () => {
    const created = '2026-01-01T00:00:00.000Z';
    let cards = upsertConductorJobCard(
      [],
      {
        id: 'job_x',
        title: 'work',
        status: 'queued',
        kind: 'task',
        priority: 1,
        createdAt: created,
        updatedAt: created,
      },
      undefined,
      100,
    );
    expect(cards[0]?.createdAtMs).toBe(parseIsoMs(created));
    expect(cards[0]?.statusChangedAtMs).toBe(100);
    // Follow-up event without createdAt keeps the original ledger birth time.
    cards = upsertConductorJobCard(
      cards,
      { id: 'job_x', title: 'work', status: 'running', kind: 'task', priority: 1 },
      { previousStatus: 'queued' },
      500,
    );
    expect(cards[0]?.createdAtMs).toBe(parseIsoMs(created));
    expect(cards[0]?.statusChangedAtMs).toBe(500);
    expect(cards[0]?.previousStatus).toBe('queued');
  });
});
