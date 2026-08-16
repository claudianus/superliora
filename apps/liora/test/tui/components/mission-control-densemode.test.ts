import { describe, expect, it } from 'vitest';

import {
  buildDenseContent,
  clampWorkerScrollOffset,
  compactElapsed,
  DENSE_WORKER_CAP,
  denseWorkerSlots,
  formatRateSparkline,
  resolveDenseOps,
  selectAttentionJobs,
  shortModelAlias,
  shouldUseDensemode,
  workerRosterLabel,
} from '#/tui/components/panes/mission-control/densemode';
import type { MissionWorker } from '#/tui/controllers/mission-control/registry';
import type { AppearancePreferences } from '#/tui/config';
import {
  emptyConductorJobsSnapshot,
  type ConductorJobCard,
} from '#/tui/utils/job/job-strip';

function worker(id: string, spawnedAtMs = 0, over: Partial<MissionWorker> = {}): MissionWorker {
  return {
    id,
    name: id,
    kind: 'subagent',
    status: 'running',
    runInBackground: false,
    toolCount: 0,
    tokens: 0,
    elapsedMs: 0,
    spawnedAtMs,
    lastActivityAtMs: 0,
    ...over,
  };
}

const OFF_APPEARANCE = { profile: 'off' } as AppearancePreferences;

function jobCard(over: Partial<ConductorJobCard>): ConductorJobCard {
  return {
    id: 'job_abcdef123456',
    title: 'Ship dock',
    status: 'running',
    kind: 'task',
    priority: 1,
    updatedAtMs: 1_000,
    ...over,
  };
}

