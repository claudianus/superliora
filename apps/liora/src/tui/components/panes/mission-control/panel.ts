/**
 * MissionControlPanel — the single live-monitoring surface for every
 * background worker (subagents, background agents/processes, swarm members)
 * plus a condensed Conductor job lane summary. Renders two ways:
 *
 * - `renderDock(width, height)` — right workspace dock (wide terminals);
 *   fills the exact dock rect.
 * - `render(width)` — in-stack chrome band fallback (narrow terminals),
 *   capped at {@link MISSION_FALLBACK_MAX_ROWS} rows.
 *
 * Presentation only: the controller pushes an immutable
 * {@link MissionControlView} (registry snapshot + conductor jobs). Motion
 * flows through the shared appearance clock and degrades to static marks
 * under off / SSH / NO_COLOR / CI per PREMIUM.md §7.
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
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import {
  MISSION_COMPLETED_LINGER_MS,
  type MissionControlSnapshot,
  type MissionWorker,
} from '#/tui/controllers/mission-control/registry';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import {
  emptyConductorJobsSnapshot,
  formatJobDuration,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

/** Stack-fallback band never grows past this many rows. */
export const MISSION_FALLBACK_MAX_ROWS = 14;
/** Ops-feed rows in the full layout (tight/minimal degrade first). */
const OPS_FEED_FULL_ROWS = 6;
/** Job rows under the counts line in the full layout. */
const JOB_ROWS_FULL = 2;
/** Settle-flash window after a worker reaches a terminal state. */
const TERMINAL_FLASH_MS = 2_000;
/** Worker name column cap so telemetry keeps room on narrow docks. */
const WORKER_NAME_MAX = 16;

