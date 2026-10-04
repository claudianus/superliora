/**
 * WorkerDockPanel — the single live-monitoring surface for every
 * background worker (subagents, background agents/processes, swarm members)
 * plus a condensed Conductor job lane summary. Renders as an in-stage bottom
 * band at the stage's full reading width (capped at
 * {@link WORKER_DOCK_BAND_MAX_ROWS} rows).
 *
 * Presentation only: the controller pushes an immutable
 * {@link WorkerDockView} (registry snapshot + conductor jobs). Motion
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

import { PULSE_ACTIVE_FRAMES } from '#/tui/constant/symbols';
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
import {
  workerDockProductName,
  workerLedgerChip,
} from '#/tui/features/worker-dock/labels';
import {
  isDockWorkerPastLinger,
  isToolProgressLiveKind,
  type WorkerDockSnapshot,
  type DockOpsEntry,
  type DockWorker,
  type MissionLiveKind,
} from '#/tui/controllers/worker-dock/registry';
import {
  CHROME_BAND_LEFT_MARGIN,
  CHROME_BAND_SIDE_PADDING,
  chromeBandInteriorWidth,
  renderRoundedPanel,
} from '#/tui/utils/ui/panel-frame';
import {
  renderLiveSectionHeader,
} from '#/tui/components/chrome/chrome-band-motion';
import {
  emptyConductorJobsSnapshot,
  formatJobDuration,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';
import { applyStreamTailGlow } from '#/tui/features/transcript/transcript-entrance';
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
  selectAttentionJobs,
  shouldUseDensemode,
} from './densemode';
import { getHoverRegionId } from '#/tui/features/worker-dock/worker-hover';
import {
  paintWorkerRowChrome,
  workerHoverPaintPending,
} from '#/tui/features/worker-dock/worker-row-paint';
import { projectWorkerTree, WORKER_TREE_MAX_LEVELS, type WorkerDockTreeInput, type WorkerTreeProjection } from './worker-tree';
import { ttui } from '#/tui/utils/tui-i18n';

export type DockWorkerScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'top'
  | 'bottom';

/** Hit-test result for a painted mission-band content row (0 = first content line). */
export type DockWorkerHit =
  | { readonly kind: 'worker'; readonly workerId: string; readonly index: number }
  | { readonly kind: 'header' }
  | { readonly kind: 'other' };

import {
  formatMissionAgeMs,
  formatMissionClockMs,
  formatMissionTokenRate,
  formatMissionTokens,
  liveWorkerElapsedMs,
  MISSION_LIVE_HOT_MS,
} from './dock-format';

export {
  formatMissionAgeMs,
  formatMissionClockMs,
  formatMissionTokenRate,
  formatMissionTokens,
  liveWorkerElapsedMs,
  MISSION_LIVE_HOT_MS,
} from './dock-format';

/** In-stage bottom band never grows past this many rows. */
export const WORKER_DOCK_BAND_MAX_ROWS = 14;
/** @deprecated Use {@link WORKER_DOCK_BAND_MAX_ROWS}. */
export const MISSION_BAND_MAX_ROWS = WORKER_DOCK_BAND_MAX_ROWS;
/** @deprecated Use {@link WORKER_DOCK_BAND_MAX_ROWS}. */
export const MISSION_FALLBACK_MAX_ROWS = WORKER_DOCK_BAND_MAX_ROWS;
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
/** Display tok/s ease toward target per ambient frame (0–1). Higher = snappier. */
const RATE_LERP_ALPHA = 0.55;

export interface WorkerDockView {
  readonly snapshot: WorkerDockSnapshot;
  readonly jobs: ConductorJobsSnapshot;
  /** Workspace cwd for path relativization (optional). */
  readonly workDir?: string;
  /** Explicit host ancestry; no display-name inference. */
  readonly tree?: WorkerDockTreeInput;
}