describe('mission-control densemode helpers', () => {
  it('enables densemode for a single visible worker', () => {
    expect(shouldUseDensemode([])).toBe(false);
    expect(shouldUseDensemode([worker('a')])).toBe(true);
    expect(shouldUseDensemode([worker('a'), worker('b')])).toBe(true);
  });

  it('synthesizes ops from lastTool when the ring is empty', () => {
    const synth = resolveDenseOps([], [
      worker('coder', 0, { lastTool: 'Bash', lastTarget: 'deploy.sh', lastActivityAtMs: 500 }),
    ]);
    expect(synth).toHaveLength(1);
    expect(synth[0]?.name).toBe('Bash');
    expect(synth[0]?.target).toBe('deploy.sh');
    expect(synth[0]?.status).toBe('running');
  });

  it('ranks BOARD attention with interrupted and failed, skips empty titles', () => {
    const jobs = {
      ...emptyConductorJobsSnapshot(),
      total: 4,
      running: 1,
      interrupted: 1,
      failed: 1,
      jobs: [
        jobCard({ id: 'job_run00000001', status: 'running', title: 'Active', updatedAtMs: 10 }),
        jobCard({
          id: 'job_int00000002',
          status: 'interrupted',
          title: 'Paused deploy',
          updatedAtMs: 20,
        }),
        jobCard({ id: 'job_fail0000003', status: 'failed', title: 'Bad land', updatedAtMs: 30 }),
        jobCard({ id: 'job_empty000004', status: 'running', title: '   ', updatedAtMs: 40 }),
      ],
    };
    const attention = selectAttentionJobs(jobs, 4);
    expect(attention.map((card) => card.id)).toEqual([
      'job_int00000002',
      'job_run00000001',
      'job_fail0000003',
    ]);
  });

  it('keeps one interrupted attention row in densemode during recovery', () => {
    const result = buildDenseContent({
      workers: [worker('solo', 0, { lastTool: 'Read', lastTarget: 'a.ts', toolCount: 3 })],
      width: 100,
      budget: 14,
      now: 1_000,
      workDir: undefined,
      animated: false,
      appearance: OFF_APPEARANCE,
      revealedLive: new Map(),
      displayRate: new Map(),
      workerGlyph: () => '◆',
      jobs: {
        ...emptyConductorJobsSnapshot(),
        total: 1,
        interrupted: 1,
        jobs: [
          jobCard({
            id: 'job_int00000002',
            status: 'interrupted',
            title: 'Paused deploy',
            updatedAtMs: 20,
          }),
        ],
      },
    });
    const text = result.lines.join('\n');
    expect(text).toContain('WORKERS');
    expect(text).toContain('Paused deploy');
    expect(text).not.toContain('BOARD');
  });

  it('keeps a live BOARD attention strip under densemode without TAPE section', () => {
    const result = buildDenseContent({
      workers: [worker('solo', 0, { lastTool: 'Read', lastTarget: 'a.ts', toolCount: 3 })],
      ops: [
        {
          toolCallId: 'tc-1',
          workerId: 'solo',
          workerName: 'solo',
          name: 'Read',
          target: 'a.ts',
          status: 'ok',
          atMs: 900,
        },
      ],
      width: 100,
      budget: 14,
      now: 1_000,
      workDir: undefined,
      animated: false,
      appearance: OFF_APPEARANCE,
      revealedLive: new Map(),
      displayRate: new Map(),
      workerGlyph: () => '◆',
      jobs: {
        ...emptyConductorJobsSnapshot(),
        total: 2,
        running: 1,
        failed: 1,
        jobs: [
          jobCard({ id: 'job_run00000001', status: 'running', title: 'Deploy pages' }),
          jobCard({ id: 'job_fail0000002', status: 'failed', title: 'Old attempt' }),
        ],
      },
    });
    const text = result.lines.join('\n');
    expect(text).toContain('WORKERS');
    expect(text).toContain('solo');
    // Thin attention rows (no BOARD section header); status glyph not SELECT_POINTER.
    expect(text).toContain('Deploy pages');
    expect(text).toContain('Old attempt');
    expect(text).not.toContain('BOARD');
    expect(text).not.toContain('TAPE');
    expect(text).not.toContain('❯');
  });

  it('paints role · job title and counts needs-you without blocked lands', () => {
    expect(
      workerRosterLabel(worker('explore', 0, { name: 'explore', description: 'Pin TUI flicker' }), {
        ...emptyConductorJobsSnapshot(),
        jobs: [
          jobCard({
            workerAgentId: 'explore',
            title: 'Pin TUI flicker on Windows',
          }),
        ],
      }),
    ).toBe('explore · Pin TUI flicker on Windows');

    const result = buildDenseContent({
      workers: [worker('coder', 0, { name: 'coder', description: 'Harden landJobToMain' })],
      width: 120,
      budget: 10,
      now: 1_000,
      workDir: undefined,
      animated: false,
      appearance: OFF_APPEARANCE,
      revealedLive: new Map(),
      displayRate: new Map(),
      workerGlyph: () => '◆',
      jobs: {
        ...emptyConductorJobsSnapshot(),
        total: 18,
        needsUser: 1,
        blocked: 17,
        jobs: [
          jobCard({
            id: 'job_ask00000001',
            status: 'needs_user',
            title: 'Pick a model',
            workerAgentId: 'coder',
          }),
          jobCard({ id: 'job_blk00000002', status: 'blocked', title: 'Stale land' }),
        ],
      },
    });
    const text = result.lines.join('\n');
    expect(text).toContain('WORKERS');
    expect(text).toContain('needs-you 1');
    expect(text).not.toContain('needs-you 18');
    expect(text).toContain('coder · Pick a model');
  });

  it('gives freed tape/board budget to worker slots up to the cap', () => {
    expect(denseWorkerSlots(12, 12)).toBe(DENSE_WORKER_CAP);
    expect(DENSE_WORKER_CAP).toBeGreaterThanOrEqual(8);
    expect(denseWorkerSlots(3, 12)).toBe(3);
  });

  it('renders a sparkline from rate samples', () => {
    expect(formatRateSparkline(undefined, 3)).toBe('···');
    expect(formatRateSparkline([10, 50, 100], 3).length).toBe(3);
    expect(formatRateSparkline([1, 1, 1], 3)).toMatch(/^[▁▂▃▄▅▆▇█·]+$/u);
  });

  it('compacts model aliases and elapsed clocks', () => {
    expect(shortModelAlias('kimi-k2.5')).toBe('kimi-k2…');
    expect(shortModelAlias('gpt')).toBe('gpt');
    expect(compactElapsed(5_000)).toBe('05s');
    expect(compactElapsed(125_000)).toBe('2m05');
  });

  it('windows the worker roster and reports overflow with a scroll hint', () => {
    const workers = Array.from({ length: 12 }, (_, i) => worker(`w${String(i)}`, i));
    const base = {
      workers,
      ops: [],
      width: 100,
      budget: 14,
      now: 1_000,
      workDir: undefined,
      animated: false,
      appearance: OFF_APPEARANCE,
      revealedLive: new Map<string, string>(),
      displayRate: new Map<string, number>(),
      workerGlyph: () => '◆',
    };
    const page0 = buildDenseContent({ ...base, scrollOffset: 0 });
    const joined0 = page0.lines.join('\n');
    expect(joined0).toContain('w0');
    expect(page0.workerSlots).toBe(DENSE_WORKER_CAP);
    expect(joined0).toMatch(new RegExp(`\\+${String(12 - DENSE_WORKER_CAP)} more \\(↑↓\\)`));
    expect(joined0).not.toContain(`w${String(DENSE_WORKER_CAP)}`);
    expect(page0.scrollOffset).toBe(0);

    const page1 = buildDenseContent({ ...base, scrollOffset: 2 });
    const joined1 = page1.lines.join('\n');
    expect(joined1).toContain('w2');
    expect(joined1).toContain(`w${String(DENSE_WORKER_CAP + 1)}`);
    expect(joined1).not.toContain('w0');
    expect(page1.scrollOffset).toBe(2);
    expect(clampWorkerScrollOffset(99, 12, DENSE_WORKER_CAP)).toBe(12 - DENSE_WORKER_CAP);
  });
});