export interface MissionControlView {
  readonly snapshot: MissionControlSnapshot;
  readonly jobs: ConductorJobsSnapshot;
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

/** `HH:MM:SS` wall-clock for ops-feed rows (tests derive via this helper). */
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
        readonly tick: number;
        readonly lines: string[];
      }
    | undefined;

  /** Current view — read by the hit-test chrome signature (cheap counts only). */
  get currentView(): MissionControlView {
    return this.view;
  }

  setView(view: MissionControlView): void {
    if (view.snapshot.version === this.view.snapshot.version && view.jobs === this.view.jobs) {
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
          title: this.title(now),
          content,
          width,
          borderToken: this.borderToken(now),
          minBoxWidth: 24,
        });
      }
    }
    const content = this.buildContent('minimal', interior, contentBudget, now).slice(0, contentBudget);
    return renderRoundedPanel({
      title: this.title(now),
      content,
      width,
      borderToken: this.borderToken(now),
      minBoxWidth: 24,
    });
  }

  private title(now: number): string {
    const workers = this.visibleWorkers(now);
    const active = workers.filter(
      (worker) =>
        worker.status === 'running' ||
        worker.status === 'stalled' ||
        worker.status === 'suspended' ||
        worker.status === 'finishing',
    );
    const tokens = active.reduce((sum, worker) => sum + worker.tokens, 0);
    const parts = [` ${String(active.length)} active`];
    if (tokens > 0) parts.push(`${formatMissionTokens(tokens)} tok`);
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

    const workerLines = this.buildWorkerLines(mode, width, budget, animated, now);
    lines.push(...workerLines);

    if (mode !== 'minimal') {
      const opsRows = mode === 'full' ? OPS_FEED_FULL_ROWS : 3;
      const opsLines = this.buildOpsLines(width, opsRows);
      if (opsLines.length > 0) {
        lines.push(this.sectionHeader('OPS FEED'));
        lines.push(...opsLines);
      }
    }

    const jobLines =
      mode === 'minimal'
        ? this.buildJobCountsLine(width)
        : this.buildJobLines(mode, width, now);
    if (jobLines.length > 0) {
      lines.push(this.sectionHeader('JOBS'));
      lines.push(...jobLines);
    }
    return lines;
  }

  private sectionHeader(label: string): string {
    return currentTheme.boldFg('textMuted', label);
  }

  // ── workers ───────────────────────────────────────────────────────────

  private buildWorkerLines(
    mode: LayoutMode,
    width: number,
    budget: number,
    animated: boolean,
    now: number,
  ): string[] {
    const workers = this.visibleWorkers(now);
    if (workers.length === 0) return [];
    const lines: string[] = [this.sectionHeader('WORKERS')];
    const perWorker = mode === 'full' ? 2 : 1;
    const remaining = budget - lines.length;
    let maxWorkers = Math.max(1, Math.floor(remaining / perWorker));
    if (workers.length > maxWorkers) {
      // Reserve a row for the `+N more` overflow note.
      maxWorkers = Math.max(1, maxWorkers - 1);
    }
    const visible = workers.slice(0, maxWorkers);
    for (const worker of visible) {
      lines.push(truncateToWidth(this.renderWorkerRow(worker, animated, now), width, '…'));
      if (mode === 'full') {
        const detail = this.renderWorkerDetail(worker, now);
        if (detail !== undefined) lines.push(truncateToWidth(detail, width, '…'));
      }
    }
    if (workers.length > visible.length) {
      lines.push(
        currentTheme.fg('textDim', `… +${String(workers.length - visible.length)} more`),
      );
    }
    return lines;
  }

  private renderWorkerRow(worker: MissionWorker, animated: boolean, now: number): string {
    const glyph = this.workerGlyph(worker, animated);
    const terminal = worker.status === 'completed' || worker.status === 'failed';
    const namePlain = truncateToWidth(worker.name, WORKER_NAME_MAX, '…');
    const recentlyTerminal =
      terminal && worker.terminalAtMs !== undefined && now - worker.terminalAtMs < TERMINAL_FLASH_MS;
    const name =
      worker.status === 'completed' && recentlyTerminal && animated
        ? renderToneSettleFlash(namePlain, `mc-done:${worker.id}`, worker.terminalAtMs!, 'success')
        : currentTheme.fg(terminal ? 'textDim' : 'text', namePlain);
    const model =
      worker.modelAlias === undefined
        ? ''
        : currentTheme.fg('textMuted', ` ${worker.modelAlias}`);
    const action =
      worker.lastTool === undefined
        ? ''
        : currentTheme.fg(
            'textDim',
            ` ${worker.lastTool}${worker.lastTarget === undefined ? '' : ` ${worker.lastTarget}`}`,
          );
    const elapsed = currentTheme.fg('textDim', ` ${formatJobDuration(worker.elapsedMs)}`);
    return `${glyph} ${name}${model}${action}${elapsed}`;
  }

  private renderWorkerDetail(worker: MissionWorker, now: number): string | undefined {
    const indent = '  ';
    if (worker.status === 'failed') {
      const reason = worker.error ?? 'failed';
      return `${indent}${currentTheme.fg('error', truncateToWidth(reason, 60, '…'))}`;
    }
    if (worker.status === 'stalled') {
      const silent =
        worker.stalledSilentMs === undefined ? '' : ` ${formatJobDuration(worker.stalledSilentMs)}`;
      const last = worker.lastTool === undefined ? '' : ` — last: ${worker.lastTool}`;
      return `${indent}${currentTheme.fg('warning', `stalled${silent}${last}`)}`;
    }
    if (worker.status === 'suspended') {
      return `${indent}${currentTheme.fg('textDim', 'suspended — waiting for a pool slot')}`;
    }
    const parts: string[] = [];
    if (worker.todoTotal !== undefined && worker.todoTotal > 0) {
      const done = worker.todoDone ?? 0;
      const bar = renderRendererRatioProgressBar({
        ratio: worker.todoTotal === 0 ? 0 : done / worker.todoTotal,
        width: 6,
        filledChar: '▓',
        emptyChar: '░',
        filledStyle: (text) => currentTheme.fg('primary', text),
        emptyStyle: (text) => currentTheme.fg('textMuted', text),
      });
      parts.push(`${bar} ${currentTheme.fg('textMuted', `todo ${String(done)}/${String(worker.todoTotal)}`)}`);
    }
    const stats: string[] = [];
    if (worker.toolCount > 0) stats.push(`${String(worker.toolCount)} tools`);
    if (worker.tokens > 0) stats.push(`${formatMissionTokens(worker.tokens)} tok`);
    if (stats.length > 0) parts.push(currentTheme.fg('textMuted', stats.join(' · ')));
    if (worker.budgetMs !== undefined && worker.budgetMs > 0) {
      const remaining = Math.max(0, worker.budgetRemainingMs ?? worker.budgetMs);
      const used = Math.round((1 - remaining / worker.budgetMs) * 100);
      const token: ColorToken = worker.status === 'finishing' || used >= 85 ? 'warning' : 'textMuted';
      parts.push(currentTheme.fg(token, `budget ${String(used)}%`));
    }
    if (parts.length === 0) {
      // Freshly spawned workers still get a heartbeat-free detail line so the
      // roster never reads as frozen.
      const since = formatJobDuration(Math.max(0, now - worker.lastActivityAtMs));
      return `${indent}${currentTheme.fg('textDim', `started · idle ${since}`)}`;
    }
    return `${indent}${parts.join(currentTheme.fg('textMuted', ' · '))}`;
  }

  private workerGlyph(worker: MissionWorker, animated: boolean): string {
    switch (worker.status) {
      case 'running':
        return animated
          ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc:${worker.id}`, '●', 'primary')
          : currentTheme.fg('primary', '●');
      case 'finishing':
        return currentTheme.fg('info', '◐');
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

  // ── ops feed ──────────────────────────────────────────────────────────

  private buildOpsLines(width: number, maxRows: number): string[] {
    const ops = this.view.snapshot.ops;
    if (ops.length === 0) return [];
    return ops.slice(-maxRows).map((entry) => {
      const clock = currentTheme.fg('textMuted', formatMissionClockMs(entry.atMs));
      const name = currentTheme.fg('text', ` ${entry.workerName}`);
      const mark =
        entry.status === 'error'
          ? currentTheme.fg('error', ' ✗ ')
          : entry.status === 'ok'
            ? currentTheme.fg('success', ' ✓ ')
            : currentTheme.fg('primary', ' ▸ ');
      const body = currentTheme.fg(
        entry.status === 'error' ? 'error' : 'textDim',
        `${entry.name}${entry.target === undefined ? '' : ` ${entry.target}`}${
          entry.chip === undefined ? '' : ` ${entry.chip}`
        }`,
      );
      return truncateToWidth(`${clock}${name}${mark}${body}`, width, '…');
    });
  }

  // ── job lanes ─────────────────────────────────────────────────────────

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
          )}${worker}${steps}${this.jobFreshness(card, now)}`,
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
