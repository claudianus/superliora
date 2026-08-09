/**
 * MissionControlPanel — the single live-monitoring surface for every
 * background worker (subagents, background agents/processes, swarm members)
 * plus a condensed Conductor job lane summary. Renders as an in-stage bottom
 * band at the stage's full reading width (capped at
 * {@link MISSION_BAND_MAX_ROWS} rows).
 *
 * Presentation only: the controller pushes an immutable
 * {@link MissionControlView} (registry snapshot + conductor jobs). Motion
 * flows through the shared appearance clock and degrades to static marks
 * under off / SSH / NO_COLOR / CI per PREMIUM.md §7. Paint budget:
 * spectacular / pulse only on narrow signals (glyph, mark, bar, title chips,
 * short settle flashes) — never on body copy (live text, action, MOVES body).
 *
 * Information hierarchy: intent → action → telemetry (paths never dominate).
 */

import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES, PULSE_BLOCKED_FRAMES } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import {
  ambientAnimationActive,
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseGlyph,
  renderPulseText,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { missionBandProductName } from '#/tui/features/mission-control/labels';
import {
  MISSION_COMPLETED_LINGER_MS,
  type MissionControlSnapshot,
  type MissionOpsEntry,
  type MissionWorker,
} from '#/tui/controllers/mission-control/registry';
import {
  CHROME_BAND_LEFT_MARGIN,
  CHROME_BAND_SIDE_PADDING,
  chromeBandInteriorWidth,
  renderRoundedPanel,
} from '#/tui/utils/ui/panel-frame';
import {
  renderLiveRatioBar,
  renderLiveSectionHeader,
} from '#/tui/components/chrome/chrome-band-motion';
import {
  emptyConductorJobsSnapshot,
  formatJobDuration,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';
import { applyStreamTailGlow } from '#/tui/features/transcript/transcript-entrance';
import { formatMissionTarget } from '#/tui/utils/tools/mission-target';
import {
  createStreamingTextRevealState,
  isRevealCaughtUp,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
  type StreamingTextRevealState,
} from '#/tui/utils/streaming/streaming-text-reveal';
import { printableChar } from '#/tui/utils/printable-key';
import {
  buildDenseContent,
  clampWorkerScrollOffset,
  DENSE_WORKER_CAP,
  formatAttentionJobRow,
  formatMissionJobCounts,
  formatRateSparkline,
  resolveDenseOps,
  selectAttentionJobs,
  shouldUseDensemode,
} from './densemode';
import { getHoverRegionId } from '#/tui/features/mission-control/worker-hover';
import {
  paintWorkerRowChrome,
  workerHoverPaintPending,
} from '#/tui/features/mission-control/worker-row-paint';
import { ttui } from '#/tui/utils/tui-i18n';

export type MissionWorkerScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'top'
  | 'bottom';

/** Hit-test result for a painted mission-band content row (0 = first content line). */
export type MissionWorkerHit =
  | { readonly kind: 'worker'; readonly workerId: string; readonly index: number }
  | { readonly kind: 'header' }
  | { readonly kind: 'other' };

import {
  formatMissionAgeMs,
  formatMissionClockMs,
  formatMissionTokenRate,
  formatMissionTokens,
  MISSION_LIVE_HOT_MS,
} from './mission-format';

export {
  formatMissionAgeMs,
  formatMissionClockMs,
  formatMissionTokenRate,
  formatMissionTokens,
  MISSION_LIVE_HOT_MS,
} from './mission-format';

/** In-stage bottom band never grows past this many rows. */
export const MISSION_BAND_MAX_ROWS = 14;
/** @deprecated Use {@link MISSION_BAND_MAX_ROWS}. */
export const MISSION_FALLBACK_MAX_ROWS = MISSION_BAND_MAX_ROWS;
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
/** Worker name column cap so intent keeps room on narrow docks. */
const WORKER_NAME_MAX = 16;
/** Target budget inside a ~40col dock interior. */
const TARGET_MAX = 22;
/** Soft cap so a single stream line does not dominate ultra-wide terminals. */
const LIVE_TEXT_SOFT_CAP = 96;
/** Soft cap for tool targets on wide docks. */
const TARGET_SOFT_CAP = 56;
/** Display tok/s ease toward target per ambient frame (0–1). */
const RATE_LERP_ALPHA = 0.28;

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

type LayoutMode = 'full' | 'tight' | 'minimal';

export class MissionControlPanelComponent implements Component {
  private view: MissionControlView = emptyMissionControlView();
  /** `pinned` mode keeps the panel mounted with an idle placeholder. */
  private pinned = false;
  /** Window start into the sorted worker roster (densemode / NOW). */
  private workerScrollOffset = 0;
  /** Last painted worker-row viewport size (for scroll clamp before next paint). */
  private lastWorkerSlots = DENSE_WORKER_CAP;
  /** Keyboard / click selection into the visible roster (worker id). */
  private selectedWorkerId: string | undefined;
  /**
   * Last paint: content-local row index → worker id (densemode worker rows).
   * Index 0 is the first interior content line (below the top border).
   */
  private lastWorkerRowMap: ReadonlyMap<number, string> = new Map();
  /** Content-local row of the band header / KPI line (hover glow). */
  private lastHeaderRow: number | undefined;
  /** Per-worker stream reveal (catch-up type-on for liveText). */
  private readonly revealByWorker = new Map<string, StreamingTextRevealState>();
  /** Per-worker displayed tok/s after ease toward the registry rate. */
  private readonly displayRateByWorker = new Map<string, number>();
  private lastRevealTickMs = 0;
  private lastRender:
    | {
        readonly width: number;
        readonly budget: number;
        readonly version: number;
        readonly jobs: ConductorJobsSnapshot;
        readonly workDir: string | undefined;
        readonly tick: number;
        readonly revealPending: boolean;
        readonly scrollOffset: number;
        readonly selectedWorkerId: string | undefined;
        readonly hoverRegionId: string | undefined;
        readonly lines: string[];
      }
    | undefined;

  /** Current view — read by the hit-test chrome signature (cheap counts only). */
  get currentView(): MissionControlView {
    return this.view;
  }

  /** Selected worker id (keyboard / click), if still on the roster. */
  get selectedWorker(): string | undefined {
    return this.selectedWorkerId;
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
    this.pruneSelection();
    this.lastRender = undefined;
  }

  setPinned(pinned: boolean): void {
    if (pinned === this.pinned) return;
    this.pinned = pinned;
    this.lastRender = undefined;
  }

  /** Select a worker by id (no-op when missing). Returns true when changed. */
  selectWorker(workerId: string | undefined): boolean {
    if (workerId === this.selectedWorkerId) return false;
    if (workerId !== undefined) {
      const now = appearanceAnimationNow();
      const exists = this.visibleWorkers(now).some((worker) => worker.id === workerId);
      if (!exists) return false;
    }
    this.selectedWorkerId = workerId;
    this.lastRender = undefined;
    return true;
  }

  /**
   * Move selection within the visible roster. When nothing is selected yet,
   * arrow-down picks the first worker and arrow-up the last.
   * Returns true when selection or scroll window changed.
   */
  moveSelection(delta: number): boolean {
    const workers = this.visibleWorkers(appearanceAnimationNow());
    if (workers.length === 0) return false;
    const ids = workers.map((worker) => worker.id);
    let index = this.selectedWorkerId === undefined ? -1 : ids.indexOf(this.selectedWorkerId);
    if (index < 0) {
      index = delta >= 0 ? 0 : ids.length - 1;
    } else {
      index = Math.max(0, Math.min(ids.length - 1, index + delta));
    }
    const nextId = ids[index]!;
    let changed = this.selectWorker(nextId);
    // Keep the selected row inside the densemode window.
    const slots = Math.max(1, Math.min(this.lastWorkerSlots, workers.length));
    if (workers.length > slots) {
      if (index < this.workerScrollOffset) {
        changed = this.scrollWorkers('line-up') || changed;
        // Jump window so selection is first visible.
        const target = clampWorkerScrollOffset(index, workers.length, slots);
        if (target !== this.workerScrollOffset) {
          this.workerScrollOffset = target;
          this.lastRender = undefined;
          changed = true;
        }
      } else if (index >= this.workerScrollOffset + slots) {
        const target = clampWorkerScrollOffset(index - slots + 1, workers.length, slots);
        if (target !== this.workerScrollOffset) {
          this.workerScrollOffset = target;
          this.lastRender = undefined;
          changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * Map a band-local screen row (0 = top of mission rect, including border)
   * to a worker / header hit. Uses the last paint's content row map.
   */
  hitTestWorkerRow(bandLocalY: number, bandHeight: number): MissionWorkerHit | undefined {
    if (bandHeight <= 0) return undefined;
    // Rounded panel: top border is row 0; content starts at 1; bottom border last.
    const contentRow = bandLocalY - 1;
    if (contentRow < 0) return { kind: 'header' };
    if (this.lastHeaderRow !== undefined && contentRow === this.lastHeaderRow) {
      return { kind: 'header' };
    }
    const workerId = this.lastWorkerRowMap.get(contentRow);
    if (workerId !== undefined) {
      const workers = this.visibleWorkers(appearanceAnimationNow());
      const index = workers.findIndex((worker) => worker.id === workerId);
      return { kind: 'worker', workerId, index: Math.max(0, index) };
    }
    if (contentRow === 0) return { kind: 'header' };
    return { kind: 'other' };
  }

  private pruneSelection(): void {
    if (this.selectedWorkerId === undefined) return;
    const now = appearanceAnimationNow();
    const still = this.visibleWorkers(now).some((worker) => worker.id === this.selectedWorkerId);
    if (!still) this.selectedWorkerId = undefined;
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

  /**
   * Move the worker-list window. Returns true only when the offset shifted
   * so wheel / key handlers can fall through at the edges.
   */
  scrollWorkers(action: MissionWorkerScrollAction): boolean {
    const workers = this.visibleWorkers(Date.now());
    const slots = Math.max(1, Math.min(this.lastWorkerSlots, workers.length));
    if (workers.length <= slots) {
      if (this.workerScrollOffset === 0) return false;
      this.workerScrollOffset = 0;
      this.lastRender = undefined;
      return true;
    }
    let next = this.workerScrollOffset;
    switch (action) {
      case 'line-up':
        next -= 1;
        break;
      case 'line-down':
        next += 1;
        break;
      case 'page-up':
        next -= Math.max(1, slots - 1);
        break;
      case 'page-down':
        next += Math.max(1, slots - 1);
        break;
      case 'top':
        next = 0;
        break;
      case 'bottom':
        next = Number.MAX_SAFE_INTEGER;
        break;
    }
    const clamped = clampWorkerScrollOffset(next, workers.length, slots);
    if (clamped === this.workerScrollOffset) return false;
    this.workerScrollOffset = clamped;
    this.lastRender = undefined;
    return true;
  }

  /**
   * ↑↓ move selection (and window when needed); j/k still scroll the window;
   * Enter is handled by the host (open transcript). Page/Home/End scroll.
   */
  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
      return;
    }
    if (printableChar(data) === 'k') {
      this.scrollWorkers('line-up');
      return;
    }
    if (printableChar(data) === 'j') {
      this.scrollWorkers('line-down');
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollWorkers('page-up');
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollWorkers('page-down');
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.scrollWorkers('top');
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.scrollWorkers('bottom');
    }
  }

  /**
   * Host keyboard path: ↑↓ select, Enter opens (caller), Esc clears selection.
   * Returns true when the panel consumed the key.
   */
  handleSelectionKey(
    key: 'up' | 'down' | 'enter' | 'escape' | 'pageup' | 'pagedown' | 'home' | 'end',
  ): { readonly handled: boolean; readonly openWorkerId?: string; readonly clearSelection?: boolean } {
    switch (key) {
      case 'up':
        return { handled: this.moveSelection(-1) || this.visibleWorkers(appearanceAnimationNow()).length > 0 };
      case 'down':
        return { handled: this.moveSelection(1) || this.visibleWorkers(appearanceAnimationNow()).length > 0 };
      case 'pageup':
        return { handled: this.scrollWorkers('page-up') };
      case 'pagedown':
        return { handled: this.scrollWorkers('page-down') };
      case 'home':
        return { handled: this.scrollWorkers('top') };
      case 'end':
        return { handled: this.scrollWorkers('bottom') };
      case 'enter': {
        const id = this.selectedWorkerId;
        if (id === undefined) {
          // First Enter with no selection focuses the first worker.
          if (!this.moveSelection(1) && !this.moveSelection(-1)) {
            return { handled: false };
          }
          return { handled: true, openWorkerId: this.selectedWorkerId };
        }
        return { handled: true, openWorkerId: id };
      }
      case 'escape': {
        if (this.selectedWorkerId === undefined) return { handled: false };
        this.selectWorker(undefined);
        return { handled: true, clearSelection: true };
      }
      default:
        return { handled: false };
    }
  }

  /** In-stage bottom band (full stage reading width). */
  render(width: number): string[] {
    return this.renderFitted(width, MISSION_BAND_MAX_ROWS);
  }

  /**
   * Fit into an exact row budget (tests / callers that need a fixed height).
   * Pads with blank lines when the content is shorter than `height`.
   */
  renderFittedBand(width: number, height: number): string[] {
    const lines = this.renderFitted(width, Math.max(0, height));
    const fitted = lines.slice(0, Math.max(0, height));
    while (fitted.length < height) fitted.push(' '.repeat(Math.max(0, width)));
    return fitted;
  }

  /** @deprecated Use {@link renderFittedBand}. */
  renderDock(width: number, height: number): string[] {
    return this.renderFittedBand(width, height);
  }

  private renderFitted(width: number, budget: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0 || budget <= 0) return [];
    if (this.isEmpty()) {
      if (!this.pinned) return [];
      const placeholder = renderRoundedPanel({
        title: ` ${missionBandProductName()} `,
        content: [
          currentTheme.fg('textDim', 'No active workers —'),
          currentTheme.fg('textDim', 'subagents and background'),
          currentTheme.fg('textDim', 'tasks appear here live.'),
        ],
        width: safeWidth,
        borderToken: 'border',
        leftMargin: CHROME_BAND_LEFT_MARGIN,
        sidePadding: CHROME_BAND_SIDE_PADDING,
        minBoxWidth: 24,
        fillWidth: true,
      });
      return placeholder.length <= budget ? placeholder : [];
    }
    const now = appearanceAnimationNow();
    const revealPending = this.syncRevealAndRates(now);
    const hoverPending = workerHoverPaintPending(this.selectedWorkerId, getActiveAppearancePreferences(), now)
      || workerHoverPaintPending(
        getHoverRegionId()?.startsWith('mc:worker:')
          ? getHoverRegionId()!.slice('mc:worker:'.length)
          : undefined,
        getActiveAppearancePreferences(),
        now,
      );
    const tick = this.tickBucket(now);
    const memo = this.lastRender;
    const hoverId = getHoverRegionId();
    // Motion / stream reveal is clock-driven: skip the memo while animation
    // or catch-up reveal runs so ambient repaints advance frames. With motion
    // off the 1s tick bucket still advances elapsed clocks.
    if (
      memo !== undefined &&
      memo.width === safeWidth &&
      memo.budget === budget &&
      memo.version === this.view.snapshot.version &&
      memo.jobs === this.view.jobs &&
      memo.workDir === this.view.workDir &&
      memo.scrollOffset === this.workerScrollOffset &&
      memo.selectedWorkerId === this.selectedWorkerId &&
      memo.hoverRegionId === hoverId &&
      memo.revealPending === revealPending &&
      !revealPending &&
      !hoverPending &&
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
      revealPending: revealPending || hoverPending,
      scrollOffset: this.workerScrollOffset,
      selectedWorkerId: this.selectedWorkerId,
      hoverRegionId: hoverId,
      lines,
    };
    return lines;
  }

  /**
   * Advance per-worker stream reveal + tok/s lerp. Returns true when any
   * reveal is still catching up (forces ambient content invalidate).
   */
  private syncRevealAndRates(now: number): boolean {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const workers = this.visibleWorkers(now);
    const liveIds = new Set(workers.map((worker) => worker.id));
    for (const id of this.revealByWorker.keys()) {
      if (!liveIds.has(id)) this.revealByWorker.delete(id);
    }
    for (const id of this.displayRateByWorker.keys()) {
      if (!liveIds.has(id)) this.displayRateByWorker.delete(id);
    }

    let revealPending = false;
    const dtMs =
      this.lastRevealTickMs > 0 ? Math.max(0, now - this.lastRevealTickMs) : 16;
    this.lastRevealTickMs = now;

    for (const worker of workers) {
      const targetRate = worker.tokenRatePerSec ?? 0;
      const prevRate = this.displayRateByWorker.get(worker.id) ?? targetRate;
      const nextRate =
        !animated || dtMs <= 0
          ? targetRate
          : prevRate + (targetRate - prevRate) * RATE_LERP_ALPHA;
      this.displayRateByWorker.set(worker.id, nextRate);

      const liveTarget = worker.liveText ?? '';
      let state = this.revealByWorker.get(worker.id);
      if (liveTarget.length === 0) {
        if (state !== undefined) this.revealByWorker.delete(worker.id);
        continue;
      }
      if (state === undefined) {
        state = createStreamingTextRevealState(now);
      }
      state = setRevealTarget(state, liveTarget, now);
      if (!animated) {
        state = snapRevealToTarget(state, now);
      } else if (!isRevealCaughtUp(state)) {
        state = tickReveal(state, now);
      }
      this.revealByWorker.set(worker.id, state);
      if (!isRevealCaughtUp(state)) revealPending = true;
    }
    return revealPending;
  }

  private revealedLiveMap(now: number): Map<string, string> {
    const map = new Map<string, string>();
    for (const worker of this.visibleWorkers(now)) {
      const state = this.revealByWorker.get(worker.id);
      if (state !== undefined && state.target.length > 0) {
        map.set(worker.id, visibleText(state));
      } else if (worker.liveText !== undefined && worker.liveText.length > 0) {
        map.set(worker.id, worker.liveText);
      }
    }
    return map;
  }

  private displayRateMap(): Map<string, number> {
    return new Map(this.displayRateByWorker);
  }

  /** Frame + progressive density: densemode for any worker, else stack fallback. */
  private buildFramed(width: number, budget: number, now: number): string[] {
    const interior = chromeBandInteriorWidth(width);
    const contentBudget = Math.max(1, budget - 2);
    const workers = this.visibleWorkers(now);
    const frameOpts = {
      width,
      leftMargin: CHROME_BAND_LEFT_MARGIN,
      sidePadding: CHROME_BAND_SIDE_PADDING,
      minBoxWidth: 24,
      fillWidth: true as const,
    };
    if (shouldUseDensemode(workers)) {
      const appearance = getActiveAppearancePreferences();
      const animated = shouldRenderAmbientEffects(appearance);
      const dense = buildDenseContent({
        workers,
        ops: this.view.snapshot.ops,
        width: interior,
        budget: contentBudget,
        now,
        workDir: this.view.workDir,
        animated,
        appearance,
        revealedLive: this.revealedLiveMap(now),
        displayRate: this.displayRateMap(),
        workerGlyph: (worker) => this.workerGlyph(worker, animated),
        scrollOffset: this.workerScrollOffset,
        jobs: this.view.jobs,
        selectedWorkerId: this.selectedWorkerId,
        paintRowChrome: (worker) =>
          paintWorkerRowChrome({
            workerId: worker.id,
            selected: worker.id === this.selectedWorkerId,
            appearance,
            animated,
          }),
      });
      this.workerScrollOffset = dense.scrollOffset;
      if (dense.workerSlots > 0) this.lastWorkerSlots = dense.workerSlots;
      // Record content-local hit map for mouse (KPI=0, optional ticker, header, then workers).
      this.lastWorkerRowMap = dense.workerRowMap;
      this.lastHeaderRow = dense.headerRow;
      const content = [...dense.lines];
      if (workers.length > 0 && content.length < contentBudget) {
        content.push(
          currentTheme.fg('textMuted', ` ${ttui('tui.missionControl.dockHint')}`),
        );
      }
      if (content.length > 0 && content.length <= contentBudget) {
        return renderRoundedPanel({
          ...frameOpts,
          title: this.title('dense', now),
          content,
          borderToken: this.borderToken(now),
        });
      }
    }
    for (const mode of ['full', 'tight', 'minimal'] as const) {
      const content = this.buildContent(mode, interior, contentBudget, now);
      if (content.length <= contentBudget) {
        return renderRoundedPanel({
          ...frameOpts,
          title: this.title(mode, now),
          content,
          borderToken: this.borderToken(now),
        });
      }
    }
    const content = this.buildContent('minimal', interior, contentBudget, now).slice(0, contentBudget);
    return renderRoundedPanel({
      ...frameOpts,
      title: this.title('minimal', now),
      content,
      borderToken: this.borderToken(now),
    });
  }

  private title(mode: LayoutMode | 'dense', now: number): string {
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
    if (mode === 'dense') {
      const workerCount = workers.length;
      const workersLabel = `${String(workerCount)} worker${workerCount === 1 ? '' : 's'}`;
      const fleet = animated
        ? renderPulseText(workersLabel, 'mc:title:fleet', 'primary', appearance)
        : workersLabel;
      const rate = active.reduce(
        (sum, worker) => sum + (this.displayRateByWorker.get(worker.id) ?? worker.tokenRatePerSec ?? 0),
        0,
      );
      const rateLabel = formatMissionTokenRate(rate);
      const parts = [` ${fleet}`];
      if (rateLabel.length > 0) {
        parts.push(
          animated
            ? renderPulseText(`Σ${rateLabel}`, 'mc:title:rate', 'accent', appearance)
            : `Σ${rateLabel}`,
        );
      } else {
        const tokens = active.reduce((sum, worker) => sum + worker.tokens, 0);
        if (tokens > 0) parts.push(`${formatMissionTokens(tokens)} tok`);
      }
      const elapsed = active.reduce((max, worker) => Math.max(max, worker.elapsedMs), 0);
      if (elapsed > 0) parts.push(formatJobDuration(elapsed));
      return ` ${missionBandProductName()} ·${parts.join(' · ')} `;
    }
    const activeLabel = animated
      ? renderPulseText(`${String(active.length)} active`, 'mc:title:active', 'primary', appearance)
      : `${String(active.length)} active`;
    const parts = [` ${activeLabel}`];
    if (mode === 'full') {
      const rate = active.reduce(
        (sum, worker) => sum + (this.displayRateByWorker.get(worker.id) ?? worker.tokenRatePerSec ?? 0),
        0,
      );
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
    return ` ${missionBandProductName()} ·${parts.join(' · ')} `;
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
    return renderLiveSectionHeader(label, live, 'mc:sec');
  }

  private workerIntent(worker: MissionWorker): string | undefined {
    const focus = worker.focusTodo?.trim();
    if (focus !== undefined && focus.length > 0) return focus;
    const description = worker.description?.trim();
    if (description !== undefined && description.length > 0) return description;
    return undefined;
  }

  /** Hot child thinking/answer tail for the NOW live strip. */
  private hotLiveStream(
    worker: MissionWorker,
    now: number,
  ): { kind: 'thinking' | 'answer'; text: string } | undefined {
    if (worker.liveText === undefined || worker.liveText.length === 0) return undefined;
    if (worker.liveKind === undefined || worker.liveAtMs === undefined) return undefined;
    if (now - worker.liveAtMs >= MISSION_LIVE_HOT_MS) return undefined;
    if (worker.status !== 'running' && worker.status !== 'finishing') return undefined;
    return { kind: worker.liveKind, text: worker.liveText };
  }

  private humanAction(worker: MissionWorker, targetBudget: number = TARGET_MAX): string | undefined {
    if (worker.lastTool === undefined) return undefined;
    const target = formatMissionTarget(
      worker.lastTool,
      worker.lastTarget,
      this.view.workDir,
      targetBudget,
    );
    return target === undefined ? worker.lastTool : `${worker.lastTool} ${target}`;
  }

  /** Grow live/target budgets with the dock interior; soft-cap on ultra-wide. */
  private liveTextBudget(width: number): number {
    return Math.max(TARGET_MAX, Math.min(LIVE_TEXT_SOFT_CAP, width - 6));
  }

  private targetBudget(width: number): number {
    return Math.max(TARGET_MAX, Math.min(TARGET_SOFT_CAP, Math.floor(width * 0.45)));
  }

  private renderLiveStreamRow(
    worker: MissionWorker,
    live: { kind: 'thinking' | 'answer'; text: string },
    animated: boolean,
    width: number,
  ): string {
    const appearance = getActiveAppearancePreferences();
    const revealed = this.revealByWorker.get(worker.id);
    const source =
      revealed !== undefined && revealed.target.length > 0 ? visibleText(revealed) : live.text;
    const plain = truncateToWidth(source, this.liveTextBudget(width), '…');
    const mark = live.kind === 'thinking' ? '◌' : '◆';
    const markPaint = currentTheme.fg(
      live.kind === 'thinking' ? 'textMuted' : 'primary',
      mark,
    );
    // Body stays static semantic text; optional tail glow on newest clusters only.
    const tinted = currentTheme.fg(live.kind === 'thinking' ? 'textDim' : 'text', plain);
    let body = `${markPaint} ${tinted}`;
    if (animated && shouldRenderAmbientEffects(appearance) && live.kind === 'answer') {
      const glowed = applyStreamTailGlow([body], 'assistant', appearance, { active: true });
      body = glowed[0] ?? body;
    }
    return truncateToWidth(`  ${body}`, width, '…');
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
    this.lastWorkerSlots = maxWorkers;
    const offset = clampWorkerScrollOffset(
      this.workerScrollOffset,
      workers.length,
      maxWorkers,
    );
    this.workerScrollOffset = offset;
    const visible = workers.slice(offset, offset + maxWorkers);
    for (const worker of visible) {
      if (mode === 'full') {
        for (const row of this.renderWorkerBlock(worker, animated, now, width)) {
          lines.push(row);
        }
      } else {
        lines.push(truncateToWidth(this.renderWorkerTight(worker, animated, now, width), width, '…'));
      }
    }
    if (workers.length > visible.length) {
      const hidden = workers.length - visible.length;
      lines.push(
        currentTheme.fg('textDim', `… +${String(hidden)} more (↑↓)`),
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

    const live = this.hotLiveStream(worker, now);
    const intent = live === undefined ? this.workerIntent(worker) : undefined;
    const showedFocus =
      intent !== undefined &&
      worker.focusTodo !== undefined &&
      intent === worker.focusTodo.trim();
    if (live !== undefined) {
      rows.push(this.renderLiveStreamRow(worker, live, animated, width));
    } else if (intent !== undefined) {
      rows.push(truncateToWidth(`  ${currentTheme.fg('text', intent)}`, width, '…'));
    }

    const action = this.humanAction(worker, this.targetBudget(width));
    if (action !== undefined) {
      const hot =
        animated &&
        (worker.status === 'running' || worker.status === 'finishing') &&
        now - worker.lastActivityAtMs < ACTION_HOT_MS;
      // Arrow is the hot signal; tool+target body stays readable textDim.
      const arrow = hot
        ? renderPulseText('→', `mc-act:${worker.id}`, 'primary')
        : currentTheme.fg('textDim', '→');
      const body = currentTheme.fg('textDim', action);
      rows.push(truncateToWidth(`  ${arrow} ${body}`, width, '…'));
    }
    const progress = this.renderProgressLine(worker, showedFocus, animated, now);
    if (progress !== undefined) {
      rows.push(truncateToWidth(progress, width, '…'));
    }

    // Cap at name + 3 detail rows; drop progress first so live/intent stays.
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
      const spark = formatRateSparkline(worker.rateSamples, 3);
      if (spark !== '···') {
        stats.push(currentTheme.fg('textMuted', spark));
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
    const bar = renderLiveRatioBar(ratio, 6, {
      now,
      seed: `mc-bar:${worker.id}`,
      animated: animated && (worker.status === 'running' || worker.status === 'finishing'),
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

  /** Tight/minimal: glyph name — live stream / intent / short action. */
  private renderWorkerTight(
    worker: MissionWorker,
    animated: boolean,
    now: number,
    width: number = 40,
  ): string {
    const glyph = this.workerGlyph(worker, animated);
    const namePlain = truncateToWidth(worker.name, WORKER_NAME_MAX, '…');
    const name = currentTheme.fg(
      worker.status === 'completed' || worker.status === 'failed' ? 'textDim' : 'text',
      namePlain,
    );
    const head = `${glyph} ${name}`;
    const restBudget = Math.max(12, width - visibleWidth(head) - 1);
    const live = this.hotLiveStream(worker, now);
    if (live !== undefined) {
      const mark = live.kind === 'thinking' ? '◌' : '◆';
      const revealed = this.revealByWorker.get(worker.id);
      const source =
        revealed !== undefined && revealed.target.length > 0 ? visibleText(revealed) : live.text;
      const tail = truncateToWidth(source, Math.max(12, restBudget - 2), '…');
      return `${head}${currentTheme.fg('textDim', ` ${mark} ${tail}`)}`;
    }
    const intent = this.workerIntent(worker);
    if (intent !== undefined) {
      const clipped = truncateToWidth(intent, Math.max(8, restBudget - 3), '…');
      return `${head}${currentTheme.fg('textDim', ` — ${clipped}`)}`;
    }
    const action = this.humanAction(worker, this.targetBudget(width));
    if (action !== undefined) {
      const clipped = truncateToWidth(action, Math.max(8, restBudget - 3), '…');
      return `${head}${currentTheme.fg('textDim', ` — ${clipped}`)}`;
    }
    const elapsed = currentTheme.fg('textDim', ` ${formatJobDuration(worker.elapsedMs)}`);
    return `${head}${elapsed}`;
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
    const feed = resolveDenseOps(this.view.snapshot.ops, this.visibleWorkers(now));
    if (feed.length === 0) return [];
    const multiWorker = new Set(feed.map((entry) => entry.workerId)).size > 1;
    return feed
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
    // Right-pad so the mark/body column stays aligned as ages tick (`3s`→`12s`).
    const agePlain = formatMissionAgeMs(entry.atMs, now).padStart(7);
    const clock = currentTheme.fg('textMuted', agePlain);
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
    const human = formatMissionTarget(
      entry.name,
      entry.target,
      this.view.workDir,
      this.targetBudget(width),
    );
    // Column grammar: tool (text) · target (dim) · chip (muted) — never pulse the row body.
    const toolPaint = currentTheme.fg(
      entry.status === 'error' ? 'error' : entry.status === 'running' ? 'text' : 'textDim',
      entry.name,
    );
    const targetPaint =
      human === undefined
        ? ''
        : ` ${currentTheme.fg(entry.status === 'error' ? 'error' : 'textDim', human)}`;
    const chipPaint =
      entry.chip === undefined
        ? ''
        : ` ${currentTheme.fg('textMuted', entry.chip)}`;
    let body = `${toolPaint}${targetPaint}${chipPaint}`;
    if (freshlySettled) {
      // Brief tone flash on the whole body, then static columns above take over.
      const bodyPlain = `${entry.name}${human === undefined ? '' : ` ${human}`}${
        entry.chip === undefined ? '' : ` ${entry.chip}`
      }`;
      body = renderToneSettleFlash(
        bodyPlain,
        `mc-ops-body:${entry.toolCallId}`,
        settledAt,
        entry.status === 'error' ? 'error' : 'success',
      );
    }
    return truncateToWidth(`${clock}${worker}${mark}${body}`, width, '…');
  }

  // ── BOARD ─────────────────────────────────────────────────────────────

  private buildJobCountsLine(width: number): string[] {
    const jobs = this.view.jobs;
    if (jobs.total === 0) return [];
    return [truncateToWidth(formatMissionJobCounts(jobs), width, '…')];
  }

  private buildJobLines(mode: LayoutMode, width: number, now: number): string[] {
    const jobs = this.view.jobs;
    if (jobs.total === 0) return [];
    const lines = this.buildJobCountsLine(width);
    if (mode !== 'full') return lines;
    for (const card of selectAttentionJobs(jobs, JOB_ROWS_FULL)) {
      const row = formatAttentionJobRow(card, width, now);
      if (row !== undefined) lines.push(row);
    }
    return lines;
  }
}
