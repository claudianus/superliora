/**
 * V5 control tower render + frame-budget evidence generator (V5-1/V5-2).
 *
 * Renders the Conductor job desk board through the real render path
 * (`JobBoardApp.render` → theme + renderer frame primitives) in headless
 * mode, captures the default screen plus keyboard-interaction frames,
 * measures the frame budget scenarios, and writes evidence files under
 * `reports/`. Marker failures exit non-zero, so this doubles as a check.
 *
 * Run with `CI=1` so motion/pulse effects fall back to plain styling and the
 * snapshot stays deterministic:
 *
 *   CI=1 pnpm -C apps/liora exec tsx --tsconfig apps/liora/tsconfig.dev.json \
 *     --import ./build/register-raw-text-loader.mjs \
 *     apps/liora/scripts/control-tower-evidence.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { JobBoardApp } from '#/tui/components/job-board/job-board';
import type { JobBoardProps } from '#/tui/components/job-board/job-board';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const repoRoot = join(appRoot, '..', '..');
const reportsDir = join(repoRoot, 'reports');

const ROWS = 40;
const COLS = 120;
const WIDTH = 120;
/** Fixed reference clock so relative-time labels stay stable within a run. */
const NOW = Date.now();
const FRAME_BUDGET_MS = 8;

/** Raw terminal sequences a real xterm-256color terminal emits. */
const KEY_DOWN = '\u001b[B';
const KEY_END = '\u001b[F';

const DATE = '2026-08-03';
const SCREEN_TXT = join(reportsDir, `${DATE}-v5-control-tower-default-screen.txt`);
const SCREEN_ANSI = join(reportsDir, `${DATE}-v5-control-tower-default-screen.ansi`);
const BUDGET_TXT = join(reportsDir, `${DATE}-v5-control-tower-frame-budget.txt`);

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function card(
  id: string,
  status: ConductorJobCard['status'],
  index: number,
): ConductorJobCard {
  return {
    id,
    title: `ship control tower slice ${id.replace('job_', '#')}`,
    status,
    kind: 'task',
    priority: (index % 3) + 1,
    updatedAtMs: NOW - index * 7_000,
    worktreePath: `/tmp/wt/job-${String(index)}`,
    progress: {
      phase: 'implementing',
      recentTools: ['Read', 'Edit', 'Bash'],
      lastHeartbeatAt: new Date(NOW - index * 3_000).toISOString(),
    },
  };
}

function fullBoardSnapshot(): ConductorJobsSnapshot {
  const statuses: ConductorJobCard['status'][] = [
    'running',
    'needs_user',
    'blocked',
    'queued',
    'interrupted',
    'failed',
    'done',
    'cancelled',
  ];
  const jobs: ConductorJobCard[] = [];
  for (let i = 0; i < 64; i++) {
    const id = `job_${String(i).padStart(4, '0')}`;
    jobs.push(card(id, statuses[i % statuses.length]!, i));
  }
  return {
    total: 64,
    queued: 8,
    running: 8,
    blocked: 8,
    needsUser: 8,
    interrupted: 8,
    failed: 8,
    unreadInbox: 3,
    maxConcurrent: 8,
    jobs,
    inbox: Array.from({ length: 24 }, (_, i) => ({
      eventId: `evt_${String(i)}`,
      kind: 'job.completed' as const,
      jobId: `job_${String(i % 64).padStart(4, '0')}`,
      title: `completion notice ${String(i)}`,
      summary: 'worker finished cleanly',
      atMs: NOW - i * 60_000,
    })),
  };
}

/** Small realistic startup snapshot: the screen a conductor sees on boot. */
function startupSnapshot(): ConductorJobsSnapshot {
  return {
    total: 3,
    queued: 1,
    running: 1,
    blocked: 0,
    needsUser: 1,
    interrupted: 0,
    failed: 0,
    unreadInbox: 1,
    maxConcurrent: 8,
    jobs: [
      card('job_a1b2c3d4e5f6', 'running', 0),
      card('job_b2c3d4e5f6a1', 'needs_user', 1),
      card('job_c3d4e5f6a1b2', 'queued', 2),
    ],
    inbox: [
      {
        eventId: 'evt_0',
        kind: 'job.needs_user',
        jobId: 'job_b2c3d4e5f6a1',
        title: 'question from worker',
        summary: 'which migration strategy should we use?',
        atMs: NOW - 45_000,
      },
    ],
  };
}

function makeApp(snapshot: ConductorJobsSnapshot, selectedJobId: string | undefined): JobBoardApp {
  const props: JobBoardProps = {
    snapshot,
    selectedJobId,
    flashMessage: undefined,
    onSelect: () => {},
    onCancel: () => {},
    onInspect: () => {},
  };
  return new JobBoardApp(props, { rows: ROWS, columns: COLS, write: () => {} });
}

function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

