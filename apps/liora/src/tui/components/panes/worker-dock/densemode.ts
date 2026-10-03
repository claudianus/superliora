/**
 * Bloomberg-style densemode layout for Mission Control (any visible worker).
 * Pure string builders + light theme paint — panel owns reveal/lerp state.
 * Paint budget matches the solo panel: pulse/shimmer only on narrow signals
 * (glyph, mark, KPI chips), never on LIVE body copy. Workers-first layout —
 * a thin live BOARD attention strip (1–2 cards) stays visible so Conductor
 * jobs remain on the dock while the roster is dense.
 */

import { truncateToWidth } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import type { AppearancePreferences } from '#/tui/config';
import {
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { applyStreamTailGlow } from '#/tui/features/transcript/transcript-entrance';
import { renderPulseCountChip } from '#/tui/components/chrome/chrome-band-motion';
import type { DockOpsEntry, DockWorker } from '#/tui/controllers/worker-dock/registry';
import { isToolProgressLiveKind } from '#/tui/controllers/worker-dock/registry';
import { workerLedgerChip } from '#/tui/features/worker-dock/labels';
import {
  JOB_STATUS_META,
  shortJobId,
} from '#/tui/components/job-board/job-board-helpers';
import {
  formatJobDuration,
  interviewNeedsUserCount,
  type ConductorJobCard,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';
import {
  formatMissionTokenRate,
  formatMissionTokens,
  liveWorkerElapsedMs,
  MISSION_LIVE_HOT_MS,
} from './dock-format';

const SPARK_CHARS = '▁▂▃▄▅▆▇█';
/** Max worker rows painted in densemode (windowed when the roster is longer). */
export const DENSE_WORKER_CAP = 8;
const NARROW_WIDTH = 80;

/** How many densemode worker rows fit in the remaining paint budget. */
export function denseWorkerSlots(
  workerCount: number,
  remainingAfterHdr: number,
): number {
  return Math.max(
    1,
    Math.min(DENSE_WORKER_CAP, workerCount, remainingAfterHdr),
  );
}

export function clampWorkerScrollOffset(
  offset: number,
  workerCount: number,
  slots: number,
): number {
  const maxOffset = Math.max(0, workerCount - Math.max(1, slots));
  return Math.min(maxOffset, Math.max(0, offset));
}

/** Densemode whenever at least one worker is visible (solo included). */
export function shouldUseDensemode(workers: readonly DockWorker[]): boolean {
  return workers.length > 0;
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
  readonly kind: 'thinking' | 'answer' | 'action' | 'idle' | 'stdout' | 'stderr' | 'progress' | 'status';
  readonly text: string;
}

export function denseLiveCell(
  worker: DockWorker,
  now: number,
  revealedLive: string | undefined,
  actionText: string | undefined,
): DenseLiveCell {
  const liveText =
    revealedLive !== undefined && revealedLive.length > 0 ? revealedLive : undefined;
  if (
    liveText !== undefined &&
    (worker.status === 'running')
  ) {
    if (isToolProgressLiveKind(worker.liveKind)) {
      return { kind: worker.liveKind, text: liveText };
    }
    if (worker.liveAtMs !== undefined && now - worker.liveAtMs < MISSION_LIVE_HOT_MS) {
      return {
        kind: worker.liveKind === 'answer' ? 'answer' : 'thinking',
        text: liveText,
      };
    }
  }
  const description = worker.description?.trim();
  if (description !== undefined && description.length > 0) {
    return { kind: 'idle', text: description };
  }
  if (actionText !== undefined && actionText.length > 0) {
    return { kind: 'action', text: actionText };
  }
  return { kind: 'idle', text: '—' };
}


/** Job-lane counts line shared by solo BOARD and densemode BOARD strip. */
export function formatMissionJobCounts(jobs: ConductorJobsSnapshot): string {
  const done = jobs.jobs.reduce((count, card) => count + Number(card.status === 'done'), 0);
  const needsYou = interviewNeedsUserCount(jobs);
  const parts = [
    needsYou > 0 ? currentTheme.fg('warning', `your reply ${String(needsYou)}`) : undefined,
    jobs.running > 0 ? currentTheme.fg('primary', `running ${String(jobs.running)}`) : undefined,
    jobs.queued > 0 ? currentTheme.fg('info', `queued ${String(jobs.queued)}`) : undefined,
    jobs.interrupted > 0
      ? currentTheme.fg('warning', `interrupted ${String(jobs.interrupted)}`)
      : undefined,
    jobs.failed > 0 ? currentTheme.fg('textDim', `failed ${String(jobs.failed)}`) : undefined,
    currentTheme.fg('textDim', `done ${String(done)}`),
  ].filter((part): part is string => part !== undefined);
  return parts.join(currentTheme.fg('textMuted', ' · '));
}

/**
 * Attention cards: needs_user/blocked → interrupted → running → recent failed.
 * Skips cards with empty title+id so we never paint a lone pointer.
 */
export function selectAttentionJobs(
  jobs: ConductorJobsSnapshot,
  max: number,
): ConductorJobCard[] {
  if (max <= 0 || jobs.jobs.length === 0) return [];
  const rank = (status: string): number => {
    if (status === 'needs_user' || status === 'blocked') return 0;
    if (status === 'interrupted') return 1;
    if (status === 'running') return 2;
    if (status === 'failed') return 3;
    return 9;
  };
  return jobs.jobs
    .filter((card) => {
      const statusOk =
        card.status === 'needs_user' ||
        card.status === 'blocked' ||
        card.status === 'interrupted' ||
        card.status === 'running' ||
        card.status === 'failed';
      if (!statusOk) return false;
      // Require a real title — id-only rows paint as a lone pointer.
      return card.title.trim().length > 0 && card.id.trim().length > 0;
    })
    .toSorted((a, b) => rank(a.status) - rank(b.status) || b.updatedAtMs - a.updatedAtMs)
    .slice(0, max);
}

export function formatAttentionJobRow(
  card: ConductorJobCard,
  width: number,
  now: number,
): string | undefined {
  const titlePlain = card.title.trim();
  const idPlain = card.id.trim();
  if (titlePlain.length === 0 && idPlain.length === 0) return undefined;
  const meta = JOB_STATUS_META[card.status] ?? JOB_STATUS_META.running;
  const waitingParent = card.status === 'queued' && card.parentJobId !== undefined;
  const token: ColorToken =
    card.status === 'needs_user' || card.status === 'blocked' || card.status === 'interrupted'
      ? 'warning'
      : card.status === 'failed'
        ? 'error'
        : meta.token;
  const statusLabel = waitingParent ? 'queued(parent-phase)' : meta.label;
  const label = titlePlain.length > 0 ? titlePlain : shortJobId(idPlain);
  const title = truncateToWidth(label, Math.max(6, width - 24), '…');
  const phase =
    card.progress?.phase !== undefined && card.progress.phase.length > 0
      ? currentTheme.fg('textDim', ` ${truncateToWidth(card.progress.phase, 12, '…')}`)
      : '';
  const tools =
    card.progress?.recentTools !== undefined && card.progress.recentTools.length > 0
      ? currentTheme.fg(
          'textDim',
          ` ${truncateToWidth(card.progress.recentTools.slice(-2).join('→'), 16, '…')}`,
        )
      : '';
  const steps =
    card.progress?.stepsTotal !== undefined && card.progress.stepsTotal > 0
      ? currentTheme.fg(
          'textMuted',
          ` ${String(card.progress.stepsCompleted ?? 0)}/${String(card.progress.stepsTotal)}`,
        )
      : '';
  const worker =
    card.workerName === undefined ? '' : currentTheme.fg('textDim', ` ${card.workerName}`);
  const freshness =
    card.statusChangedAtMs === undefined
      ? ''
      : (() => {
          const age = now - card.statusChangedAtMs;
          if (age > 60_000) return '';
          return currentTheme.fg('textMuted', ` ${formatJobDuration(age)} ago`);
        })();
  // Status glyph only — SELECT_POINTER is reserved for true cursor selection
  // (PREMIUM §2). Always-on ❯ made every attention row look multi-selected.
  return truncateToWidth(
    `${currentTheme.fg(token, `${meta.glyph} ${shortJobId(card.id)}`)} ${currentTheme.fg(
      token,
      waitingParent ? `${statusLabel} ${title}` : title,
    )}${phase}${tools}${worker}${steps}${freshness}`,
    width,
    '…',
  );
}

export interface BuildDenseContentOptions {
  readonly workers: readonly DockWorker[];
  /** @deprecated Densemode is workers-only; ops are ignored. */
  readonly ops?: readonly DockOpsEntry[];
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
  readonly workerGlyph: (worker: DockWorker) => string;
  /** Window start into the sorted worker roster (clamped). */
  readonly scrollOffset?: number;
  /** Conductor job ledger for KPI chips + a thin live BOARD attention strip. */
  readonly jobs?: ConductorJobsSnapshot;
  /** Keyboard / click selection (worker id). */
  readonly selectedWorkerId?: string;
  /** Leading chrome for a worker row (selection / hover pointer). */
  readonly paintRowChrome?: (worker: DockWorker) => string;
}

export interface DenseContentResult {
  readonly lines: string[];
  readonly workerSlots: number;
  readonly scrollOffset: number;
  /** Content-local row index → worker id for mouse hit-testing. */
  readonly workerRowMap: ReadonlyMap<number, string>;
  /** Content-local row of the WKR column header (hover target). */
  readonly headerRow: number | undefined;
}

export function buildDenseContent(options: BuildDenseContentOptions): DenseContentResult {
  const {
    workers,
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
  const emptyMap = new Map<number, string>();
  if (budget <= 0 || width <= 0) {
    return { lines: [], workerSlots: 0, scrollOffset: 0, workerRowMap: emptyMap, headerRow: undefined };
  }

  const jobs = options.jobs;
  const narrow = width < NARROW_WIDTH;
  const lines: string[] = [];
  const workerRowMap = new Map<number, string>();
  let headerRow: number | undefined;

  lines.push(
    truncateToWidth(buildKpiLine(workers, now, animated, appearance, jobs), width, '…'),
  );
  if (lines.length >= budget) {
    return { lines, workerSlots: 0, scrollOffset: 0, workerRowMap, headerRow };
  }

  // Live BOARD strip: keep top attention cards (needs_user / running / failed)
  // visible under densemode so the kanban story does not vanish while workers
  // occupy the roster. Cap at 2 rows to protect worker paint budget.
  const attentionJobs =
    jobs !== undefined && jobs.total > 0 ? selectAttentionJobs(jobs, 2) : [];
  for (const card of attentionJobs) {
    if (lines.length >= budget) break;
    const row = formatAttentionJobRow(card, width, now);
    if (row !== undefined) lines.push(row);
  }
  if (lines.length >= budget) {
    return { lines, workerSlots: 0, scrollOffset: 0, workerRowMap, headerRow };
  }

  headerRow = lines.length;
  lines.push(truncateToWidth(buildHeaderLine(narrow), width, '…'));
  if (lines.length >= budget) {
    return { lines, workerSlots: 0, scrollOffset: 0, workerRowMap, headerRow };
  }

  const remainingAfterHdr = budget - lines.length;
  // Workers-only densemode: former TAPE/BOARD vertical budget goes to roster rows.
  // Reserve one row for `+N more` when the roster cannot fully fit.
  const maxFit = Math.min(DENSE_WORKER_CAP, remainingAfterHdr);
  const overflowReserve = workers.length > maxFit && remainingAfterHdr > 1 ? 1 : 0;
  const workerSlots = denseWorkerSlots(workers.length, remainingAfterHdr - overflowReserve);
  const scrollOffset = clampWorkerScrollOffset(
    options.scrollOffset ?? 0,
    workers.length,
    workerSlots,
  );
  const visibleWorkers = workers.slice(scrollOffset, scrollOffset + workerSlots);
  for (const worker of visibleWorkers) {
    if (lines.length >= budget) break;
    const rowIndex = lines.length;
    workerRowMap.set(rowIndex, worker.id);
    const rawChrome = options.paintRowChrome?.(worker);
    // Fixed 2-col gutter whenever chrome is wired so WKR/MODEL columns do not
    // walk when selection or hover appears (idle → two spaces).
    const chrome =
      rawChrome === undefined ? '' : rawChrome.length === 0 ? '  ' : rawChrome;
    const chromeCols = rawChrome === undefined ? 0 : 2;
    lines.push(
      truncateToWidth(
        `${chrome}${buildWorkerRow({
          worker,
          jobs,
          width: Math.max(1, width - chromeCols),
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
          selected: worker.id === options.selectedWorkerId,
        })}`,
        width,
        '…',
      ),
    );
  }
  if (workers.length > visibleWorkers.length && lines.length < budget) {
    const hidden = workers.length - visibleWorkers.length;
    lines.push(currentTheme.fg('textDim', `… +${String(hidden)} more (↑↓)`));
  }

  return {
    lines: lines.slice(0, budget),
    workerSlots,
    scrollOffset,
    workerRowMap,
    headerRow,
  };
}

function buildKpiLine(
  workers: readonly DockWorker[],
  now: number,
  animated: boolean,
  appearance: AppearancePreferences,
  jobs: ConductorJobsSnapshot | undefined,
): string {
  const active = workers.filter((worker) => worker.status === 'running');
  const failedWorkers = workers.filter((w) => w.status === 'failed').length;
  const sumRate = active.reduce((sum, w) => sum + (w.tokenRatePerSec ?? 0), 0);
  const sumTok = active.reduce((sum, w) => sum + w.tokens, 0);
  const wall = active.reduce((max, w) => Math.max(max, liveWorkerElapsedMs(w, now)), 0);

  const parts = [
    renderPulseCountChip(`WORKERS ${String(active.length)}`, 'mc:kpi:fleet', 'primary', appearance),
  ];
  const rateLabel = formatMissionTokenRate(sumRate);
  if (rateLabel.length > 0) {
    parts.push(renderPulseCountChip(`Σ${rateLabel}`, 'mc:kpi:rate', 'accent', appearance));
  }
  if (sumTok > 0) parts.push(currentTheme.fg('textMuted', `Σ${formatMissionTokens(sumTok)}`));
  if (wall > 0) parts.push(currentTheme.fg('textDim', `wall ${formatJobDuration(wall)}`));
  // Failed is calm dim — never paint dock KPI chrome as error solely for fails.
  if (failedWorkers > 0) parts.push(currentTheme.fg('textDim', `err${String(failedWorkers)}`));
  if (jobs !== undefined) {
    const needsYou = interviewNeedsUserCount(jobs);
    if (needsYou > 0) {
      parts.push(currentTheme.fg('warning', `your reply ${String(needsYou)}`));
    }
    if (jobs.failed > 0) {
      parts.push(currentTheme.fg('textDim', `job-fail ${String(jobs.failed)}`));
    }
    if (jobs.interrupted > 0) {
      parts.push(currentTheme.fg('warning', `⏸${String(jobs.interrupted)}`));
    }
  }
  // `now` kept for API symmetry / future live KPI ticks.
  void now;
  return parts.join(currentTheme.fg('textMuted', ' · '));
}


/**
 * Header labels positioned from the SAME column math as the dense rows
 * (`buildDenseWorkerLine`): glyph(1) + sep + name + sep + each padded field.
 * The old hand-typed literals drifted 2–3 columns off and advertised an `ST`
 * status column that no row ever fills (status reads through the glyph).
 */
function buildHeaderLine(narrow: boolean): string {
  const cols: Array<readonly [number, string]> = narrow
    ? [
        [2, 'WKR'],
        [21, 'ELAP'],
        [26, '/s'],
        [32, 'LIVE'],
      ]
    : [
        [2, 'WKR'],
        [23, 'MODEL'],
        [32, 'ELAP'],
        [37, 'TOOLS'],
        [43, 'TOK'],
        [50, '/s'],
        [56, 'SPARK'],
        [60, 'LIVE'],
      ];
  let out = '';
  let cursor = 0;
  for (const [at, label] of cols) {
    out += ' '.repeat(Math.max(0, at - cursor));
    out += label;
    cursor = at + label.length;
  }
  return currentTheme.fg('textMuted', out);
}

const RESUME_PLACEHOLDERS = new Set([
  'Resuming…',
  'Queued after resume…',
  'Interrupted — resuming…',
]);

function isResumePlaceholder(text: string | undefined): boolean {
  return text !== undefined && RESUME_PLACEHOLDERS.has(text);
}

/** Worker name plus recorded Job title or description. */
export function workerRosterLabel(
  worker: DockWorker,
  jobs: ConductorJobsSnapshot | undefined,
): string {
  const role = worker.name.trim().length > 0 ? worker.name.trim() : worker.id;
  const jobTitle = jobs?.jobs.find((card) => card.workerAgentId === worker.id)?.title.trim();
  const description = worker.description?.trim();
  // Ledger ghosts keep the bare title here — their mirrored lane text
  // (description) already fills the LIVE cell; suffixing it would duplicate.
  if (worker.ledger !== undefined) return role;
  const title =
    jobTitle !== undefined && jobTitle.length > 0
      ? jobTitle
      : description !== undefined &&
          description.length > 0 &&
          description !== role &&
          !isResumePlaceholder(description)
        ? description
        : undefined;
  if (title !== undefined && title !== role) return `${role} · ${title}`;
  return role;
}

function buildWorkerRow(args: {
  readonly worker: DockWorker;
  readonly jobs: ConductorJobsSnapshot | undefined;
  readonly width: number;
  readonly narrow: boolean;
  readonly now: number;
  readonly workDir: string | undefined;
  readonly animated: boolean;
  readonly appearance: AppearancePreferences;
  readonly revealed: string | undefined;
  readonly rate: number;
  readonly glyph: string;
  readonly selected?: boolean;
}): string {
  const { worker, width, narrow, now, workDir, animated, appearance, revealed, rate, glyph } =
    args;
  const nameWidth = narrow ? 18 : 20;
  const name = truncateToWidth(workerRosterLabel(worker, args.jobs), nameWidth, '…').padEnd(
    nameWidth,
  );
  // Keep main's calm failed/completed dim tokens; dual-pointer adds selected primary/bold.
  const nameToken: ColorToken =
    worker.status === 'failed' || worker.status === 'completed'
      ? 'textDim'
        : args.selected
          ? 'primary'
          : 'text';
  const namePaint = args.selected
    ? currentTheme.boldFg(nameToken, name)
    : currentTheme.fg(nameToken, name);
  const action =
    worker.lastTool === undefined
      ? undefined
      : (() => {
          const target = worker.lastTarget === undefined
            ? undefined
            : truncateToWidth(worker.lastTarget, narrow ? 16 : 28, '…');
          return target === undefined ? worker.lastTool : `${worker.lastTool} ${target}`;
        })();
  const live = denseLiveCell(worker, now, revealed, action);
  const liveMark =
    live.kind === 'thinking'
      ? '◌'
      : live.kind === 'answer'
        ? '◆'
        : live.kind === 'action'
          ? '→'
          : isToolProgressLiveKind(live.kind)
            ? '▏'
            : '·';
  const liveBody = truncateToWidth(
    `${liveMark} ${live.text}`,
    Math.max(12, width - (narrow ? 38 : 64)),
    '…',
  );
  let livePaint: string;
  if (live.kind === 'thinking' || live.kind === 'answer') {
    livePaint = currentTheme.fg(live.kind === 'thinking' ? 'textDim' : 'text', liveBody);
  } else if (live.kind === 'stderr') {
    livePaint = currentTheme.fg('error', liveBody);
  } else if (live.kind === 'stdout' || live.kind === 'progress' || live.kind === 'status') {
    livePaint = currentTheme.fg('textMuted', liveBody);
  } else {
    livePaint = currentTheme.fg('textDim', liveBody);
  }
  if (
    animated &&
    shouldRenderAmbientEffects(appearance) &&
    (live.kind === 'stdout' || live.kind === 'stderr' || live.kind === 'progress')
  ) {
    const glowed = applyStreamTailGlow(
      [livePaint],
      live.kind === 'stderr' ? 'tool' : 'assistant',
      appearance,
      { active: true, nowMs: now },
    );
    livePaint = glowed[0] ?? livePaint;
  }

  if (narrow) {
    const elapsed = currentTheme.fg(
      'textDim',
      compactElapsed(liveWorkerElapsedMs(worker, now)).padStart(4),
    );
    const rateLabel = formatMissionTokenRate(rate);
    const ratePaint =
      rateLabel.length > 0
        ? animated
          ? renderPulseText(rateLabel.padStart(5), `mc:dense-rate:${worker.id}`, 'accent', appearance)
          : currentTheme.fg('accent', rateLabel.padStart(5))
        : currentTheme.fg('textMuted', '    —');
    return `${glyph} ${namePaint} ${elapsed} ${ratePaint} ${livePaint}`;
  }

  // Ledger ghosts show their recorded Job kind instead of an absent model.
  const ledgerChip = workerLedgerChip(worker);
  const model = currentTheme.fg(
    'textMuted',
    (ledgerChip ?? shortModelAlias(worker.modelAlias)).padEnd(8),
  );
  const elapsed = currentTheme.fg(
    'textDim',
    compactElapsed(liveWorkerElapsedMs(worker, now)).padStart(4),
  );
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
  return `${glyph} ${namePaint} ${model} ${elapsed} ${tools} ${tok} ${ratePaint} ${spark} ${livePaint}`;
}
