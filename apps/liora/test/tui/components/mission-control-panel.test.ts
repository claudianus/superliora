import { afterEach, describe, expect, it } from 'vitest';

import type { Event } from '@superliora/sdk';

import {
  MISSION_FALLBACK_MAX_ROWS,
  MissionControlPanelComponent,
  emptyMissionControlView,
  formatMissionAgeMs,
  formatMissionTokenRate,
  type MissionControlView,
} from '#/tui/components/panes/mission-control/panel';
import { MissionControlRegistry } from '#/tui/controllers/mission-control/registry';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import {
  clearHoverRegion,
  missionWorkerHoverId,
  setHoverRegion,
} from '#/tui/features/mission-control/worker-hover';
import { HOVER_ROW_PAD } from '#/tui/features/mission-control/worker-row-paint';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  emptyConductorJobsSnapshot,
  type ConductorJobCard,
} from '#/tui/utils/job/job-strip';
import type { MissionWorker } from '#/tui/controllers/mission-control/registry';

// Motion is forced off under the CI-parity runner (NO_COLOR), so renders take
// the static branch; strip ANSI to assert on plain text.
function strip(text: string): string {
  return text.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

function plain(lines: string[]): string[] {
  return lines.map((line) => strip(line).trimEnd());
}

const NOW = 1_700_000_000_000;

function registryWith(events: Event[]): MissionControlRegistry {
  let now = NOW;
  const registry = new MissionControlRegistry(() => now);
  for (const event of events) {
    registry.apply(event);
    now += 1_000;
  }
  return registry;
}

function viewFor(
  registry: MissionControlRegistry,
  jobs = emptyConductorJobsSnapshot(),
  workDir?: string,
): MissionControlView {
  return {
    snapshot: registry.snapshot(NOW + 100_000),
    jobs,
    ...(workDir === undefined ? {} : { workDir }),
  };
}

function jobCard(over: Partial<ConductorJobCard>): ConductorJobCard {
  return {
    id: 'job_abcdef123456',
    title: '?? ??? ??',
    status: 'running',
    kind: 'task',
    priority: 1,
    updatedAtMs: NOW,
    ...over,
  };
}

describe('MissionControlPanelComponent', () => {
  afterEach(() => {
    clearHoverRegion();
  });

  it('formats live token rates for the dock chrome', () => {
    expect(formatMissionTokenRate(0)).toBe('');
    expect(formatMissionTokenRate(840)).toBe('840/s');
    expect(formatMissionTokenRate(12_400)).toBe('12.4k/s');
  });

  it('renders nothing while the view is empty', () => {
    const panel = new MissionControlPanelComponent();
    panel.setView(emptyMissionControlView());
    expect(panel.isEmpty()).toBe(true);
    expect(panel.render(80)).toEqual([]);
  });

  it('renders intent-first worker rows with humanized action', () => {
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-1',
        subagentName: 'explore-2',
        parentToolCallId: 'ptc',
        runInBackground: false,
        modelAlias: 'gpt-5',
        description: 'Map the Mission Control dock',
      } as Event,
      {
        type: 'subagent.progress',
        subagentId: 'sa-1',
        lastTool: 'Read',
        lastTarget: 'src/tui/panel.ts',
        toolCount: 12,
        elapsedMs: 84_000,
        tokens: 8_100,
      } as Event,
      {
        type: 'subagent.todo.updated',
        subagentId: 'sa-1',
        subagentName: 'explore-2',
        parentToolCallId: 'ptc',
        todos: [
          { title: 'a', status: 'done' },
          { title: 'Ship human-first dock', status: 'in_progress' },
        ],
      } as unknown as Event,
    ]);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));

    const lines = plain(panel.render(100));
    const text = lines.join('\n');
    expect(text).toContain('Worker Dock');
    expect(text).toMatch(/1 worker/);
    expect(text).toContain('FLEET');
    expect(text).toMatch(/WKR/);
    expect(text).toContain('explore');
    expect(text).toContain('gpt-5');
    // Focus todo lands in the LIVE cell when stream is cold.
    expect(text).toContain('Ship human-first dock');
    expect(text).toContain('Read');
    expect(text).toContain('panel.ts');
    expect(text).toMatch(/1\/2/);
    // Absolute-path spam must not dominate.
    expect(text).not.toContain('/Users/');
  });

  it('formats relative ages for MOVES rows', () => {
    expect(formatMissionAgeMs(1_000, 1_000)).toBe('now');
    expect(formatMissionAgeMs(1_000, 4_000)).toBe('3s ago');
    expect(formatMissionAgeMs(1_000, 61_000)).toBe('1m ago');
    expect(formatMissionAgeMs(1_000, 3_661_000)).toBe('1h ago');
  });

  it('renders MOVES with relative age and error marks', () => {
    const clock = appearanceAnimationNow();
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers: [
          {
            id: 'sa-1',
            name: 'builder-1',
            kind: 'subagent',
            status: 'running',
            runInBackground: false,
            toolCount: 1,
            tokens: 0,
            elapsedMs: 5_000,
            spawnedAtMs: clock,
            lastActivityAtMs: clock,
          },
        ],
        activeCount: 1,
        totalTokens: 0,
        ops: [
          {
            toolCallId: 'tc-1',
            workerId: 'sa-1',
            workerName: 'builder-1',
            name: 'Edit',
            target: 'src/a.ts',
            chip: '+42 -10',
            status: 'error',
            atMs: clock - 3_000,
            settledAtMs: clock - 2_000,
          },
        ],
      },
      jobs: emptyConductorJobsSnapshot(),
    });

    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('TAPE');
    expect(text).toContain('3s ago');
    // Single-worker feed omits the worker name column.
    expect(text).not.toMatch(/builder-1.*Edit/);
    expect(text).toContain('\u2717 Edit src/a.ts');
  });

  it('collapses consecutive cd-only bash noise in MOVES', () => {
    const longCd =
      'cd /Users/modumaru/.superliora/worktrees/16-4a12d7da/conductor-jmsiq/repo';
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-1',
        subagentName: 'coder',
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event,
      {
        type: 'subagent.tool_call',
        subagentId: 'sa-1',
        toolCallId: 'tc-1',
        name: 'Bash',
        detail: { kind: 'bash', command: longCd },
      } as Event,
      {
        type: 'subagent.tool_result',
        subagentId: 'sa-1',
        toolCallId: 'tc-1',
      } as Event,
      {
        type: 'subagent.tool_call',
        subagentId: 'sa-1',
        toolCallId: 'tc-2',
        name: 'Bash',
        detail: { kind: 'bash', command: `${longCd}-b` },
      } as Event,
      {
        type: 'subagent.tool_result',
        subagentId: 'sa-1',
        toolCallId: 'tc-2',
      } as Event,
    ]);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('TAPE');
    expect(text).toContain('enter');
    expect(text).not.toContain('/Users/modumaru/.superliora/worktrees');
    // Two consecutive cd ops collapse to one visible TAPE row.
    const tapeIdx = text.indexOf('TAPE');
    const tapeSection = tapeIdx >= 0 ? text.slice(tapeIdx) : '';
    const boardIdx = tapeSection.indexOf('BOARD');
    const tapeOnly = boardIdx >= 0 ? tapeSection.slice(0, boardIdx) : tapeSection;
    expect(tapeOnly.split('enter').length - 1).toBe(1);
  });

  it('renders condensed BOARD lanes with attention rows first', () => {
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-1',
        subagentName: 'builder-1',
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event,
    ]);
    const jobs = {
      ...emptyConductorJobsSnapshot(),
      total: 4,
      running: 1,
      needsUser: 1,
      interrupted: 1,
      failed: 1,
      jobs: [
        jobCard({
          id: 'job_run00000001',
          status: 'running',
          title: 'Running card',
          workerName: 'builder-1',
          updatedAtMs: NOW,
        }),
        jobCard({
          id: 'job_need00000002',
          status: 'needs_user',
          title: 'Need answer',
          updatedAtMs: NOW + 1,
        }),
        jobCard({
          id: 'job_int00000003',
          status: 'interrupted',
          title: 'Paused deploy',
          updatedAtMs: NOW + 2,
        }),
        jobCard({
          id: 'job_fail0000004',
          status: 'failed',
          title: 'Land failed',
          updatedAtMs: NOW + 3,
        }),
      ],
    };
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry, jobs));

    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('BOARD');
    expect(text).toContain('needs-you 1');
    expect(text).toContain('running 1');
    expect(text).toContain('interrupted 1');
    expect(text).toContain('failed 1');
    // Densemode paints one attention card; needs_user outranks the rest.
    expect(text).toContain('Need answer');
    expect(text).not.toContain('Land failed');
  });

  it('skips BOARD attention cards with empty titles', () => {
    const clock = appearanceAnimationNow();
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers: [
          {
            id: 'sa-1',
            name: 'coder',
            kind: 'subagent',
            status: 'running',
            runInBackground: false,
            toolCount: 1,
            tokens: 10,
            elapsedMs: 1_000,
            spawnedAtMs: clock,
            lastActivityAtMs: clock,
          },
        ],
        activeCount: 1,
        totalTokens: 10,
        ops: [],
      },
      jobs: {
        ...emptyConductorJobsSnapshot(),
        total: 1,
        running: 1,
        jobs: [jobCard({ id: 'job_empty000001', status: 'running', title: '   ' })],
      },
    });
    const text = plain(panel.render(80)).join('\n');
    expect(text).toContain('BOARD');
    expect(text).toContain('running 1');
    expect(text).not.toMatch(/❯\s*$/m);
  });

  it('degrades density to fit a small row budget', () => {
    const events: Event[] = [];
    for (let i = 0; i < 6; i += 1) {
      events.push({
        type: 'subagent.spawned',
        subagentId: `sa-${String(i)}`,
        subagentName: `worker-${String(i)}`,
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event);
      events.push({
        type: 'subagent.tool_call',
        subagentId: `sa-${String(i)}`,
        toolCallId: `tc-${String(i)}`,
        name: 'Read',
        detail: { kind: 'read', path: `src/${String(i)}.ts` },
      } as Event);
    }
    const registry = registryWith(events);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));

    const tight = panel.renderFittedBand(48, 8);
    expect(tight).toHaveLength(8);
    // Overflow note keeps the hidden worker count visible.
    expect(plain(tight).join('\n')).toContain('more');
  });

  it('pads a fitted band render to the exact row budget', () => {
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-1',
        subagentName: 'solo',
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event,
    ]);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));
    const lines = panel.renderFittedBand(40, 30);
    expect(lines).toHaveLength(30);
  });

  it('caps the bottom band at the band row budget', () => {
    const events: Event[] = [];
    for (let i = 0; i < 10; i += 1) {
      events.push({
        type: 'subagent.spawned',
        subagentId: `sa-${String(i)}`,
        subagentName: `w${String(i)}`,
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event);
    }
    const registry = registryWith(events);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));
    expect(panel.render(80).length).toBeLessThanOrEqual(MISSION_FALLBACK_MAX_ROWS);
  });

  it('flags stalled workers with a warning row', () => {
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-9',
        subagentName: 'scout-9',
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event,
      {
        type: 'subagent.stalled',
        subagentId: 'sa-9',
        silentMs: 300_000,
        toolCount: 4,
      } as Event,
    ]);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('scout-9');
    expect(text).toContain('stall');
  });

  it('prefers a hot live stream strip over static intent in LIVE', () => {
    const clock = appearanceAnimationNow();
    const worker: MissionWorker = {
      id: 'sa-live',
      name: 'plan',
      kind: 'subagent',
      status: 'running',
      modelAlias: 'kimi-k2.5',
      description: 'Investigate Metal Slug mechanics',
      runInBackground: false,
      toolCount: 2,
      tokens: 1200,
      elapsedMs: 4_000,
      spawnedAtMs: clock,
      lastActivityAtMs: clock,
      liveKind: 'thinking',
      liveText: 'Considering Phaser platformer physics',
      liveAtMs: clock,
    };
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers: [worker],
        activeCount: 1,
        totalTokens: 1200,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('FLEET');
    // LIVE column is truncated under densemode width + fixed chrome gutter.
    expect(text).toMatch(/Considering Phaser platformer physi/);
    expect(text).toContain('\u25cc');
    // Hot stream replaces the static description/intent in LIVE.
    expect(text).not.toContain('Investigate Metal Slug mechanics');
  });

  it('switches to densemode KPI/TICKER/GRID when two workers are live', () => {
    const clock = appearanceAnimationNow();
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers: [
          {
            id: 'sa-plan',
            name: 'plan',
            kind: 'subagent',
            status: 'running',
            modelAlias: 'kimi-k2.5',
            runInBackground: false,
            toolCount: 8,
            tokens: 4200,
            tokenRatePerSec: 1000,
            rateSamples: [400, 700, 1000],
            elapsedMs: 240_000,
            spawnedAtMs: clock,
            lastActivityAtMs: clock,
            liveKind: 'thinking',
            liveText: 'Phaser Arcade Physics loop',
            liveAtMs: clock,
          },
          {
            id: 'sa-explore',
            name: 'explore-2',
            kind: 'subagent',
            status: 'running',
            modelAlias: 'gpt-5-mini',
            runInBackground: false,
            toolCount: 14,
            tokens: 8100,
            tokenRatePerSec: 640,
            rateSamples: [200, 500, 640],
            elapsedMs: 110_000,
            spawnedAtMs: clock + 1,
            lastActivityAtMs: clock,
            lastTool: 'Read',
            lastTarget: 'panel.ts',
          },
        ],
        activeCount: 2,
        totalTokens: 12300,
        ops: [
          {
            toolCallId: 'tc-1',
            workerId: 'sa-plan',
            workerName: 'plan',
            name: 'WebSearch',
            target: 'premium HTML',
            status: 'ok',
            atMs: clock - 12_000,
            settledAtMs: clock - 11_000,
          },
          {
            toolCallId: 'tc-2',
            workerId: 'sa-explore',
            workerName: 'explore-2',
            name: 'Grep',
            target: 'MISSION_BAND',
            status: 'running',
            atMs: clock - 400,
          },
        ],
      },
      jobs: emptyConductorJobsSnapshot(),
    });
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('Worker Dock');
    expect(text).toMatch(/\d+ workers?/);
    expect(text).toContain('TK');
    expect(text).toMatch(/WKR/);
    expect(text).toContain('TAPE');
    expect(text).toContain('plan');
    expect(text).toContain('explore');
    expect(text).toContain('Phaser Arcade Physics loop');
    // Solo NOW stack headers are skipped in densemode.
    expect(text).not.toContain('\nNOW\n');
  });

  it('uses densemode KPI/GRID for a single worker', () => {
    const clock = appearanceAnimationNow();
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers: [
          {
            id: 'sa-solo',
            name: 'solo',
            kind: 'subagent',
            status: 'running',
            runInBackground: false,
            toolCount: 2,
            tokens: 100,
            elapsedMs: 5_000,
            spawnedAtMs: clock,
            lastActivityAtMs: clock,
            description: 'Only one worker',
            liveKind: 'thinking',
            liveText: 'solo thought stream',
            liveAtMs: clock,
            lastTool: 'Bash',
            lastTarget: 'build.sh',
          },
        ],
        activeCount: 1,
        totalTokens: 100,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('Worker Dock');
    expect(text).toMatch(/1 worker/);
    expect(text).toContain('FLEET');
    expect(text).toMatch(/WKR/);
    expect(text).toContain('solo thought stream');
    expect(text).toContain('TAPE');
    expect(text).toContain('Bash');
    expect(text).not.toContain('\nNOW\n');
  });

  it('humanizes JSON WebSearch targets in TAPE', () => {
    const registry = registryWith([
      {
        type: 'subagent.spawned',
        subagentId: 'sa-1',
        subagentName: 'scout',
        parentToolCallId: 'ptc',
        runInBackground: false,
      } as Event,
      {
        type: 'subagent.tool_call',
        subagentId: 'sa-1',
        toolCallId: 'tc-1',
        name: 'WebSearch',
        argsPreview: '{"query":"premium HTML game engines","limit":5}',
      } as Event,
    ]);
    const panel = new MissionControlPanelComponent();
    panel.setView(viewFor(registry));
    const text = plain(panel.render(100)).join('\n');
    expect(text).toContain('TAPE');
    expect(text).toContain('WebSearch');
    expect(text).toContain('premium HTML');
    expect(text).not.toContain('"query"');
  });

  it('windows densemode workers via scrollWorkers and j/k', () => {
    const clock = appearanceAnimationNow();
    const workers: MissionWorker[] = Array.from({ length: 7 }, (_, i) => ({
      id: `sa-${String(i)}`,
      name: `w${String(i)}`,
      kind: 'subagent',
      status: 'running',
      runInBackground: false,
      toolCount: 1,
      tokens: 100,
      elapsedMs: 1_000,
      spawnedAtMs: clock + i,
      lastActivityAtMs: clock,
    }));
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers,
        activeCount: 7,
        totalTokens: 700,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });

    const page0 = plain(panel.render(100)).join('\n');
    expect(page0).toContain('w0');
    expect(page0).toMatch(/\+2 more \(↑↓\)/);
    expect(page0).not.toContain('w6');

    expect(panel.scrollWorkers('line-down')).toBe(true);
    expect(panel.scrollWorkers('line-down')).toBe(true);
    const page1 = plain(panel.render(100)).join('\n');
    expect(page1).toContain('w6');
    expect(page1).not.toContain('w0');

    panel.handleInput('k');
    const pageBack = plain(panel.render(100)).join('\n');
    expect(pageBack).toContain('w1');
    expect(panel.scrollWorkers('line-up')).toBe(true);
    expect(panel.scrollWorkers('line-up')).toBe(false);
  });

  it('selects workers with ↑↓ and opens via Enter; Esc clears selection', () => {
    const clock = appearanceAnimationNow();
    const workers: MissionWorker[] = [
      {
        id: 'sa-a',
        name: 'coder-a',
        kind: 'subagent',
        status: 'running',
        runInBackground: false,
        toolCount: 2,
        tokens: 100,
        elapsedMs: 2_000,
        spawnedAtMs: clock,
        lastActivityAtMs: clock,
      },
      {
        id: 'sa-b',
        name: 'coder-b',
        kind: 'subagent',
        status: 'running',
        runInBackground: false,
        toolCount: 1,
        tokens: 50,
        elapsedMs: 1_000,
        spawnedAtMs: clock + 1,
        lastActivityAtMs: clock,
      },
    ];
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers,
        activeCount: 2,
        totalTokens: 150,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });

    expect(panel.selectedWorker).toBeUndefined();
    const down = panel.handleSelectionKey('down');
    expect(down.handled).toBe(true);
    expect(panel.selectedWorker).toBe('sa-a');

    const down2 = panel.handleSelectionKey('down');
    expect(down2.handled).toBe(true);
    expect(panel.selectedWorker).toBe('sa-b');

    const enter = panel.handleSelectionKey('enter');
    expect(enter.handled).toBe(true);
    expect(enter.openWorkerId).toBe('sa-b');

    const esc = panel.handleSelectionKey('escape');
    expect(esc.handled).toBe(true);
    expect(esc.clearSelection).toBe(true);
    expect(panel.selectedWorker).toBeUndefined();

    // Footer hint when workers exist
    const text = plain(panel.render(100)).join('\n');
    expect(text).toMatch(/Enter open|Enter 열기/i);
  });

  it('hit-tests densemode worker rows after paint', () => {
    const clock = appearanceAnimationNow();
    const workers: MissionWorker[] = [
      {
        id: 'sa-hit',
        name: 'hit-me',
        kind: 'subagent',
        status: 'running',
        runInBackground: false,
        toolCount: 1,
        tokens: 10,
        elapsedMs: 500,
        spawnedAtMs: clock,
        lastActivityAtMs: clock,
      },
    ];
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers,
        activeCount: 1,
        totalTokens: 10,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });
    // Paint to populate lastWorkerRowMap.
    panel.render(100);
    // bandLocalY: 0 = top border; 1 = first content (KPI); worker rows after header.
    const hits: string[] = [];
    for (let y = 0; y < 12; y += 1) {
      const hit = panel.hitTestWorkerRow(y, 12);
      if (hit?.kind === 'worker') hits.push(hit.workerId);
    }
    expect(hits).toContain('sa-hit');
    expect(panel.selectWorker('sa-hit')).toBe(true);
    expect(panel.selectedWorker).toBe('sa-hit');
  });

  it('same-frame render: selected ❯ on one worker, hover pad on another', () => {
    const clock = appearanceAnimationNow();
    // Densemode WKR column truncates names to 8 cols — keep short unique labels.
    const workers: MissionWorker[] = [
      {
        id: 'sa-sel',
        name: 'sel-a',
        kind: 'subagent',
        status: 'running',
        runInBackground: false,
        toolCount: 2,
        tokens: 100,
        elapsedMs: 2_000,
        spawnedAtMs: clock,
        lastActivityAtMs: clock,
      },
      {
        id: 'sa-hov',
        name: 'hov-b',
        kind: 'subagent',
        status: 'running',
        runInBackground: false,
        toolCount: 1,
        tokens: 50,
        elapsedMs: 1_000,
        spawnedAtMs: clock + 1,
        lastActivityAtMs: clock,
      },
    ];
    const panel = new MissionControlPanelComponent();
    panel.setView({
      snapshot: {
        version: 1,
        workers,
        activeCount: 2,
        totalTokens: 150,
        ops: [],
      },
      jobs: emptyConductorJobsSnapshot(),
    });

    expect(panel.selectWorker('sa-sel')).toBe(true);
    setHoverRegion(missionWorkerHoverId('sa-hov'), clock);

    const text = plain(panel.render(100)).join('\n');
    const pointerCount = (text.match(new RegExp(SELECT_POINTER, 'g')) ?? []).length;
    expect(pointerCount).toBe(1);
    // Panel box prefix (`│`) sits before chrome — match gutter after the border.
    const selLine = text.split('\n').find((line) => line.includes('sel-a'));
    const hovLine = text.split('\n').find((line) => line.includes('hov-b'));
    expect(selLine).toBeDefined();
    expect(hovLine).toBeDefined();
    expect(selLine!).toMatch(new RegExp(`[│ ]${SELECT_POINTER} `));
    expect(hovLine!.includes(SELECT_POINTER)).toBe(false);
    // Hover pad is immediately after the box border / gutter (SPARK · is later).
    expect(hovLine!).toMatch(new RegExp(`[│ ]${HOVER_ROW_PAD} `));
    expect(hovLine!.indexOf(HOVER_ROW_PAD)).toBeLessThan(hovLine!.indexOf('hov-b'));
  });
});
