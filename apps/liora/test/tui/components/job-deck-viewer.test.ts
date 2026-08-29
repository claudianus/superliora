/**
 * Job Deck viewer — interactive Conductor mission monitor (list + transcript).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  formatTokenCount,
  JobDeckViewerComponent,
  shortAgentId,
} from '#/tui/components/dialogs/job-deck/job-deck-viewer';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';
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
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

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
    expect(joined).toContain('Session outcomes');
    expect(joined).toContain('workers');
    expect(joined).toContain('need you');
    expect(joined).toContain('pool 1/4');
    expect(joined).toContain('migrate the billing');
    expect(joined).toContain('running tests');
    expect(joined).toContain('worker01');
  });

  it('keeps a single PREMIUM hint line and primary Search: label', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const snap = snapshotOf([
      card('job_a1b2c3d4', 'migrate the billing service', 'running'),
      card('job_b2c3d4e5', 'answer needed for rollout', 'needs_user'),
    ]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    const idleLines = viewer.render(120).map(stripAnsi);
    const hintLines = idleLines.filter(
      (line) => line.includes('navigate') || line.includes('merge'),
    );
    expect(hintLines).toHaveLength(1);
    expect(hintLines[0]).toContain('↑↓ navigate');
    expect(hintLines[0]).toContain('M merge');
    expect(hintLines[0]).toContain('Esc cancel');
    expect(idleLines.filter((line) => /▸\s*막힘/.test(line))).toEqual([]);
    expect(idleLines.some((line) => line.includes('막힘 (') && !line.includes('▸'))).toBe(true);

    for (const ch of 'bill') viewer.handleInput(ch);
    const searching = viewer.render(120);
    const joined = searching.map(stripAnsi).join('\n');
    expect(joined).toContain('Search: bill');
    expect(searching.join('\n')).toContain(currentTheme.fg('primary', ' Search: '));
    expect(joined).toContain('migrate the billing');
    expect(joined).not.toContain('answer needed');
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
    expect(joined).toMatch(/cache \d+%/);
    expect(joined).toMatch(/kickoff|Bash|result|Loading worker/);
  });

  it('shows a per-worker cache hit chip on rows with usage', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const snap = snapshotOf([
      card('job_a1b2c3d4', 'warm worker', 'running', {
        usage: { input: 1200, output: 400, cacheRead: 98_000 },
      }),
    ]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    const joined = viewer.render(120).map(stripAnsi).join('\n');
    // cacheRead 98k of 99.2k input → 99% — meets the cache target chip.
    expect(joined).toContain('cache 99%');
    expect(joined).toContain('warm worker');
  });

  it('keeps rows cache-free when no usage has been observed', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const snap = snapshotOf([card('job_a1b2c3d4', 'cold worker', 'running')]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    const joined = viewer.render(120).map(stripAnsi).join('\n');
    expect(joined).toContain('cold worker');
    expect(joined).not.toContain('cache ');
  });

  it('Esc from the list invokes onCancel', () => {
    const onCancel = vi.fn();
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snapshotOf([card('job_a1b2c3d4', 'work', 'queued')]),
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel,
    });
    viewer.handleInput('\u001B');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders an empty-state coach when the ledger has no jobs', () => {
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snapshotOf([]),
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });
    const joined = viewer.render(100).map(stripAnsi).join('\n');
    expect(joined).toContain('No jobs yet');
    expect(joined).toContain('Type a task in chat');
    expect(joined).toContain('Alt+J');
  });

  it('keeps a full transcript buffer with top, tail, and Home/End navigation', async () => {
    const snap = snapshotOf([
      card('job_a1b2c3d4', 'long worker', 'running', {
        workerAgentId: 'agent_w1',
      }),
    ]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({
        lines: Array.from({ length: 40 }, (_, index) => `line ${String(index)}`),
      }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });

    viewer.handleInput('\r');
    await vi.waitFor(() => {
      expect(viewer.render(100).join('\n')).toContain('line 39');
    });

    expect(viewer.render(100).join('\n')).not.toContain('line 0');
    viewer.handleInput('g');
    expect(viewer.render(100).join('\n')).toContain('line 0');
    viewer.handleInput('\u001B[F');
    expect(viewer.render(100).join('\n')).toContain('line 39');
    viewer.handleInput('\u001B[H');
    expect(viewer.render(100).join('\n')).toContain('line 0');
    viewer.handleInput('F');
    expect(viewer.render(100).join('\n')).toContain('line 39');
  });

  it('paints a live truncated stdout tail on the running job row', () => {
    const snap = snapshotOf([
      card('job_a1b2c3d4', 'migrate the billing service', 'running', {
        workerAgentId: 'agent_worker01',
        liveActivity: {
          toolCallId: 'tc-1',
          name: 'Bash',
          status: 'running',
          atMs: 1,
          preview: '12 passing',
          previewKind: 'stdout',
        },
      }),
      card('job_b2c3d4e5', 'queued sibling', 'queued'),
    ]);
    const viewer = new JobDeckViewerComponent({
      getSnapshot: () => snap,
      loadWorker: async () => ({ lines: [] }),
      onAction: vi.fn(),
      onCancel: vi.fn(),
    });
    const joined = viewer.render(100).map(stripAnsi).join('\n');
    expect(joined).toContain('12 passing');
    expect(joined).toContain('migrate the billing');
  });
});