interface ScenarioStats {
  readonly name: string;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

function formatStats(stats: ScenarioStats): string {
  const verdict = stats.p95 < FRAME_BUDGET_MS ? 'PASS' : 'FAIL';
  return [
    `${verdict}  ${stats.name}`,
    `     samples=${String(stats.samples)}  p50=${stats.p50.toFixed(3)}ms  p95=${stats.p95.toFixed(3)}ms  max=${stats.max.toFixed(3)}ms  budget=${String(FRAME_BUDGET_MS)}ms`,
  ].join('\n');
}

async function main(): Promise<void> {
  // ── render evidence: default screen + interaction frames ─────────────
  const app = makeApp(fullBoardSnapshot(), 'job_0000');
  const frameA = app.render(WIDTH); // default screen as mounted at startup
  app.handleInput(KEY_DOWN); // keyboard nav: selection moves one job down
  const frameB = app.render(WIDTH);
  app.handleInput(KEY_END); // End: jump to last job, list viewport scrolls
  const frameC = app.render(WIDTH);
  // Wide terminal: header right side (backpressure + inbox) becomes visible.
  const frameD = app.render(150);

  const textA = stripAnsi(frameA.join('\n'));
  const textB = stripAnsi(frameB.join('\n'));
  const textC = stripAnsi(frameC.join('\n'));
  const textD = stripAnsi(frameD.join('\n'));

  const markerChecks: ReadonlyArray<readonly [string, boolean]> = [
    ['frame A: header title', textA.includes('CONDUCTOR JOB DESK')],
    ['frame A: job count in list frame', textA.includes('Jobs [64]')],
    ['frame A: running group header', textA.includes('running (8)')],
    ['frame A: done count segment', textA.includes('16 done')],
    ['frame A: detail pane shows initial selection', textA.includes('job_0000')],
    ['frame A: footer key hints', textA.includes('navigate') && textA.includes('inspect')],
    ['frame B: repaint differs from frame A', textB !== textA],
    ['frame B: detail pane follows keyboard selection', textB.includes('job_0024')],
    ['frame C: End jumps to the last job', textC.includes('job_0063')],
    ['frame C: viewport scrolled past the running group', !textC.includes('running (8)')],
    ['frame C: repaint differs from frame B', textC !== textB],
    ['frame D: wide header shows backpressure + inbox', textD.includes('backpressure:') && textD.includes('inbox 3')],
  ];

  // ── frame budget instrumentation ─────────────────────────────────────
  const scenarios: ScenarioStats[] = [];

  // S1: V5-1 default screen (small startup snapshot) single-event repaint.
  {
    const startup = makeApp(startupSnapshot(), 'job_a1b2c3d4e5f6');
    for (let i = 0; i < 10; i++) startup.render(WIDTH);
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      startup.render(WIDTH);
      samples.push(performance.now() - start);
    }
    scenarios.push({
      name: 'S1 default screen (3-job startup snapshot) repaint',
      samples: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      max: Math.max(...samples),
    });
  }

  // S2: 20-event burst on the full 64-card board (setProps + render).
  {
    const base = fullBoardSnapshot();
    const burst = makeApp(base, 'job_0000');
    for (let i = 0; i < 10; i++) burst.render(WIDTH);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const next: ConductorJobsSnapshot = {
        ...base,
        jobs: base.jobs.map((job, index) =>
          index === i % base.jobs.length
            ? { ...job, updatedAtMs: NOW + i, priority: ((job.priority + 1) % 3) + 1 }
            : job,
        ),
      };
      const start = performance.now();
      burst.setProps({
        snapshot: next,
        selectedJobId: 'job_0000',
        flashMessage: undefined,
        onSelect: () => {},
        onCancel: () => {},
        onInspect: () => {},
      });
      burst.render(WIDTH);
      samples.push(performance.now() - start);
    }
    scenarios.push({
      name: 'S2 20-event burst (setProps + render, 64-card board)',
      samples: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      max: Math.max(...samples),
    });
  }

  // S3: full 64-card board repaint.
  {
    for (let i = 0; i < 10; i++) app.render(WIDTH);
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      app.render(WIDTH);
      samples.push(performance.now() - start);
    }
    scenarios.push({
      name: 'S3 full 64-card board repaint',
      samples: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      max: Math.max(...samples),
    });
  }

  // ── write evidence files ─────────────────────────────────────────────
  await mkdir(reportsDir, { recursive: true });

  const screenDump = [
    `# Control tower default screen — headless render capture (${DATE})`,
    `# Render path: JobBoardApp.render(${String(WIDTH)}) with terminal ${String(ROWS)}x${String(COLS)}`,
    `# Deterministic run: CI=1 (motion effects off), fixed reference clock.`,
    '',
    '## Frame A — default screen (conductor startup, 64-job board, selection job_0000)',
    '',
    textA,
    '',
    '## Frame B — after Key.down (keyboard navigation: selection follows, detail repaints)',
    '',
    textB,
    '',
    '## Frame C — after Key.end (End: jump to last job, list viewport scrolls)',
    '',
    textC,
    '',
    '## Frame D — same state at width 150 (header right side: backpressure + inbox)',
    '',
    textD,
    '',
  ].join('\n');
  await writeFile(SCREEN_TXT, screenDump, 'utf8');
  await writeFile(SCREEN_ANSI, `${frameA.join('\n')}\n`, 'utf8');

  const budgetDump = [
    `# Control tower frame budget instrumentation (${DATE})`,
    `# Budget: single event repaint < ${String(FRAME_BUDGET_MS)}ms (apps/liora AGENTS.md).`,
    `# Method: performance.now() around render()/setProps()+render(); warmup excluded.`,
    '',
    ...scenarios.map(formatStats),
    '',
  ].join('\n');
  await writeFile(BUDGET_TXT, budgetDump, 'utf8');

  // ── verdict ──────────────────────────────────────────────────────────
  let failures = 0;
  for (const [name, ok] of markerChecks) {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  for (const stats of scenarios) {
    const ok = stats.p95 < FRAME_BUDGET_MS;
    if (!ok) failures++;
    console.log(formatStats(stats));
  }
  console.log(`control-tower-evidence: ${SCREEN_TXT}`);
  console.log(`control-tower-evidence: ${SCREEN_ANSI}`);
  console.log(`control-tower-evidence: ${BUDGET_TXT}`);
  if (failures > 0) {
    console.error(`control-tower-evidence: ${String(failures)} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `control-tower-evidence: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
  process.exit(1);
});
