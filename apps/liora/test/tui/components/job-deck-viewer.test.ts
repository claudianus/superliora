/**
 * Job Deck viewer — interactive Conductor mission monitor (list + transcript).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  formatTokenCount,
  JobDeckViewerComponent,
  shortAgentId,
} from '#/tui/components/dialogs/job-deck/job-deck-viewer';
import type { ConductorJobCard, ConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function card(
  id: string,
  title: string,
  status: ConductorJobCard['status'],
  extras: Partial<ConductorJobCard> = {},
): ConductorJobCard {
  return {
    id,
    title,
    status,
    kind: 'task',
    priority: 1,
    updatedAtMs: 0,
    ...extras,
  };
}

function snapshotOf(cards: readonly ConductorJobCard[]): ConductorJobsSnapshot {
  const count = (status: ConductorJobCard['status']) =>
    cards.filter((entry) => entry.status === status).length;
  return {
    total: cards.length,
    queued: count('queued'),
    running: count('running'),
    blocked: count('blocked'),
    needsUser: count('needs_user'),
    interrupted: count('interrupted'),
    failed: count('failed'),
    unreadInbox: 0,
    jobs: cards,
    inbox: [],
    maxConcurrent: 4,
  };
}

describe('formatTokenCount / shortAgentId', () => {
  it('formats dense token counts', () => {
    expect(formatTokenCount(42)).toBe('42');
    expect(formatTokenCount(12_482)).toBe('12.5k');
    expect(formatTokenCount(2_500_000)).toBe('2.50M');
  });

  it('shortens worker agent ids', () => {
    expect(shortAgentId('agent_abcd1234')).toBe('abcd1234');
    expect(shortAgentId('agent_toolongvalue')).toBe('toolongv');
    expect(shortAgentId('xyz')).toBe('xyz');
  });
});

describe('JobDeckViewerComponent', () => {
  it('renders the mission strip and searchable job rows', () => {
    const snap = snapshotOf([
      card('job_a1b2c3d4', 'migrate the billing service', 'running', {
        workerAgentId: 'agent_worker01',
        createdAtMs: Date.now() - 90_000,
        progress: { phase: 'running tests', recentTools: ['Bash', 'Read'] },
      }),
      card('job_b2c3d4e5', 'answer needed for rollout', 'needs_user', { priority: 3 }),
    ]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    const joined = viewer.render(100).map(stripAnsi).join('\n');
    expect(joined).toContain('Conductor Job Deck');
    expect(joined).toContain('Mission Monitor');
    expect(joined).toContain('workers');
    expect(joined).toContain('need you');
    expect(joined).toContain('pool 1/4');
    expect(joined).toContain('migrate the billing');
    expect(joined).toContain('running tests');
    expect(joined).toContain('worker01');
  });

  it('drills into a worker transcript on Enter when a worker exists', async () => {
    const running = card('job_a1b2c3d4', 'live worker', 'running', {
      workerAgentId: 'agent_w1',
    });
    const snap = snapshotOf([running]);
    const loadWorker = vi.fn(async () => ({
      lines: ['◇ kickoff', '⚙ Bash pnpm test', '✓ result'],
      usage: { input: 1200, output: 400, cacheRead: 8000 },
    }));
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker,
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    viewer.handleInput('\r'); // Enter — SearchableList / Key.enter often arrives as \r
    // Allow the async fetch to settle.
    await vi.waitFor(() => {
      expect(loadWorker).toHaveBeenCalled();
    });
    const joined = viewer.render(100).map(stripAnsi).join('\n');
    expect(joined).toContain('tokens');
    expect(joined).toContain('1.2k in');
    expect(joined).toMatch(/kickoff|Bash|result|Loading worker/);
  });

  it('Esc from the list invokes onCancel', () => {
    const onCancel = vi.fn();
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snapshotOf([card('job_a1b2c3d4', 'work', 'queued')]),
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel,
    });
    viewer.handleInput('\u001b');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
