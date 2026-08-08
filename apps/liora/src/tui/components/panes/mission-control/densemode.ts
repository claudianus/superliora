/**
 * Bloomberg-style densemode layout for Mission Control (workers ≥ 2).
 * Pure string builders + light theme paint — panel owns reveal/lerp state.
 * Paint budget matches the solo panel: pulse/shimmer only on narrow signals
 * (glyph, mark, KPI chips), never on LIVE/TAPE/ticker body copy.
 */

import { truncateToWidth } from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { AppearancePreferences } from '#/tui/config';
import {
  renderPulseGlyph,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import type { MissionOpsEntry, MissionWorker } from '#/tui/controllers/mission-control/registry';
import { formatJobDuration } from '#/tui/utils/job/job-strip';
import {
  collapseLowSignalOps,
  formatMissionTarget,
} from '#/tui/utils/tools/mission-target';
import {
  formatMissionAgeMs,
  formatMissionTokenRate,
  formatMissionTokens,
  MISSION_LIVE_HOT_MS,
} from './mission-format';

const SPARK_CHARS = '▁▂▃▄▅▆▇█';
const DENSE_WORKER_CAP = 5;
const DENSE_TAPE_MIN = 2;
const DENSE_TICKER_MAX = 8;
const NARROW_WIDTH = 80;

export function shouldUseDensemode(workers: readonly MissionWorker[]): boolean {
  return workers.length >= 2;
}

/** Map rate samples onto a fixed-width block sparkline. */
export function formatRateSparkline(
  samples: readonly number[] | undefined,
  width = 3,
): string {
  if (samples === undefined || samples.length === 0) {
    return '·'.repeat(width);
  }
  const slice = samples.slice(-width);
  const max = Math.max(...slice, 1);
  let out = '';
  for (const sample of slice) {
    const idx = Math.min(
      SPARK_CHARS.length - 1,
      Math.max(0, Math.round((sample / max) * (SPARK_CHARS.length - 1))),
    );
    out += SPARK_CHARS[idx]!;
  }
  return out.padStart(width, '·');
}

export function shortModelAlias(alias: string | undefined): string {
  if (alias === undefined || alias.length === 0) return '—';
  const cleaned = alias.replace(/^qwen-token-plan\//u, '');
  if (cleaned.length <= 8) return cleaned;
  return `${cleaned.slice(0, 7)}…`;
}

export function compactElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${String(seconds).padStart(2, '0')}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m${String(seconds % 60).padStart(2, '0')}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h${String(minutes % 60).padStart(2, '0')}`;
}

export interface DenseLiveCell {
  readonly kind: 'thinking' | 'answer' | 'action' | 'stall' | 'idle';
  readonly text: string;
}

export function denseLiveCell(
  worker: MissionWorker,
  now: number,
  revealedLive: string | undefined,
  actionText: string | undefined,
): DenseLiveCell {
  if (worker.status === 'stalled') {
    const silent =
      worker.stalledSilentMs === undefined ? '' : ` ${formatJobDuration(worker.stalledSilentMs)}`;
    const last = worker.lastTool === undefined ? '' : ` · last ${worker.lastTool}`;
    return { kind: 'stall', text: `stall${silent}${last}` };
  }
  if (
    revealedLive !== undefined &&
    revealedLive.length > 0 &&
    worker.liveAtMs !== undefined &&
    now - worker.liveAtMs < MISSION_LIVE_HOT_MS &&
    (worker.status === 'running' || worker.status === 'finishing')
  ) {
    return {
      kind: worker.liveKind === 'answer' ? 'answer' : 'thinking',
      text: revealedLive,
    };
  }
  if (actionText !== undefined && actionText.length > 0) {
    return { kind: 'action', text: actionText };
  }
  const focus = worker.focusTodo?.trim();
  if (focus !== undefined && focus.length > 0) {
    return { kind: 'idle', text: focus };
  }
  return { kind: 'idle', text: '—' };
}

export interface BuildDenseContentOptions {
  readonly workers: readonly MissionWorker[];
  readonly ops: readonly MissionOpsEntry[];
  readonly width: number;
  readonly budget: number;
  readonly now: number;
  readonly workDir: string | undefined;
  readonly animated: boolean;
  readonly appearance: AppearancePreferences;
  /** Per-worker revealed live text (already interpolated). */
  readonly revealedLive: ReadonlyMap<string, string>;
  /** Per-worker display tok/s after lerp. */
  readonly displayRate: ReadonlyMap<string, number>;
  readonly workerGlyph: (worker: MissionWorker) => string;
}

export function buildDenseContent(options: BuildDenseContentOptions): string[] {
  const {
    workers,
    ops,
    width,
    budget,
    now,
    workDir,
    animated,
    appearance,
    revealedLive,
    displayRate,
    workerGlyph,
  } = options;
  if (budget <= 0 || width <= 0) return [];

  const narrow = width < NARROW_WIDTH;
  const lines: string[] = [];

  lines.push(truncateToWidth(buildKpiLine(workers, now, animated, appearance), width, '…'));
  if (lines.length >= budget) return lines;

  const ticker = buildTickerLine(ops, width, animated, appearance);
  if (ticker !== undefined) {
    lines.push(truncateToWidth(ticker, width, '…'));
    if (lines.length >= budget) return lines;
  }

  lines.push(truncateToWidth(buildHeaderLine(narrow), width, '…'));
  if (lines.length >= budget) return lines;

  const remainingAfterHdr = budget - lines.length;
  // Reserve tape header + at least DENSE_TAPE_MIN when ops exist.
  const collapsed = collapseLowSignalOps(ops);
  const wantTape = collapsed.length > 0;
  const tapeReserve = wantTape ? 1 + DENSE_TAPE_MIN : 0;
  const workerSlots = Math.max(
    1,
    Math.min(DENSE_WORKER_CAP, workers.length, remainingAfterHdr - tapeReserve),
  );
  const visibleWorkers = workers.slice(0, workerSlots);
  for (const worker of visibleWorkers) {
    if (lines.length >= budget) break;
    lines.push(
      truncateToWidth(
        buildWorkerRow({
          worker,
          width,
          narrow,
          now,
          workDir,
          animated,
          appearance,
          revealed:
            revealedLive.get(worker.id) ??
            (worker.liveText !== undefined && worker.liveText.length > 0
              ? worker.liveText
              : undefined),
          rate: displayRate.get(worker.id) ?? worker.tokenRatePerSec ?? 0,
          glyph: workerGlyph(worker),
        }),
        width,
        '…',
      ),
    );
  }
  if (workers.length > visibleWorkers.length && lines.length < budget) {
    lines.push(
      currentTheme.fg(
        'textDim',
        `… +${String(workers.length - visibleWorkers.length)} more`,
      ),
    );
  }

  if (wantTape && lines.length < budget) {
    const liveTape = animated && workers.some((w) => w.status === 'running');
    lines.push(
      liveTape && shouldRenderAmbientEffects(appearance)
        ? `${renderPulseGlyph(PULSE_ACTIVE_FRAMES, 'mc:tape:hdr', '●', 'primary', appearance)} ${currentTheme.boldFg('textMuted', 'TAPE')}`
        : currentTheme.boldFg('textMuted', 'TAPE'),
    );
    const tapeRows = Math.max(0, budget - lines.length);
    const multi = new Set(collapsed.map((entry) => entry.workerId)).size > 1;
    for (const entry of collapsed.slice(-tapeRows)) {
      lines.push(
        truncateToWidth(buildTapeRow(entry, width, multi, now, workDir, animated, appearance), width, '…'),
      );
    }
  }

  return lines.slice(0, budget);
}

function buildKpiLine(
  workers: readonly MissionWorker[],
  now: number,
  animated: boolean,
  appearance: AppearancePreferences,
): string {
  const active = workers.filter(
    (w) =>
      w.status === 'running' ||
      w.status === 'stalled' ||
      w.status === 'suspended' ||
      w.status === 'finishing',
  );
  const stalled = workers.filter((w) => w.status === 'stalled').length;
  const failed = workers.filter((w) => w.status === 'failed').length;
  const finishing = workers.filter((w) => w.status === 'finishing').length;
  const sumRate = active.reduce((sum, w) => sum + (w.tokenRatePerSec ?? 0), 0);
  const sumTok = active.reduce((sum, w) => sum + w.tokens, 0);
  const wall = active.reduce((max, w) => Math.max(max, w.elapsedMs), 0);
  const budgetParts = active
    .map((w) => {
      if (w.budgetMs === undefined || w.budgetMs <= 0) return undefined;
      const remaining = Math.max(0, w.budgetRemainingMs ?? w.budgetMs);
      return 1 - remaining / w.budgetMs;
    })
    .filter((ratio): ratio is number => ratio !== undefined);
  const budgetRatio =
    budgetParts.length === 0
      ? undefined
      : budgetParts.reduce((a, b) => a + b, 0) / budgetParts.length;

  const fleet = animated
    ? renderPulseText(`FLEET ${String(active.length)}`, 'mc:kpi:fleet', 'primary', appearance)
    : currentTheme.fg('primary', `FLEET ${String(active.length)}`);
  const parts = [fleet];
  const rateLabel = formatMissionTokenRate(sumRate);
  if (rateLabel.length > 0) {
    parts.push(
      animated
        ? renderPulseText(`Σ${rateLabel}`, 'mc:kpi:rate', 'accent', appearance)
        : currentTheme.fg('accent', `Σ${rateLabel}`),
    );
  }
  if (sumTok > 0) parts.push(currentTheme.fg('textMuted', `Σ${formatMissionTokens(sumTok)}`));
  if (wall > 0) parts.push(currentTheme.fg('textDim', `wall ${formatJobDuration(wall)}`));
  if (stalled > 0) parts.push(currentTheme.fg('warning', `stall${String(stalled)}`));
  if (failed > 0) parts.push(currentTheme.fg('error', `err${String(failed)}`));
  if (finishing > 0) parts.push(currentTheme.fg('info', `fin${String(finishing)}`));
  if (budgetRatio !== undefined) {
    parts.push(currentTheme.fg('textMuted', renderBudgetBar(budgetRatio, 8)));
  }
  // `now` kept for API symmetry / future live KPI ticks.
  void now;
  return parts.join(currentTheme.fg('textMuted', ' · '));
}

function renderBudgetBar(ratio: number, width: number): string {
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  let bar = '';
  for (let i = 0; i < width; i += 1) {
    bar += i < filled ? '█' : '░';
  }
  return bar;
}

function buildTickerLine(
  ops: readonly MissionOpsEntry[],
  width: number,
  animated: boolean,
  appearance: AppearancePreferences,
): string | undefined {
  if (ops.length === 0) return undefined;
  const recent = collapseLowSignalOps(ops).slice(-DENSE_TICKER_MAX);
  const chips = recent.map((entry) => {
    const mark =
      entry.status === 'running' ? '▸' : entry.status === 'error' ? '✗' : '✓';
    const shortName = truncateToWidth(entry.name, 10, '…');
    const worker = truncateToWidth(entry.workerName, 8, '…');
    const chip =
      entry.chip !== undefined && entry.chip.length > 0
        ? truncateToWidth(entry.chip.replace(/\s+/gu, ''), 6, '')
        : '';
    const plain = `${shortName}${mark}${worker}${chip.length > 0 ? chip : ''}`;
    // Running: mark stays in the chip string; whole chip is static semantic color.
    const token =
      entry.status === 'error' ? 'error' : entry.status === 'running' ? 'primary' : 'textDim';
    return currentTheme.fg(token, plain);
  });
  const prefix =
    animated && shouldRenderAmbientEffects(appearance)
      ? `${renderPulseGlyph(PULSE_ACTIVE_FRAMES, 'mc:tk:hdr', '●', 'primary', appearance)} ${currentTheme.boldFg('textMuted', 'TK')}`
      : currentTheme.boldFg('textMuted', 'TK');
  const body = chips.join(currentTheme.fg('textMuted', ' · '));
  return truncateToWidth(`${prefix}  ${body}`, width, '…');
}

function buildHeaderLine(narrow: boolean): string {
  if (narrow) {
    return currentTheme.fg('textMuted', 'WKR    ST ELAP /s   LIVE');
  }
  return currentTheme.fg(
    'textMuted',
    'WKR      ST MODEL    ELAP TOOLS   TOK    /s  SPARK TODO LIVE',
  );
}

function buildWorkerRow(args: {
  readonly worker: MissionWorker;
  readonly width: number;
  readonly narrow: boolean;
  readonly now: number;
  readonly workDir: string | undefined;
  readonly animated: boolean;
  readonly appearance: AppearancePreferences;
  readonly revealed: string | undefined;
  readonly rate: number;
  readonly glyph: string;
}): string {
  const { worker, width, narrow, now, workDir, animated, appearance, revealed, rate, glyph } =
    args;
  const name = truncateToWidth(worker.name, 8, '…').padEnd(8);
  const namePaint = currentTheme.fg(
    worker.status === 'failed'
      ? 'error'
      : worker.status === 'stalled'
        ? 'warning'
        : worker.status === 'completed'
          ? 'textDim'
          : 'text',
    name,
  );
  const action =
    worker.lastTool === undefined
      ? undefined
      : (() => {
          const target = formatMissionTarget(
            worker.lastTool,
            worker.lastTarget,
            workDir,
            narrow ? 16 : 28,
          );
          return target === undefined ? worker.lastTool : `${worker.lastTool} ${target}`;
        })();
  const live = denseLiveCell(worker, now, revealed, action);
  const liveMark =
    live.kind === 'thinking' ? '◌' : live.kind === 'answer' ? '◆' : live.kind === 'action' ? '→' : '·';
  const liveBody = truncateToWidth(`${liveMark} ${live.text}`, Math.max(12, width - (narrow ? 28 : 52)), '…');
  // LIVE body is always static — rate/glyph carry the motion budget.
  let livePaint: string;
  if (live.kind === 'thinking' || live.kind === 'answer') {
    livePaint = currentTheme.fg(live.kind === 'thinking' ? 'textDim' : 'text', liveBody);
  } else if (live.kind === 'stall') {
    livePaint = currentTheme.fg('warning', liveBody);
  } else {
    livePaint = currentTheme.fg('textDim', liveBody);
  }

  if (narrow) {
    const elapsed = currentTheme.fg('textDim', compactElapsed(worker.elapsedMs).padStart(4));
    const rateLabel = formatMissionTokenRate(rate);
    const ratePaint =
      rateLabel.length > 0
        ? animated
          ? renderPulseText(rateLabel.padStart(5), `mc:dense-rate:${worker.id}`, 'accent', appearance)
          : currentTheme.fg('accent', rateLabel.padStart(5))
        : currentTheme.fg('textMuted', '    —');
    return `${glyph} ${namePaint} ${elapsed} ${ratePaint} ${livePaint}`;
  }

  const model = currentTheme.fg('textMuted', shortModelAlias(worker.modelAlias).padEnd(8));
  const elapsed = currentTheme.fg('textDim', compactElapsed(worker.elapsedMs).padStart(4));
  const tools = currentTheme.fg('textMuted', String(worker.toolCount).padStart(5));
  const tok = currentTheme.fg('textMuted', formatMissionTokens(worker.tokens).padStart(6));
  const rateLabel = formatMissionTokenRate(rate);
  const ratePaint =
    rateLabel.length > 0
      ? animated
        ? renderPulseText(rateLabel.padStart(5), `mc:dense-rate:${worker.id}`, 'accent', appearance)
        : currentTheme.fg('accent', rateLabel.padStart(5))
      : currentTheme.fg('textMuted', '    —');
  const spark = currentTheme.fg('textMuted', formatRateSparkline(worker.rateSamples, 3));
  const todo =
    worker.todoTotal !== undefined && worker.todoTotal > 0
      ? currentTheme.fg(
          'textMuted',
          `${String(worker.todoDone ?? 0)}/${String(worker.todoTotal)}`.padStart(5),
        )
      : currentTheme.fg('textMuted', '    —');
  return `${glyph} ${namePaint} ${model} ${elapsed} ${tools} ${tok} ${ratePaint} ${spark} ${todo} ${livePaint}`;
}

function buildTapeRow(
  entry: MissionOpsEntry,
  width: number,
  showWorker: boolean,
  now: number,
  workDir: string | undefined,
  animated: boolean,
  appearance: AppearancePreferences,
): string {
  const age = currentTheme.fg('textMuted', formatMissionAgeMs(entry.atMs, now).padStart(7));
  const worker = showWorker ? currentTheme.fg('text', ` ${truncateToWidth(entry.workerName, 8, '…')}`) : '';
  let mark: string;
  if (entry.status === 'running') {
    mark =
      animated && shouldRenderAmbientEffects(appearance)
        ? ` ${renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc:tape:${entry.toolCallId}`, '▸', 'primary')} `
        : currentTheme.fg('primary', ' ▸ ');
  } else if (entry.status === 'error') {
    mark = currentTheme.fg('error', ' ✗ ');
  } else {
    mark = currentTheme.fg('success', ' ✓ ');
  }
  const human = formatMissionTarget(entry.name, entry.target, workDir, Math.max(16, Math.floor(width * 0.35)));
  const toolPaint = currentTheme.fg(
    entry.status === 'error' ? 'error' : entry.status === 'running' ? 'text' : 'textDim',
    entry.name,
  );
  const targetPaint =
    human === undefined
      ? ''
      : ` ${currentTheme.fg(entry.status === 'error' ? 'error' : 'textDim', human)}`;
  const chipPaint =
    entry.chip === undefined ? '' : ` ${currentTheme.fg('textMuted', entry.chip)}`;
  const body = `${toolPaint}${targetPaint}${chipPaint}`;
  return `${age}${worker}${mark}${body}`;
}
