/**
 * MissionControlPanel — the single live-monitoring surface for every
 * background worker (subagents, background agents/processes, swarm members)
 * plus a condensed Conductor job lane summary. Renders two ways:
 *
 * - `renderDock(width, height)` — centered bento panel (wide terminals);
 *   fills the exact dock rect beside the stage.
 * - `render(width)` — in-stack chrome band fallback (narrow terminals),
 *   capped at {@link MISSION_FALLBACK_MAX_ROWS} rows.
 *
 * Presentation only: the controller pushes an immutable
 * {@link MissionControlView} (registry snapshot + conductor jobs). Motion
 * flows through the shared appearance clock and degrades to static marks
 * under off / SSH / NO_COLOR / CI per PREMIUM.md §7. Live rates, settle
 * flashes, and progress-bar shimmer keep the surface feeling real-time.
 *
 * Information hierarchy: intent → action → telemetry (paths never dominate).
 */

import {
  renderRendererRatioProgressBar,
  truncateToWidth,
  type Component,
} from '#/tui/renderer';

import {
  PULSE_ACTIVE_FRAMES,
  PULSE_BLOCKED_FRAMES,
  SELECT_POINTER,
} from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import {
  ambientAnimationActive,
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseGlyph,
  renderPulseText,
  renderShimmerPrefix,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import {
  MISSION_COMPLETED_LINGER_MS,
  type MissionControlSnapshot,
  type MissionOpsEntry,
  type MissionWorker,
} from '#/tui/controllers/mission-control/registry';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import {
  emptyConductorJobsSnapshot,
  formatJobDuration,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';
import {
  collapseLowSignalOps,
  formatMissionTarget,
} from '#/tui/utils/tools/mission-target';

/** Stack-fallback band never grows past this many rows. */
export const MISSION_FALLBACK_MAX_ROWS = 14;
/** MOVES rows in the full layout (tight/minimal degrade first). */
const OPS_FEED_FULL_ROWS = 4;
/** Job rows under the counts line in the full layout. */
const JOB_ROWS_FULL = 2;
/** Settle-flash window after a worker reaches a terminal state. */
const TERMINAL_FLASH_MS = 2_000;
/** Hot window for a just-settled MOVES row (checkmark / error pop). */
const OPS_SETTLE_FLASH_MS = 1_400;
/** Action row still "hot" after lastActivity — shimmer the → line. */
const ACTION_HOT_MS = 900;
/** Progress-bar shimmer sweep period. */
const BAR_SHIMMER_PERIOD_MS = 1_100;
/** Worker name column cap so intent keeps room on narrow docks. */
const WORKER_NAME_MAX = 16;
/** Target budget inside a ~40col dock interior. */
const TARGET_MAX = 22;

export interface MissionControlView {
  readonly snapshot: MissionControlSnapshot;
  readonly jobs: ConductorJobsSnapshot;
  /** Workspace cwd for path relativization (optional). */
  readonly workDir?: string;
}

export function emptyMissionControlView(): MissionControlView {
  return {
    snapshot: {
      version: 0,
      workers: [],
      activeCount: 0,
      totalTokens: 0,
      ops: [],
    },
    jobs: emptyConductorJobsSnapshot(),
  };
}

/** `HH:MM:SS` wall-clock for MOVES rows (tests derive via this helper). */
export function formatMissionClockMs(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Dense token chip (`12482` → `12.5k`). */
export function formatMissionTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Live rate chip (`840` → `840/s`, `12400` → `12.4k/s`). */
export function formatMissionTokenRate(perSec: number): string {
  if (!Number.isFinite(perSec) || perSec < 1) return '';
  if (perSec < 1000) return `${String(Math.round(perSec))}/s`;
  if (perSec < 1_000_000) return `${(perSec / 1000).toFixed(1)}k/s`;
  return `${(perSec / 1_000_000).toFixed(1)}M/s`;
}

type LayoutMode = 'full' | 'tight' | 'minimal';

export class MissionControlPanelComponent implements Component {
  private view: MissionControlView = emptyMissionControlView();
  /** `pinned` mode keeps the panel mounted with an idle placeholder. */
  private pinned = false;
  private lastRender:
    | {
        readonly width: number;
        readonly budget: number;
        readonly version: number;
        readonly jobs: ConductorJobsSnapshot;
        readonly workDir: string | undefined;
        readonly tick: number;
        readonly lines: string[];
      }
    | undefined;

  /** Current view — read by the hit-test chrome signature (cheap counts only). */
  get currentView(): MissionControlView {
    return this.view;
  }

  setView(view: MissionControlView): void {
    if (
      view.snapshot.version === this.view.snapshot.version &&
      view.jobs === this.view.jobs &&
      view.workDir === this.view.workDir
    ) {
      return;
    }
    this.view = view;
    this.lastRender = undefined;
  }

  setPinned(pinned: boolean): void {
    if (pinned === this.pinned) return;
    this.pinned = pinned;
    this.lastRender = undefined;
  }

  /**
   * Mount gate. Time-aware: completed workers past the linger window count
   * as gone so the dock/fallback collapses on the next ambient frame even
   * when no further event arrives.
   */
  isEmpty(now: number = appearanceAnimationNow()): boolean {
    return this.visibleWorkers(now).length === 0 && this.view.jobs.total === 0;
  }

  /** Workers minus completed ones whose linger window has elapsed. */
  private visibleWorkers(now: number): readonly MissionWorker[] {
    const workers = this.view.snapshot.workers;
    if (workers.length === 0) return workers;
    return workers.filter(
      (worker) =>
        worker.status !== 'completed' ||
        worker.terminalAtMs === undefined ||
        now - worker.terminalAtMs <= MISSION_COMPLETED_LINGER_MS,
    );
  }

  /**
   * Memo tick bucket: while anything is on the roster the panel re-renders
   * once per second even with motion off, so elapsed clocks and the linger
   * expiry advance instead of freezing between events.
   */
  private tickBucket(now: number): number {
    return this.view.snapshot.workers.length === 0 ? -1 : Math.floor(now / 1000);
  }

  invalidate(): void {
    this.lastRender = undefined;
  }

  /** In-stack fallback band (narrow terminals). */
  render(width: number): string[] {
    return this.renderFitted(width, MISSION_FALLBACK_MAX_ROWS);
  }

  /** Right workspace dock: fits exactly `height` rows (slice + pad). */
  renderDock(width: number, height: number): string[] {
    const lines = this.renderFitted(width, Math.max(0, height));
    const fitted = lines.slice(0, Math.max(0, height));
    while (fitted.length < height) fitted.push(' '.repeat(Math.max(0, width)));
    return fitted;
  }

  private renderFitted(width: number, budget: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0 || budget <= 0) return [];
    if (this.isEmpty()) {
      if (!this.pinned) return [];
      const placeholder = renderRoundedPanel({
        title: ' Mission Control ',
        content: [
          currentTheme.fg('textDim', 'No active workers —'),
          currentTheme.fg('textDim', 'subagents and background'),
          currentTheme.fg('textDim', 'tasks appear here live.'),
        ],
        width: safeWidth,
        borderToken: 'border',
        minBoxWidth: 24,
      });
      return placeholder.length <= budget ? placeholder : [];
    }
    const now = appearanceAnimationNow();
    const tick = this.tickBucket(now);
    const memo = this.lastRender;
    // Motion (pulse glyphs, settle flashes) is clock-driven: skip the memo
    // while animation runs so ambient repaints advance the frames. With
    // motion off the 1s tick bucket still advances elapsed clocks.
    if (
      memo !== undefined &&
      memo.width === safeWidth &&
      memo.budget === budget &&
      memo.version === this.view.snapshot.version &&
      memo.jobs === this.view.jobs &&
      memo.workDir === this.view.workDir &&
      (ambientAnimationActive() ? false : memo.tick === tick)
    ) {
      return memo.lines;
    }
    const lines = this.buildFramed(safeWidth, budget, now);
    this.lastRender = {
      width: safeWidth,
      budget,
      version: this.view.snapshot.version,
      jobs: this.view.jobs,
      workDir: this.view.workDir,
      tick,
      lines,
    };
    return lines;
  }

  /** Frame + progressive density: drop detail until the content fits. */
  private buildFramed(width: number, budget: number, now: number): string[] {
    const interior = Math.max(1, width - 4);
    const contentBudget = Math.max(1, budget - 2);
    for (const mode of ['full', 'tight', 'minimal'] as const) {
      const content = this.buildContent(mode, interior, contentBudget, now);
      if (content.length <= contentBudget) {
        return renderRoundedPanel({
          title: this.title(mode, now),
          content,
          width,
          borderToken: this.borderToken(now),
          minBoxWidth: 24,
        });
      }
    }
    const content = this.buildContent('minimal', interior, contentBudget, now).slice(0, contentBudget);
    return renderRoundedPanel({
      title: this.title('minimal', now),
      content,
      width,
      borderToken: this.borderToken(now),
      minBoxWidth: 24,
    });
  }

  private title(mode: LayoutMode, now: number): string {
    const workers = this.visibleWorkers(now);
    const active = workers.filter(
      (worker) =>
        worker.status === 'running' ||
        worker.status === 'stalled' ||
        worker.status === 'suspended' ||
        worker.status === 'finishing',
    );
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance) && active.length > 0;
    const activeLabel = animated
      ? renderPulseText(`${String(active.length)} active`, 'mc:title:active', 'primary', appearance)
      : `${String(active.length)} active`;
    const parts = [` ${activeLabel}`];
    if (mode === 'full') {
      const rate = active.reduce((sum, worker) => sum + (worker.tokenRatePerSec ?? 0), 0);
      const rateLabel = formatMissionTokenRate(rate);
      if (rateLabel.length > 0) {
        parts.push(
          animated
            ? renderPulseText(rateLabel, 'mc:title:rate', 'accent', appearance)
            : rateLabel,
        );
      } else {
        const tokens = active.reduce((sum, worker) => sum + worker.tokens, 0);
        if (tokens > 0) parts.push(`${formatMissionTokens(tokens)} tok`);
      }
      const elapsed = active.reduce((max, worker) => Math.max(max, worker.elapsedMs), 0);
      if (elapsed > 0) parts.push(formatJobDuration(elapsed));
    }
    return ` Mission Control ·${parts.join(' · ')} `;
  }

  private borderToken(now: number): ColorToken {
    const workers = this.visibleWorkers(now);
    if (workers.some((worker) => worker.status === 'failed')) return 'error';
    if (
      workers.some((worker) => worker.status === 'stalled') ||
      this.view.jobs.needsUser > 0 ||
      this.view.jobs.blocked > 0
    ) {
      return 'warning';
    }
    if (
      workers.some(
        (worker) =>
          worker.status === 'running' ||
          worker.status === 'suspended' ||
          worker.status === 'finishing',
      )
    ) {
      return 'primary';
    }
    return 'border';
  }

  private buildContent(mode: LayoutMode, width: number, budget: number, now: number): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const lines: string[] = [];
    const live =
      animated &&
      this.visibleWorkers(now).some(
        (worker) =>
          worker.status === 'running' ||
          worker.status === 'finishing' ||
          worker.status === 'stalled',
      );

    const workerLines = this.buildWorkerLines(mode, width, budget, animated, now);
    lines.push(...workerLines);

    if (mode !== 'minimal') {
      const opsRows = mode === 'full' ? OPS_FEED_FULL_ROWS : 3;
      const opsLines = this.buildOpsLines(width, opsRows, animated, now);
      if (opsLines.length > 0) {
        lines.push(this.sectionHeader('MOVES', live));
        lines.push(...opsLines);
      }
    }

    const jobLines =
      mode === 'minimal'
        ? this.buildJobCountsLine(width)
        : this.buildJobLines(mode, width, now);
    if (jobLines.length > 0) {
      lines.push(this.sectionHeader('BOARD', live && this.view.jobs.running > 0));
      lines.push(...jobLines);
    }
    return lines;
  }

  private sectionHeader(label: string, live = false): string {
    const appearance = getActiveAppearancePreferences();
    if (live && shouldRenderAmbientEffects(appearance)) {
      return `${renderShimmerPrefix(appearance)}${currentTheme.boldFg('textMuted', label)}`;
    }
    return currentTheme.boldFg('textMuted', label);
  }

  private workerIntent(worker: MissionWorker): string | undefined {
    const focus = worker.focusTodo?.trim();
    if (focus !== undefined && focus.length > 0) return focus;
    const description = worker.description?.trim();
    if (description !== undefined && description.length > 0) return description;
    return undefined;
  }

  private humanAction(worker: MissionWorker): string | undefined {
    if (worker.lastTool === undefined) return undefined;
    const target = formatMissionTarget(
      worker.lastTool,
      worker.lastTarget,
      this.view.workDir,
      TARGET_MAX,
    );
    return target === undefined ? worker.lastTool : `${worker.lastTool} ${target}`;
  }

  // ── workers (NOW) ─────────────────────────────────────────────────────

  private buildWorkerLines(
    mode: LayoutMode,
    width: number,
    budget: number,
    animated: boolean,
    now: number,
  ): string[] {
    const workers = this.visibleWorkers(now);
    if (workers.length === 0) return [];
    const live = workers.some(
      (worker) =>
        worker.status === 'running' ||
        worker.status === 'finishing' ||
        worker.status === 'stalled',
    );
    const lines: string[] = [this.sectionHeader('NOW', animated && live)];
    const perWorker = mode === 'full' ? 3 : 1;
    const remaining = budget - lines.length;
    let maxWorkers = Math.max(1, Math.floor(remaining / perWorker));
    if (workers.length > maxWorkers) {
      // Reserve a row for the `+N more` overflow note.
      maxWorkers = Math.max(1, maxWorkers - 1);
    }
    const visible = workers.slice(0, maxWorkers);
    for (const worker of visible) {
      if (mode === 'full') {
        for (const row of this.renderWorkerBlock(worker, animated, now, width)) {
          lines.push(row);
        }
      } else {
        lines.push(truncateToWidth(this.renderWorkerTight(worker, animated, now), width, '…'));
      }
    }
    if (workers.length > visible.length) {
      lines.push(
        currentTheme.fg('textDim', `… +${String(workers.length - visible.length)} more`),
      );
    }
    return lines;
  }

  /** Full: name → intent → action/progress (telemetry only as fallback). */
  private renderWorkerBlock(
    worker: MissionWorker,
    animated: boolean,
    now: number,
    width: number,
  ): string[] {
    const rows: string[] = [
      truncateToWidth(this.renderWorkerNameRow(worker, animated, now), width, '…'),
    ];
    if (worker.status === 'failed') {
      const reason = worker.error ?? 'failed';
      rows.push(
        truncateToWidth(`  ${currentTheme.fg('error', truncateToWidth(reason, 60, '…'))}`, width, '…'),
      );
      return rows;
    }
    if (worker.status === 'stalled') {
      const silent =
        worker.stalledSilentMs === undefined ? '' : ` ${formatJobDuration(worker.stalledSilentMs)}`;
      const last = worker.lastTool === undefined ? '' : ` — last: ${worker.lastTool}`;
      rows.push(
        truncateToWidth(
          `  ${currentTheme.fg('warning', `stalled${silent}${last}`)}`,
          width,
          '…',
        ),
      );
      return rows;
    }
    if (worker.status === 'suspended') {
      rows.push(
        truncateToWidth(
          `  ${currentTheme.fg('textDim', 'suspended — waiting for a pool slot')}`,
          width,
          '…',
        ),
      );
      return rows;
    }

    const intent = this.workerIntent(worker);
    const showedFocus =
      intent !== undefined &&
      worker.focusTodo !== undefined &&
      intent === worker.focusTodo.trim();
    if (intent !== undefined) {
      rows.push(truncateToWidth(`  ${currentTheme.fg('text', intent)}`, width, '…'));
    }

    const action = this.humanAction(worker);
    if (action !== undefined) {
      const hot =
        animated &&
        (worker.status === 'running' || worker.status === 'finishing') &&
        now - worker.lastActivityAtMs < ACTION_HOT_MS;
      const prefix = hot ? renderShimmerPrefix() : '';
      const arrow = hot
        ? renderPulseText('→', `mc-act:${worker.id}`, 'primary')
        : currentTheme.fg('textDim', '→');
      const body = hot
        ? renderPulseText(action, `mc-act-body:${worker.id}`, 'text', getActiveAppearancePreferences(), 'fast')
        : currentTheme.fg('textDim', action);
      rows.push(truncateToWidth(`  ${prefix}${arrow} ${body}`, width, '…'));
    }
    const progress = this.renderProgressLine(worker, showedFocus, animated, now);
    if (progress !== undefined) {
      rows.push(truncateToWidth(progress, width, '…'));
    }

    // Cap at name + 3 detail rows; drop progress first so intent stays.
    if (rows.length > 4) {
      return rows.slice(0, 4);
    }
    if (rows.length === 1) {
      const since = formatJobDuration(Math.max(0, now - worker.lastActivityAtMs));
      rows.push(
        truncateToWidth(`  ${currentTheme.fg('textDim', `started · idle ${since}`)}`, width, '…'),
      );
    }
    return rows;
  }

  private renderProgressLine(
    worker: MissionWorker,
    focusAlreadyShown: boolean,
    animated: boolean,
    now: number,
  ): string | undefined {
    if (worker.todoTotal === undefined || worker.todoTotal <= 0) {
      // Telemetry only when there is no todo progress to show.
      const stats: string[] = [];
      if (worker.toolCount > 0) {
        stats.push(currentTheme.fg('textMuted', `${String(worker.toolCount)} tools`));
      }
      const rate = formatMissionTokenRate(worker.tokenRatePerSec ?? 0);
      if (rate.length > 0) {
        stats.push(
          animated && (worker.status === 'running' || worker.status === 'finishing')
            ? renderPulseText(rate, `mc-rate:${worker.id}`, 'accent')
            : currentTheme.fg('textMuted', rate),
        );
      } else if (worker.tokens > 0) {
        stats.push(currentTheme.fg('textMuted', `${formatMissionTokens(worker.tokens)} tok`));
      }
      if (worker.budgetMs !== undefined && worker.budgetMs > 0) {
        const remaining = Math.max(0, worker.budgetRemainingMs ?? worker.budgetMs);
        const used = Math.round((1 - remaining / worker.budgetMs) * 100);
        stats.push(currentTheme.fg('textMuted', `budget ${String(used)}%`));
      }
      if (stats.length === 0) return undefined;
      return `  ${stats.join(currentTheme.fg('textMuted', ' · '))}`;
    }
    const done = worker.todoDone ?? 0;
    const ratio = worker.todoTotal === 0 ? 0 : done / worker.todoTotal;
    const bar =
      animated && (worker.status === 'running' || worker.status === 'finishing')
        ? this.renderLiveProgressBar(ratio, 6, now, `mc-bar:${worker.id}`)
        : renderRendererRatioProgressBar({
            ratio,
            width: 6,
            filledChar: '▓',
            emptyChar: '░',
            filledStyle: (text) => currentTheme.fg('primary', text),
            emptyStyle: (text) => currentTheme.fg('textMuted', text),
          });
    const focus = worker.focusTodo?.trim();
    const label =
      !focusAlreadyShown && focus !== undefined && focus.length > 0
        ? `next: ${focus}`
        : `${String(done)}/${String(worker.todoTotal)}`;
    const rate = formatMissionTokenRate(worker.tokenRatePerSec ?? 0);
    const rateChip =
      rate.length > 0
        ? ` ${
            animated
              ? renderPulseText(rate, `mc-rate:${worker.id}`, 'accent')
              : currentTheme.fg('textMuted', rate)
          }`
        : '';
    return `  ${bar} ${currentTheme.fg('textMuted', label)}${rateChip}`;
  }

  /** Clock-driven shimmer sweep over a ratio bar (PREMIUM.md §7). */
  private renderLiveProgressBar(
    ratio: number,
    width: number,
    now: number,
    _seed: string,
  ): string {
    const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
    const shimmerIndex =
      Math.floor(((now % BAR_SHIMMER_PERIOD_MS) / BAR_SHIMMER_PERIOD_MS) * (width + 2)) - 1;
    let bar = '';
    for (let i = 0; i < width; i += 1) {
      if (i < filled) {
        bar += currentTheme.fg(i === shimmerIndex ? 'glow' : 'primary', '▓');
      } else if (i === shimmerIndex) {
        bar += currentTheme.fg('accent', '░');
      } else {
        bar += currentTheme.fg('textMuted', '░');
      }
    }
    return bar;
  }

  private renderWorkerNameRow(worker: MissionWorker, animated: boolean, now: number): string {
    const glyph = this.workerGlyph(worker, animated);
    const terminal = worker.status === 'completed' || worker.status === 'failed';
    const namePlain = truncateToWidth(worker.name, WORKER_NAME_MAX, '…');
    const recentlyTerminal =
      terminal && worker.terminalAtMs !== undefined && now - worker.terminalAtMs < TERMINAL_FLASH_MS;
    let name: string;
    if (worker.status === 'completed' && recentlyTerminal && animated) {
      name = renderToneSettleFlash(namePlain, `mc-done:${worker.id}`, worker.terminalAtMs!, 'success');
    } else if (worker.status === 'failed' && recentlyTerminal && animated) {
      name = renderToneSettleFlash(namePlain, `mc-fail:${worker.id}`, worker.terminalAtMs!, 'error');
    } else if (
      animated &&
      worker.status === 'running' &&
      worker.elapsedMs < 900
    ) {
      // Fresh spawn pop — spectacular for the first beat of a new worker.
      name = renderPulseText(namePlain, `mc-spawn:${worker.id}`, 'primary');
    } else {
      name = currentTheme.fg(terminal ? 'textDim' : 'text', namePlain);
    }
    const model =
      worker.modelAlias === undefined
        ? ''
        : currentTheme.fg('textMuted', ` ${worker.modelAlias}`);
    const elapsed = currentTheme.fg('textDim', ` ${formatJobDuration(worker.elapsedMs)}`);
    return `${glyph} ${name}${model}${elapsed}`;
  }

  /** Tight/minimal: glyph name — intent (or short action). */
  private renderWorkerTight(worker: MissionWorker, animated: boolean, now: number): string {
    const glyph = this.workerGlyph(worker, animated);
    const namePlain = truncateToWidth(worker.name, WORKER_NAME_MAX, '…');
    const name = currentTheme.fg(
      worker.status === 'completed' || worker.status === 'failed' ? 'textDim' : 'text',
      namePlain,
    );
    const intent = this.workerIntent(worker);
    if (intent !== undefined) {
      return `${glyph} ${name}${currentTheme.fg('textDim', ` — ${intent}`)}`;
    }
    const action = this.humanAction(worker);
    if (action !== undefined) {
      return `${glyph} ${name}${currentTheme.fg('textDim', ` — ${action}`)}`;
    }
    const elapsed = currentTheme.fg('textDim', ` ${formatJobDuration(worker.elapsedMs)}`);
    return `${glyph} ${name}${elapsed}`;
  }

  private workerGlyph(worker: MissionWorker, animated: boolean): string {
    switch (worker.status) {
      case 'running':
        return animated
          ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc:${worker.id}`, '●', 'primary')
          : currentTheme.fg('primary', '●');
      case 'finishing':
        return animated
          ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc-fin:${worker.id}`, '◐', 'info')
          : currentTheme.fg('info', '◐');
      case 'stalled':
        return animated
          ? renderPulseGlyph(PULSE_BLOCKED_FRAMES, `mc-stall:${worker.id}`, '⚠', 'warning')
          : currentTheme.fg('warning', '⚠');
      case 'suspended':
        return currentTheme.fg('textDim', '○');
      case 'completed':
        return currentTheme.fg('success', '✓');
      case 'failed':
        return currentTheme.fg('error', '✗');
    }
  }

  // ── MOVES ─────────────────────────────────────────────────────────────

  private buildOpsLines(
    width: number,
    maxRows: number,
    animated: boolean,
    now: number,
  ): string[] {
    const raw = this.view.snapshot.ops;
    if (raw.length === 0) return [];
    const collapsed = collapseLowSignalOps(raw);
    const multiWorker = new Set(collapsed.map((entry) => entry.workerId)).size > 1;
    return collapsed
      .slice(-maxRows)
      .map((entry) => this.renderOpsRow(entry, width, multiWorker, animated, now));
  }

  private renderOpsRow(
    entry: MissionOpsEntry,
    width: number,
    showWorker: boolean,
    animated: boolean,
    now: number,
  ): string {
    const clock = currentTheme.fg('textMuted', formatMissionClockMs(entry.atMs));
    const worker = showWorker ? currentTheme.fg('text', ` ${entry.workerName}`) : '';
    const settledAt = entry.settledAtMs ?? entry.atMs;
    const freshlySettled =
      animated &&
      entry.status !== 'running' &&
      now - settledAt < OPS_SETTLE_FLASH_MS;
    let mark: string;
    if (entry.status === 'running') {
      mark = animated
        ? ` ${renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc-ops:${entry.toolCallId}`, '▸', 'primary')} `
        : currentTheme.fg('primary', ' ▸ ');
    } else if (entry.status === 'error') {
      mark = freshlySettled
        ? ` ${renderToneSettleFlash('✗', `mc-ops-err:${entry.toolCallId}`, settledAt, 'error')} `
        : currentTheme.fg('error', ' ✗ ');
    } else {
      mark = freshlySettled
        ? ` ${renderToneSettleFlash('✓', `mc-ops-ok:${entry.toolCallId}`, settledAt, 'success')} `
        : currentTheme.fg('success', ' ✓ ');
    }
    const human = formatMissionTarget(entry.name, entry.target, this.view.workDir, TARGET_MAX);
    const bodyPlain = `${entry.name}${human === undefined ? '' : ` ${human}`}${
      entry.chip === undefined ? '' : ` ${entry.chip}`
    }`;
    let body: string;
    if (entry.status === 'running' && animated) {
      body = `${renderShimmerPrefix()}${renderPulseText(bodyPlain, `mc-ops-body:${entry.toolCallId}`, 'text')}`;
    } else if (freshlySettled) {
      body = renderToneSettleFlash(
        bodyPlain,
        `mc-ops-body:${entry.toolCallId}`,
        settledAt,
        entry.status === 'error' ? 'error' : 'success',
      );
    } else {
      body = currentTheme.fg(entry.status === 'error' ? 'error' : 'textDim', bodyPlain);
    }
    return truncateToWidth(`${clock}${worker}${mark}${body}`, width, '…');
  }

  // ── BOARD ─────────────────────────────────────────────────────────────

  private buildJobCountsLine(width: number): string[] {
    const jobs = this.view.jobs;
    if (jobs.total === 0) return [];
    return [truncateToWidth(this.jobCountsText(), width, '…')];
  }

  private buildJobLines(mode: LayoutMode, width: number, now: number): string[] {
    const jobs = this.view.jobs;
    if (jobs.total === 0) return [];
    const lines = this.buildJobCountsLine(width);
    if (mode !== 'full') return lines;
    const attention = jobs.jobs
      .filter(
        (card) =>
          card.status === 'needs_user' ||
          card.status === 'blocked' ||
          card.status === 'running',
      )
      .toSorted((a, b) => {
        const rank = (status: string): number =>
          status === 'needs_user' ? 0 : status === 'blocked' ? 1 : 2;
        return rank(a.status) - rank(b.status) || b.updatedAtMs - a.updatedAtMs;
      })
      .slice(0, JOB_ROWS_FULL);
    for (const card of attention) {
      const token: ColorToken =
        card.status === 'needs_user' || card.status === 'blocked' ? 'warning' : 'text';
      const title = truncateToWidth(card.title, Math.max(6, width - 24), '…');
      const phase =
        card.progress?.phase !== undefined && card.progress.phase.length > 0
          ? currentTheme.fg('textDim', ` ${truncateToWidth(card.progress.phase, 12, '…')}`)
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
      lines.push(
        truncateToWidth(
          `${currentTheme.fg(token, `${SELECT_POINTER} ${shortJobId(card.id)}`)} ${currentTheme.fg(
            token,
            title,
          )}${phase}${worker}${steps}${this.jobFreshness(card, now)}`,
          width,
          '…',
        ),
      );
    }
    return lines;
  }

  private jobCountsText(): string {
    const jobs = this.view.jobs;
    const done = Math.max(
      0,
      jobs.total - jobs.running - jobs.queued - jobs.blocked - jobs.needsUser - jobs.interrupted - jobs.failed,
    );
    const parts = [
      jobs.needsUser + jobs.blocked > 0
        ? currentTheme.fg('warning', `needs-you ${String(jobs.needsUser + jobs.blocked)}`)
        : undefined,
      jobs.running > 0 ? currentTheme.fg('primary', `running ${String(jobs.running)}`) : undefined,
      jobs.queued > 0 ? currentTheme.fg('info', `queued ${String(jobs.queued)}`) : undefined,
      jobs.failed > 0 ? currentTheme.fg('error', `failed ${String(jobs.failed)}`) : undefined,
      currentTheme.fg('textDim', `done ${String(done)}`),
    ].filter((part): part is string => part !== undefined);
    return parts.join(currentTheme.fg('textMuted', ' · '));
  }

  private jobFreshness(card: ConductorJobsSnapshot['jobs'][number], now: number): string {
    if (card.statusChangedAtMs === undefined) return '';
    const age = now - card.statusChangedAtMs;
    if (age > 60_000) return '';
    return currentTheme.fg('textMuted', ` ${formatJobDuration(age)} ago`);
  }
}