export function emptyWorkerDockView(): WorkerDockView {
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

/**
 * Dock chrome border. Failed workers never paint the whole band as error —
 * only needs_user / blocked escalate to warning; active work stays
 * primary; idle/terminal-only stays the default border.
 */
export function missionDockBorderToken(
  workers: readonly DockWorker[],
  jobs: Pick<ConductorJobsSnapshot, 'needsUser' | 'blocked'>,
): ColorToken {
  if (
    jobs.needsUser > 0 ||
    jobs.blocked > 0
  ) {
    return 'warning';
  }
  if (workers.some((worker) => worker.status === 'running')) {
    return 'primary';
  }
  return 'border';
}

/**
 * Recorded status notes for Jobs hydrated into dock ghost rows.
 */
export function ledgerNote(
  worker: Pick<DockWorker, 'ledger' | 'status'>,
): string | undefined {
  const ledger = worker.ledger;
  if (ledger === undefined) return undefined;
  if (ledger.status === 'interrupted') {
    return 'paused — /job resume to continue';
  }
  if (ledger.status === 'queued') {
    return 'queued — not started';
  }
  return undefined;
}

type LayoutMode = 'full' | 'tight' | 'minimal';

export class WorkerDockPanelComponent implements Component {
  private view: WorkerDockView = emptyWorkerDockView();
  private readonly treeExpansion = new Map<string, boolean>();
  private revealTreeSelection = false;
  private readonly treeSettleAt = new Map<string, number>();
  private readonly lastTreeCaretMap = new Map<number, { id: string; column: number; group: boolean }>();
  /** `pinned` mode keeps the panel mounted with an idle placeholder. */
  private pinned = false;
  /** Window start into the sorted worker roster (densemode / NOW). */
  private workerScrollOffset = 0;
  /** Last painted worker-row viewport size (for scroll clamp before next paint). */
  private lastWorkerSlots = DENSE_WORKER_CAP;
  /** Keyboard / click selection into the visible roster (worker id). */
  private selectedWorkerId: string | undefined;
  /** Keyboard focus is independent of the retained selected worker. */
  focused = false;
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
  get currentView(): WorkerDockView {
    return this.view;
  }

  /** Selected worker id (keyboard / click), if still on the roster. */
  get selectedWorker(): string | undefined {
    return this.selectedWorkerId;
  }

  setView(view: WorkerDockView): void {
    if (
      view.snapshot.version === this.view.snapshot.version &&
      view.jobs === this.view.jobs &&
      view.workDir === this.view.workDir &&
      view.tree === this.view.tree
    ) {
      return;
    }
    if (view.tree !== undefined && this.view.tree !== undefined && view.tree.rootAgentId !== this.view.tree.rootAgentId) {
      this.treeExpansion.clear();
      this.treeSettleAt.clear();
      this.selectedWorkerId = undefined;
      this.focused = false;
    }
    if (view.tree !== undefined) {
      const previous = new Map(this.view.tree?.nodes.map(node => [node.id, node.phase]));
      for (const node of view.tree.nodes) {
        if (previous.has(node.id) && previous.get(node.id) !== node.phase) this.treeSettleAt.set(node.id, appearanceAnimationNow());
      }
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
      const exists = this.view.tree !== undefined
        ? workerId === this.view.tree.rootAgentId || this.view.tree.nodes.some(node => node.id === workerId) || this.treeProjection().rows.some(row => row.id === workerId)
        : this.visibleWorkers(now).some((worker) => worker.id === workerId);
      if (!exists) return false;
    }
    this.selectedWorkerId = workerId;
    this.revealTreeSelection = true;
    this.lastRender = undefined;
    return true;
  }

  /**
   * Move selection within the visible roster. When nothing is selected yet,
   * arrow-down picks the first worker and arrow-up the last.
   * Returns true when selection or scroll window changed.
   */
  moveSelection(delta: number): boolean {
    const workers = this.view.tree === undefined ? this.visibleWorkers(appearanceAnimationNow()) : this.treeProjection().rows;
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
  hitTestWorkerRow(bandLocalY: number, bandHeight: number): DockWorkerHit | undefined {
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
    if (this.view.tree !== undefined) {
      if (this.selectedWorkerId !== undefined && this.selectedWorkerId !== this.view.tree.rootAgentId &&
        !this.view.tree.nodes.some(node => node.id === this.selectedWorkerId) && !this.treeProjection().rows.some(row => row.id === this.selectedWorkerId)) {
        this.selectedWorkerId = undefined;
      }
      return;
    }
    if (this.selectedWorkerId === undefined) return;
    const now = appearanceAnimationNow();
    const still = this.visibleWorkers(now).some((worker) => worker.id === this.selectedWorkerId);
    if (!still) {
      this.selectedWorkerId = undefined;
      this.focused = false;
    }
  }

  /**
   * Mount gate. Time-aware: terminal workers (completed + failed) past the
   * linger window count as gone so the dock/fallback collapses on the next
   * ambient frame even when no further event arrives.
   */
  isEmpty(now: number = appearanceAnimationNow()): boolean {
    return (this.view.tree === undefined ? this.visibleWorkers(now).length === 0 : this.view.tree.nodes.every(node => node.id === this.view.tree!.rootAgentId) && this.visibleWorkers(now).every(worker => worker.id === this.view.tree!.rootAgentId)) && this.view.jobs.total === 0;
  }

  /** Workers minus terminal ones whose linger window has elapsed. */
  private visibleWorkers(now: number): readonly DockWorker[] {
    const workers = this.view.snapshot.workers;
    if (workers.length === 0) return workers;
    return workers.filter((worker) => !isDockWorkerPastLinger(worker, now));
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
  scrollWorkers(action: DockWorkerScrollAction): boolean {
    const workers = this.view.tree === undefined ? this.visibleWorkers(appearanceAnimationNow()) : this.treeProjection().rows;
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
    if (matchesKey(data, Key.left)) { this.handleSelectionKey('left'); return; }
    if (matchesKey(data, Key.right)) { this.handleSelectionKey('right'); return; }
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
    key: 'left' | 'right' | 'up' | 'down' | 'enter' | 'escape' | 'pageup' | 'pagedown' | 'home' | 'end',
  ): { readonly handled: boolean; readonly openWorkerId?: string; readonly clearSelection?: boolean } {
    switch (key) {
      case 'left':
      case 'right':
        return { handled: this.navigateTree(key) };
      case 'up':
        return { handled: this.moveSelection(-1) || this.hasSelectableRows() };
      case 'down':
        return { handled: this.moveSelection(1) || this.hasSelectableRows() };
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
          return this.treeSelectionOpens() ? { handled: true, openWorkerId: this.selectedWorkerId } : { handled: true };
        }
        if (!this.treeSelectionOpens()) {
          this.toggleTreeNode(id);
          return { handled: true };
        }
        return { handled: true, openWorkerId: id };
      }
      case 'escape': {
        if (this.selectedWorkerId === undefined) return { handled: false };
        this.selectWorker(undefined);
        this.focused = false;
        return { handled: true, clearSelection: true };
      }
      default:
        return { handled: false };
    }
  }

  /** In-stage bottom band (full stage reading width). */
  render(width: number): string[] {
    return this.renderFitted(width, WORKER_DOCK_BAND_MAX_ROWS);
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
        title: ` ${workerDockProductName()} `,
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
    if (this.view.tree !== undefined) return this.buildTreeFrame(width, budget);
    this.lastTreeCaretMap.clear();
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
          currentTheme.fg('textMuted', ` ${ttui('tui.workerDock.dockHint')}`),
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
    let minimalContent: string[] | undefined;
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
      if (mode === 'minimal') minimalContent = content;
    }
    // Reuse the minimal build from the loop instead of rendering a 4th time.
    const content = (minimalContent ?? this.buildContent('minimal', interior, contentBudget, now)).slice(
      0,
      contentBudget,
    );
    return renderRoundedPanel({
      ...frameOpts,
      title: this.title('minimal', now),
      content,
      borderToken: this.borderToken(now),
    });
  }

  private treeProjection(): WorkerTreeProjection {
    return projectWorkerTree(this.view.tree!, this.view.snapshot.workers, this.treeExpansion, this.selectedWorkerId);
  }

  /** User action only: automatic updates never mutate expansion overrides. */
  toggleTreeNode(id: string): boolean {
    if (this.view.tree === undefined) return false;
    const projection = this.treeProjection();
    const row = projection.rows.find(item => item.id === id);
    if (row === undefined || !row.expandable) return false;
    this.treeExpansion.set(id, !row.expanded);
    this.treeSettleAt.set(id, appearanceAnimationNow());
    if (row.expanded && this.selectedWorkerId !== undefined) {
      let selected: string | undefined = this.selectedWorkerId;
      const visited = new Set<string>();
      while (selected !== undefined && !visited.has(selected)) {
        if (selected === id) { this.selectedWorkerId = id; this.revealTreeSelection = true; break; }
        visited.add(selected); selected = projection.parents.get(selected);
      }
    }
    this.lastRender = undefined;
    return true;
  }

  private navigateTree(direction: 'left' | 'right'): boolean {
    if (this.view.tree === undefined) return false;
    if (this.selectedWorkerId === undefined) return this.moveSelection(1);
    const projection = this.treeProjection();
    const row = projection.rows.find(item => item.id === this.selectedWorkerId);
    if (row === undefined) return true;
    if (direction === 'left') {
      if (row.expanded) return this.toggleTreeNode(row.id);
      if (row.parentId !== undefined) return this.selectWorker(row.parentId);
      return true;
    }
    if (row.expandable && !row.expanded) return this.toggleTreeNode(row.id);
    const child = projection.rows.find(item => item.parentId === row.id);
    if (child !== undefined) return this.selectWorker(child.id);
    return true;
  }

  /** Tree mode navigates projected rows, which exist even without roster workers. */
  private hasSelectableRows(): boolean {
    return this.view.tree === undefined
      ? this.visibleWorkers(appearanceAnimationNow()).length > 0
      : this.treeProjection().rows.length > 0;
  }

  /** Root, group and pipeline rows are structure, not roster workers with transcripts. */
  private treeSelectionOpens(): boolean {
    if (this.view.tree === undefined) return true;
    const row = this.treeProjection().rows.find(item => item.id === this.selectedWorkerId);
    return row !== undefined && row.kind === 'worker' && row.role !== 'pipeline';
  }

  /** Caret clicks toggle without opening a transcript or touching the editor. */
  handleTreePointer(localX: number, localY: number): boolean {
    const hit = this.lastTreeCaretMap.get(localY - 1);
    if (hit === undefined) return false;
    if (Math.abs(localX - hit.column) <= 1 && this.toggleTreeNode(hit.id)) return true;
    // Non-openable rows (leaf pipelines included) consume the click as selection.
    if (hit.group) { this.selectWorker(hit.id); return true; }
    return false;
  }

  private buildTreeFrame(width: number, budget: number): string[] {
    const projection = this.treeProjection();
    const interior = chromeBandInteriorWidth(width);
    const contentBudget = Math.max(1, budget - 2);
    const counts = projection.counts;
    const totals = this.view.tree!.coordinatorTotals;
    const partial = totals?.truncated === true;
    const scopeLabel = partial ? 'Visible · ' : '';
    const content: string[] = [truncateToWidth(currentTheme.fg('textDim', `${scopeLabel}Run ${counts.running} · Queue ${counts.queued} · Reusable idle ${counts.idle} · Done ${counts.completed} · Error ${counts.error}`), interior)];
    if (totals !== undefined && (partial || totals.counts.attention > 0) && contentBudget >= 4) {
      content.push(truncateToWidth(currentTheme.fg('textDim', `Coordinator: ${totals.total} records · ${partial ? 'partial tree · ' : ''}${totals.counts.attention} attention`), interior));
    }
    if (contentBudget >= 6) {
      const job = selectAttentionJobs(this.view.jobs, 1)[0];
      const row = job === undefined ? undefined : formatAttentionJobRow(job, Math.max(1, interior - 6), appearanceAnimationNow());
      if (row !== undefined) content.push(truncateToWidth(currentTheme.fg('textMuted', 'Job · ') + row, interior));
    }
    const detailRows = this.selectedWorkerId !== undefined && contentBudget >= 4 ? 1 : 0;
    // Keep the Session / Main anchor visible while the descendant window scrolls.
    const slots = Math.max(0, contentBudget - content.length - detailRows - 1);
    this.lastWorkerSlots = Math.max(1, slots);
    this.workerScrollOffset = clampWorkerScrollOffset(this.workerScrollOffset, projection.rows.length, Math.max(1, slots));
    const selectedIndex = projection.rows.findIndex(row => row.id === this.selectedWorkerId);
    if (this.revealTreeSelection && slots > 0 && selectedIndex > 0) {
      if (selectedIndex < this.workerScrollOffset) this.workerScrollOffset = selectedIndex;
      else if (selectedIndex >= this.workerScrollOffset + slots) this.workerScrollOffset = selectedIndex - slots + 1;
    }
    this.revealTreeSelection = false;
    const rowMap = new Map<number, string>();
    this.lastTreeCaretMap.clear();
    const selectedPath = new Set<string>();
    let pathId = this.selectedWorkerId;
    for (let i = 0; pathId !== undefined && i <= WORKER_TREE_MAX_LEVELS; i++) { selectedPath.add(pathId); pathId = projection.parents.get(pathId); }
    const start = Math.max(1, this.workerScrollOffset);
    const visibleRows = projection.rows.length === 0 ? [] : [projection.rows[0]!, ...projection.rows.slice(start, start + slots)];
    for (const row of visibleRows) {
      const appearance = getActiveAppearancePreferences();
      const chrome = paintWorkerRowChrome({ workerId: row.id, selected: row.id === this.selectedWorkerId, appearance, animated: shouldRenderAmbientEffects(appearance) });
      const gutter = chrome || '  ';
      const caretPlain = row.expandable ? row.expanded ? '▾' : '▸' : '·';
      const settleAt = this.treeSettleAt.get(row.id);
      const caret = settleAt === undefined ? currentTheme.fg('primary', caretPlain) : renderToneSettleFlash(caretPlain, `mc:tree:${row.id}`, settleAt, 'primary');
      const label = row.kind === 'root' ? row.label : row.label.replaceAll(/\s+/g, ' ').trim();
      const name = selectedPath.has(row.id) ? currentTheme.boldFg('primary', label) : currentTheme.fg(row.phase === 'error' || row.attentionKind === 'error' ? 'error' : 'text', label);
      const brief = row.liveActivity?.replaceAll(/\s+/g, ' ').trim();
      const aggregate = !row.expanded && row.activeDescendants > 0 ? ` · ${row.activeDescendants} active below${row.queuedDescendants > 0 ? ` (${row.queuedDescendants} queued)` : ''}` : '';
      const attention = row.attentionKind === 'question' ? ' · needs input' : row.attentionKind === 'error' ? ' · review' : !row.expanded && row.attention ? ' · attention below' : '';
      const stateLabel = row.phase === 'queued' ? ' [queued]' : row.phase === 'idle' ? ' [reusable idle]' : row.phase === 'completed' ? ' [done]' : row.phase === 'error' ? ' [error]' : '';
      const activity = stateLabel + attention + (brief ? ` · ${brief}` : '');
      const index = content.length;
      const prefix = gutter + currentTheme.fg('textMuted', row.connector) + caret + ' ';
      const nameBudget = Math.max(8, Math.min(32, interior - visibleWidth(prefix) - visibleWidth(aggregate) - (activity ? 12 : 0)));
      content.push(truncateToWidth(prefix + truncateToWidth(name, nameBudget) + currentTheme.fg('textDim', aggregate + activity), interior));
      rowMap.set(index, row.id);
      if (row.expandable || row.kind !== 'worker' || row.role === 'pipeline') this.lastTreeCaretMap.set(index, { id: row.id, column: CHROME_BAND_LEFT_MARGIN + CHROME_BAND_SIDE_PADDING + 1 + 2 + visibleWidth(row.connector), group: row.kind !== 'worker' || row.role === 'pipeline' });
    }
    if (detailRows > 0) {
      const selected = projection.rows.find(row => row.id === this.selectedWorkerId);
      const node = this.view.tree!.nodes.find(node => node.id === this.selectedWorkerId);
      const target = node?.role === 'pipeline' && node.sessionId === undefined ? `record ${node.recordId ?? node.id}` : `${node?.sessionId ?? this.view.tree!.sessionId ?? ''}/${node?.agentId ?? (this.selectedWorkerId === this.view.tree!.rootAgentId ? this.view.tree!.rootAgentRawId ?? 'main' : this.selectedWorkerId)}`;
      const detail = selected?.kind === 'group' ? selected.path.join(' › ') : `${node?.role ?? (this.selectedWorkerId === this.view.tree!.rootAgentId ? 'main' : 'worker')} · ${target}`;
      content.push(truncateToWidth(currentTheme.fg('textDim', detail), interior));
    }
    this.lastWorkerRowMap = rowMap;
    this.lastHeaderRow = 0;
    return renderRoundedPanel({ width, leftMargin: CHROME_BAND_LEFT_MARGIN, sidePadding: CHROME_BAND_SIDE_PADDING, minBoxWidth: 24, fillWidth: true,
      title: ` ${workerDockProductName()} · Session tree `, content: content.slice(0, contentBudget), borderToken: this.borderToken(appearanceAnimationNow()) });
  }

  private title(mode: LayoutMode | 'dense', now: number): string {
    const workers = this.visibleWorkers(now);
    const active = workers.filter((worker) => worker.status === 'running');
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
      const elapsed = active.reduce(
        (max, worker) => Math.max(max, liveWorkerElapsedMs(worker, now)),
        0,
      );
      if (elapsed > 0) parts.push(formatJobDuration(elapsed));
      return ` ${workerDockProductName()} ·${parts.join(' · ')} `;
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
      const elapsed = active.reduce(
        (max, worker) => Math.max(max, liveWorkerElapsedMs(worker, now)),
        0,
      );
      if (elapsed > 0) parts.push(formatJobDuration(elapsed));
    }
    return ` ${workerDockProductName()} ·${parts.join(' · ')} `;
  }

  private borderToken(now: number): ColorToken {
    return missionDockBorderToken(this.visibleWorkers(now), this.view.jobs);
  }

  private buildContent(mode: LayoutMode, width: number, budget: number, now: number): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const lines: string[] = [];
    const live =
      animated &&
      this.visibleWorkers(now).some(
        (worker) =>
          worker.status === 'running',
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

  private workerIntent(worker: DockWorker): string | undefined {
    const description = worker.description?.trim();
    if (description !== undefined && description.length > 0) return description;
    return undefined;
  }

  /** Hot child thinking/answer/tool-progress tail for the NOW live strip. */
  private hotLiveStream(
    worker: DockWorker,
    now: number,
  ): { kind: MissionLiveKind; text: string } | undefined {
    if (worker.liveText === undefined || worker.liveText.length === 0) return undefined;
    if (worker.liveKind === undefined || worker.liveAtMs === undefined) return undefined;
    if (worker.status !== 'running') return undefined;
    if (
      !isToolProgressLiveKind(worker.liveKind) &&
      now - worker.liveAtMs >= MISSION_LIVE_HOT_MS
    ) {
      return undefined;
    }
    return { kind: worker.liveKind, text: worker.liveText };
  }

  private humanAction(worker: DockWorker, targetBudget: number = TARGET_MAX): string | undefined {
    if (worker.lastTool === undefined) return undefined;
    const target = worker.lastTarget === undefined
      ? undefined
      : truncateToWidth(worker.lastTarget, targetBudget, '…');
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
    worker: DockWorker,
    live: { kind: MissionLiveKind; text: string },
    animated: boolean,
    width: number,
  ): string {
    const appearance = getActiveAppearancePreferences();
    const revealed = this.revealByWorker.get(worker.id);
    const source =
      revealed !== undefined && revealed.target.length > 0 ? visibleText(revealed) : live.text;
    const plain = truncateToWidth(source, this.liveTextBudget(width), '…');
    const tool = isToolProgressLiveKind(live.kind);
    const mark = live.kind === 'thinking' ? '◌' : tool ? '▏' : '◆';
    const markPaint = currentTheme.fg(
      live.kind === 'thinking' || live.kind === 'status' || live.kind === 'stdout' || live.kind === 'progress'
        ? 'textMuted'
        : live.kind === 'stderr'
          ? 'error'
          : 'primary',
      mark,
    );
    const bodyToken =
      live.kind === 'thinking' || live.kind === 'stdout' || live.kind === 'progress' || live.kind === 'status'
        ? live.kind === 'thinking'
          ? 'textDim'
          : 'textMuted'
        : live.kind === 'stderr'
          ? 'error'
          : 'text';
    const tinted = currentTheme.fg(bodyToken, plain);
    let body = `${markPaint} ${tinted}`;
    const glowKind = live.kind === 'answer' || live.kind === 'stdout' || live.kind === 'progress';
    const toolGlow = live.kind === 'stderr';
    if (animated && shouldRenderAmbientEffects(appearance) && (glowKind || toolGlow)) {
      const glowed = applyStreamTailGlow(
        [body],
        toolGlow ? 'tool' : 'assistant',
        appearance,
        { active: true, nowMs: appearanceAnimationNow() },
      );
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
        worker.status === 'running',
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
    worker: DockWorker,
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
        truncateToWidth(
          `  ${currentTheme.fg('textDim', truncateToWidth(reason, 60, '…'))}`,
          width,
          '…',
        ),
      );
      return rows;
    }
    // Ledger ghosts describe recorded state without assuming a worker exists.
    if (worker.ledger !== undefined) {
      const note = ledgerNote(worker);
      if (note !== undefined) {
        rows.push(truncateToWidth(`  ${currentTheme.fg('textDim', note)}`, width, '…'));
      }
    }

    const live = this.hotLiveStream(worker, now);
    const intent = live === undefined ? this.workerIntent(worker) : undefined;
    if (live !== undefined) {
      rows.push(this.renderLiveStreamRow(worker, live, animated, width));
    } else if (intent !== undefined) {
      rows.push(truncateToWidth(`  ${currentTheme.fg('text', intent)}`, width, '…'));
    }

    const action = this.humanAction(worker, this.targetBudget(width));
    if (action !== undefined) {
      const hot =
        animated &&
        (worker.status === 'running') &&
        now - worker.lastActivityAtMs < ACTION_HOT_MS;
      // Arrow is the hot signal; tool+target body stays readable textDim.
      const arrow = hot
        ? renderPulseText('→', `mc-act:${worker.id}`, 'primary')
        : currentTheme.fg('textDim', '→');
      const body = currentTheme.fg('textDim', action);
      rows.push(truncateToWidth(`  ${arrow} ${body}`, width, '…'));
    }
    const progress = this.renderProgressLine(worker, animated);
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
    worker: DockWorker,
    animated: boolean,
  ): string | undefined {
      const stats: string[] = [];
      if (worker.toolCount > 0) {
        stats.push(currentTheme.fg('textMuted', `${String(worker.toolCount)} tools`));
      }
      const rate = formatMissionTokenRate(worker.tokenRatePerSec ?? 0);
      if (rate.length > 0) {
        stats.push(
          animated && (worker.status === 'running')
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
      if (worker.budgetRemainingMs !== undefined) {
        stats.push(currentTheme.fg('textMuted', `timeout ${formatJobDuration(Math.max(0, worker.budgetRemainingMs))}`));
      }
      if (stats.length === 0) return undefined;
      return `  ${stats.join(currentTheme.fg('textMuted', ' · '))}`;
  }

  private renderWorkerNameRow(worker: DockWorker, animated: boolean, now: number): string {
    const glyph = this.workerGlyph(worker, animated);
    const terminal = worker.status === 'completed' || worker.status === 'failed';
    const namePlain = truncateToWidth(worker.name, WORKER_NAME_MAX, '…');
    const recentlyTerminal =
      terminal && worker.terminalAtMs !== undefined && now - worker.terminalAtMs < TERMINAL_FLASH_MS;
    let name: string;
    if (worker.status === 'completed' && recentlyTerminal && animated) {
      name = renderToneSettleFlash(namePlain, `mc-done:${worker.id}`, worker.terminalAtMs!, 'success');
    } else if (worker.status === 'failed' && recentlyTerminal && animated) {
      // Brief dim settle only — never keep error chrome on the name after flash.
      name = renderToneSettleFlash(namePlain, `mc-fail:${worker.id}`, worker.terminalAtMs!, 'textDim');
    } else if (
      animated &&
      worker.status === 'running' &&
      liveWorkerElapsedMs(worker, now) < 900
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
    const ledgerChip = workerLedgerChip(worker);
    const chipPaint =
      ledgerChip === undefined ? '' : currentTheme.fg('textMuted', ` ${ledgerChip}`);
    const elapsed = currentTheme.fg(
      'textDim',
      ` ${formatJobDuration(liveWorkerElapsedMs(worker, now))}`,
    );
    return `${glyph} ${name}${chipPaint}${model}${elapsed}`;
  }

  /** Tight/minimal: glyph name — live stream / intent / short action. */
  private renderWorkerTight(
    worker: DockWorker,
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
    const ledgerChip = workerLedgerChip(worker);
    const chipPaint =
      ledgerChip === undefined ? '' : currentTheme.fg('textMuted', ` ${ledgerChip}`);
    const head = `${glyph} ${name}${chipPaint}`;
    const restBudget = Math.max(12, width - visibleWidth(head) - 1);
    const live = this.hotLiveStream(worker, now);
    if (live !== undefined) {
      const mark = live.kind === 'thinking' ? '◌' : isToolProgressLiveKind(live.kind) ? '▏' : '◆';
      const revealed = this.revealByWorker.get(worker.id);
      const source =
        revealed !== undefined && revealed.target.length > 0 ? visibleText(revealed) : live.text;
      const tail = truncateToWidth(source, Math.max(12, restBudget - 2), '…');
      const token =
        live.kind === 'stderr' ? 'error' : live.kind === 'answer' ? 'textDim' : 'textMuted';
      return `${head}${currentTheme.fg(token, ` ${mark} ${tail}`)}`;
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
    const elapsed = currentTheme.fg(
      'textDim',
      ` ${formatJobDuration(liveWorkerElapsedMs(worker, appearanceAnimationNow()))}`,
    );
    return `${head}${elapsed}`;
  }

  private workerGlyph(worker: DockWorker, animated: boolean): string {
    switch (worker.status) {
      case 'running':
        return animated
          ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `mc:${worker.id}`, '●', 'primary')
          : currentTheme.fg('primary', '●');
      case 'completed':
        return currentTheme.fg('success', '✓');
      case 'failed':
        // Calm terminal mark — dock chrome never goes error for failed workers.
        return currentTheme.fg('textDim', '✗');
    }
  }

  // ── MOVES ─────────────────────────────────────────────────────────────

  private buildOpsLines(
    width: number,
    maxRows: number,
    animated: boolean,
    now: number,
  ): string[] {
    const feed = this.view.snapshot.ops;
    if (feed.length === 0) return [];
    const multiWorker = new Set(feed.map((entry) => entry.workerId)).size > 1;
    return feed
      .slice(-maxRows)
      .map((entry) => this.renderOpsRow(entry, width, multiWorker, animated, now));
  }

  private renderOpsRow(
    entry: DockOpsEntry,
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
    const human = entry.target === undefined
      ? undefined
      : truncateToWidth(entry.target, this.targetBudget(width), '…');
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
