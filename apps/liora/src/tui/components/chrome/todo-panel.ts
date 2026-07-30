/**
 * TodoPanel — live-updating TODO list shown before the input area.
 *
 * Mounted as a dedicated `Container` slot between the activity pane
 * (spinners / thinking stream) and the queue / editor block. The host
 * calls {@link setTodos} whenever the LLM invokes the `TodoList`
 * tool; state survives across turns so the list stays visible until
 * explicitly cleared (`todos: []`), a new session starts, or `/clear`
 * is issued.
 *
 * When a live goal (active / paused / blocked) is set via {@link setGoal},
 * the panel stays mounted even with an empty todo list and prepends a
 * goal monitor header (objective, status pulse, progress, budget).
 */

import {
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '#/tui/renderer';
import type { GoalSnapshot } from '@superliora/sdk';

import {
  goalMonitorBorderToken,
  goalMonitorSnapshotKey,
  goalMonitorTitle,
  isLiveGoal,
  renderGoalMonitorLines,
} from '#/tui/components/chrome/goal-monitor';
import { currentTheme } from '#/tui/theme/theme';
import type { AppearancePreferences } from '#/tui/config';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  renderSettleFlash,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';

import {
  MAX_VISIBLE,
  cardPositions,
  countTodos,
  diffTodos,
  formatHiddenCounts,
  selectVisibleTodos,
  windowTodos,
  type CardPosition,
  type TodoChangeKind,
  type TodoPanelChangeSummary,
} from './todo-panel-model';
import {
  BOARD_INDENT,
  BOARD_MIN_WIDTH,
  EMPTY_LANE_FLASHES,
  EMPTY_MOTIONS,
  changeFlashMs,
  renderBoardMeta,
  renderBoardScrollIndicator,
  renderTodos,
  type CardMotionCue,
} from './todo-panel-render';

export {
  formatHiddenCounts,
  selectVisibleTodos,
  diffTodos,
  type VisibleTodos,
} from './todo-panel-model';
export { formatSwarmMemberTodoLines } from './todo-panel-render';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}

/**
 * Live subagent progress input for the board's subagents strip (Phase 5-B).
 * Mirrors the `subagent.todo.updated` payload: identity plus the child's
 * full todo list, reduced to done/total counts on the strip.
 */
export interface SubagentTodosInput {
  readonly subagentId: string;
  readonly name: string;
  readonly todos: readonly TodoItem[];
}

/** One rendered row of the subagents strip. */
export interface SubagentStripEntry {
  readonly subagentId: string;
  readonly name: string;
  readonly done: number;
  readonly total: number;
}

/**
 * Virtual-scroll input for the collapsed board. Line actions move one board
 * row (wheel ticks, alt+arrows); page actions move a viewport minus one so
 * consecutive pages overlap by a row; top / bottom jump to the edges.
 */
export type TodoBoardScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'top'
  | 'bottom';

/** Scroll position of the windowed board, for tests / inspection. */
export interface TodoBoardScrollSnapshot {
  readonly offset: number;
  readonly viewport: number;
  readonly total: number;
}

/**
 * Host environment for the board's virtual scroll. `terminalRows` lends the
 * panel a height budget; without it (tests, headless callers) the collapsed
 * board keeps the legacy MAX_VISIBLE selection byte-for-byte.
 */
export interface TodoPanelOptions {
  readonly terminalRows?: () => number;
}

/**
 * Cap on tracked subagent rows. Finished subagents leave via lifecycle
 * events; the cap bounds the strip when completions are missed or many
 * children run at once — the earliest-entered rows are evicted first.
 */
const MAX_SUBAGENT_ROWS = 6;
const SUBAGENT_BAR_WIDTH = 6;
/**
 * Grace period before the board may shrink. Cards hop between lanes on
 * updates; shrinking instantly would bounce the panel height and flicker,
 * so shrinks are delayed while growth stays instant.
 */
const BOARD_SHRINK_HOLD_MS = 1500;

/**
 * Virtual-scroll budget. The collapsed board windows its lanes inside a
 * third of the terminal (the same share the BTW panel takes) once chrome is
 * reserved: rounded frame top/bottom, board meta, lane header, lane
 * divider, and the scroll indicator line. The clamp keeps tiny terminals
 * near the legacy 5-row cap and huge terminals from turning the board into
 * a full-screen takeover.
 */
const BOARD_VIEWPORT_CHROME_ROWS = 6;
const BOARD_MIN_VIEWPORT_ROWS = 4;
const BOARD_MAX_VIEWPORT_ROWS = 12;

const EMPTY_HIGHLIGHTS: ReadonlyMap<string, TodoChangeKind> = new Map();

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'done'];

/** Mutable strip row; rebuilt in place on each `subagent.todo.updated`. */
interface SubagentStripRow {
  readonly subagentId: string;
  name: string;
  done: number;
  total: number;
  readonly enteredAtMs: number;
  /** Last count change; drives the count settle flash. */
  updatedAtMs: number;
}

export class TodoPanelComponent implements Component {
  private readonly options: TodoPanelOptions;
  private todos: readonly TodoItem[] = [];
  private expanded = false;
  private recentChanges = new Map<string, TodoChangeKind>();
  private changeSummary: TodoPanelChangeSummary | undefined;
  private callsSinceUpdate = 0;
  private goal: GoalSnapshot | null = null;
  private goalObservedAtMs = Date.now();
  private goalSnapshotKey: string | null = null;
  private goalChangedAtMs: number | undefined;
  private lastBoardRows = 0;
  private boardShrinkRequestedAtMs: number | undefined;
  /**
   * Card-motion tracking. Both maps are rebuilt from the currently rendered
   * cards on every list update, so titles that left the board drop out
   * automatically (no unbounded growth).
   */
  private lastPositions = new Map<string, CardPosition>();
  private motionCues = new Map<string, CardMotionCue>();
  /** State the motion cues were captured for; identity-checked per render. */
  private positionBase:
    | { readonly todos: readonly TodoItem[]; readonly expanded: boolean }
    | undefined;
  private lastLaneCounts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  private laneCountFlashes: Partial<Record<TodoStatus, number>> = {};
  /**
   * Subagents strip (Phase 5-B). Insertion-ordered map keyed by subagent id;
   * bounded by MAX_SUBAGENT_ROWS and swept on lifecycle completion / reset.
   */
  private subagentRows = new Map<string, SubagentStripRow>();
  /** Bumped on every strip mutation; joins the render memo key. */
  private subagentVersion = 0;
  /** Removal feedback: the strip header re-settles when a row leaves. */
  private subagentStripFlashAtMs: number | undefined;
  /** Frame memo: identical state yields the same lines array so the renderer diff skips the panel. */
  private lastRender:
    | {
        readonly width: number;
        readonly expanded: boolean;
        readonly todos: readonly TodoItem[];
        readonly goal: GoalSnapshot | null;
        readonly calls: number;
        readonly subagents: number;
        readonly secondBucket: number;
        readonly scroll: number;
        readonly budget: number;
        readonly lines: string[];
      }
    | undefined;
  /**
   * First visible board row when the collapsed board is windowed. Kept
   * across list updates (cards hopping lanes should not jump the view) and
   * clamped lazily at render / scroll time; the memo key carries it so a
   * moved viewport never serves stale bytes.
   */
  private scrollOffset = 0;

  constructor(options: TodoPanelOptions = {}) {
    this.options = options;
  }

  setTodos(todos: readonly TodoItem[]): void {
    const next = todos.map((t) => ({ title: t.title, status: t.status }));
    const diff = diffTodos(this.todos, next);
    this.todos = next;
    this.recentChanges = diff.highlights;
    this.changeSummary = diff.summary;
    this.callsSinceUpdate = 0;
    this.updateLaneCountFlashes(next);
    if (next.length === 0) {
      // An empty board has no layout; the next batch enters fresh.
      this.lastPositions = new Map();
      this.motionCues = new Map();
      this.positionBase = undefined;
    }
  }

  /**
   * Bind the live goal snapshot. When status is active/paused/blocked the
   * panel stays visible even with zero todos. Complete / null clears the
   * monitor chrome.
   */
  setGoal(goal: GoalSnapshot | null | undefined): void {
    const next = goal ?? null;
    const nextKey = goalMonitorSnapshotKey(next);
    if (nextKey !== this.goalSnapshotKey) {
      const statusChanged =
        this.goal?.status !== next?.status || this.goal?.goalId !== next?.goalId;
      this.goalSnapshotKey = nextKey;
      this.goalObservedAtMs = Date.now();
      if (statusChanged && isLiveGoal(next)) {
        this.goalChangedAtMs = appearanceAnimationNow();
      }
    }
    this.goal = next;
  }

  getGoal(): GoalSnapshot | null {
    return this.goal;
  }

  getTodos(): readonly TodoItem[] {
    return this.todos;
  }

  /**
   * Track one subagent's live todo progress on the strip below the lanes
   * (Phase 5-B). Idempotent per subagent id: new ids enter with the board's
   * entrance settle, count changes flash the count cell. Rows are bounded by
   * MAX_SUBAGENT_ROWS; lifecycle completion removes them explicitly.
   */
  setSubagentTodos(input: SubagentTodosInput): void {
    const done = input.todos.filter((todo) => todo.status === 'done').length;
    const total = input.todos.length;
    const now = appearanceAnimationNow();
    const existing = this.subagentRows.get(input.subagentId);
    if (existing !== undefined) {
      existing.name = input.name;
      if (existing.done !== done || existing.total !== total) {
        existing.done = done;
        existing.total = total;
        existing.updatedAtMs = now;
      }
    } else {
      this.subagentRows.set(input.subagentId, {
        subagentId: input.subagentId,
        name: input.name,
        done,
        total,
        enteredAtMs: now,
        updatedAtMs: now,
      });
      this.evictExcessSubagentRows();
    }
    this.subagentVersion += 1;
  }

  /**
   * Drop a finished subagent's strip row. Returns true when a row left, so
   * callers can request a frame; the removal flashes the strip header with
   * the board's settle-flash feedback.
   */
  removeSubagent(subagentId: string): boolean {
    if (!this.subagentRows.delete(subagentId)) return false;
    this.subagentStripFlashAtMs = appearanceAnimationNow();
    this.subagentVersion += 1;
    return true;
  }

  clearSubagents(): void {
    if (this.subagentRows.size === 0 && this.subagentStripFlashAtMs === undefined) return;
    this.subagentRows = new Map();
    this.subagentStripFlashAtMs = undefined;
    this.subagentVersion += 1;
  }

  /** Strip snapshot in display order (insertion order), for tests/inspection. */
  getSubagentStrip(): readonly SubagentStripEntry[] {
    return [...this.subagentRows.values()].map(({ subagentId, name, done, total }) => ({
      subagentId,
      name,
      done,
      total,
    }));
  }

  bumpActivity(): void {
    this.callsSinceUpdate += 1;
  }

  resetActivity(): void {
    this.callsSinceUpdate = 0;
  }

  clear(): void {
    this.todos = [];
    this.expanded = false;
    this.recentChanges = new Map();
    this.changeSummary = undefined;
    this.callsSinceUpdate = 0;
    this.goal = null;
    this.goalSnapshotKey = null;
    this.goalChangedAtMs = undefined;
    this.lastBoardRows = 0;
    this.boardShrinkRequestedAtMs = undefined;
    this.lastPositions = new Map();
    this.motionCues = new Map();
    this.positionBase = undefined;
    this.lastLaneCounts = { done: 0, in_progress: 0, pending: 0 };
    this.laneCountFlashes = {};
    this.subagentRows = new Map();
    this.subagentStripFlashAtMs = undefined;
    this.lastRender = undefined;
    this.scrollOffset = 0;
  }

  isEmpty(): boolean {
    return this.todos.length === 0 && !isLiveGoal(this.goal);
  }

  hasLiveGoal(): boolean {
    return isLiveGoal(this.goal);
  }

  /** True when the list exceeds the collapsed cap, i.e. there is something to expand. */
  hasOverflow(): boolean {
    return this.todos.length > MAX_VISIBLE;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  /**
   * Move the collapsed board's viewport. Returns true only when the window
   * actually shifted, so input handlers consume wheel / key events solely
   * while the board has overflow to scroll — at the edges (or without a
   * height budget) the event falls through to its previous owner.
   */
  scrollBoard(action: TodoBoardScrollAction): boolean {
    const total = this.laneMaxRows();
    const viewport = this.viewportBoardRows(total);
    if (viewport === undefined || viewport >= total) return false;
    const maxOffset = total - viewport;
    const next = this.nextScrollOffset(action, viewport);
    const clamped = Math.min(maxOffset, Math.max(0, next));
    if (clamped === this.scrollOffset) return false;
    this.scrollOffset = clamped;
    return true;
  }

  /** Current window position; offset is clamped, viewport falls back to total. */
  getScrollSnapshot(): TodoBoardScrollSnapshot {
    const total = this.laneMaxRows();
    const viewport = this.viewportBoardRows(total) ?? total;
    const offset = Math.min(this.scrollOffset, Math.max(0, total - viewport));
    return { offset, viewport, total };
  }

  private nextScrollOffset(action: TodoBoardScrollAction, viewport: number): number {
    switch (action) {
      case 'line-up':
        return this.scrollOffset - 1;
      case 'line-down':
        return this.scrollOffset + 1;
      case 'page-up':
        return this.scrollOffset - Math.max(1, viewport - 1);
      case 'page-down':
        return this.scrollOffset + Math.max(1, viewport - 1);
      case 'top':
        return 0;
      case 'bottom':
        return Number.MAX_SAFE_INTEGER;
    }
  }

  /** Longest lane in cards; the board grid has this many rows. */
  private laneMaxRows(): number {
    const counts = countTodos(this.todos);
    return Math.max(counts.done, counts.in_progress, counts.pending);
  }

  /**
   * Board rows the stage can lend the panel, or undefined when the host
   * gave no terminal height (legacy callers). A third of the terminal —
   * the BTW panel's share — minus chrome, clamped to a calm range.
   */
  private boardRowBudget(): number | undefined {
    const rows = this.options.terminalRows?.();
    if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return undefined;
    const budget = Math.floor(rows / 3) - BOARD_VIEWPORT_CHROME_ROWS;
    return Math.min(BOARD_MAX_VIEWPORT_ROWS, Math.max(BOARD_MIN_VIEWPORT_ROWS, budget));
  }

  /** Rows the collapsed board may paint; undefined keeps the legacy selection. */
  private viewportBoardRows(total: number): number | undefined {
    const budget = this.boardRowBudget();
    return budget === undefined ? undefined : Math.min(total, budget);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const liveGoal = isLiveGoal(this.goal) ? this.goal : null;
    if (this.todos.length === 0 && liveGoal === null) return [];

    // While the change flash is active the frame is time-driven; otherwise
    // unchanged state must yield byte-identical lines so the renderer's line
    // diff can skip this panel during ambient ticks.
    const animating =
      this.currentChangeSummary() !== undefined || this.subagentStripAnimating();
    // The goal wall-clock label advances once per second; bucketing keeps the
    // memo valid within that second.
    const secondBucket = Math.floor(appearanceAnimationNow() / 1000);
    const budget = this.boardRowBudget() ?? -1;
    const memo = this.lastRender;
    if (
      !animating &&
      memo !== undefined &&
      memo.width === width &&
      memo.expanded === this.expanded &&
      memo.todos === this.todos &&
      memo.goal === this.goal &&
      memo.calls === this.callsSinceUpdate &&
      memo.subagents === this.subagentVersion &&
      memo.secondBucket === secondBucket &&
      memo.scroll === this.scrollOffset &&
      memo.budget === budget
    ) {
      return memo.lines;
    }

    const profile = resolveResponsiveLayout({ width });
    if (profile === 'tiny') {
      // Not the board path: drop hysteresis so a later board render starts clean.
      this.lastBoardRows = 0;
      this.boardShrinkRequestedAtMs = undefined;
    }
    const contentWidth = this.interiorWidth(width, profile);
    const lines: string[] = [];

    if (liveGoal !== null) {
      const wallClockMs = this.goalWallClockMs(liveGoal);
      lines.push(
        ...renderGoalMonitorLines({
          goal: liveGoal,
          width: contentWidth,
          wallClockMs,
          changedAtMs: this.goalChangedAtMs,
          profile,
        }),
      );
      if (this.todos.length > 0) {
        lines.push(currentTheme.fg('border', `  ${'─'.repeat(Math.max(4, Math.min(24, contentWidth - 2)))}`));
      }
    }

    if (this.todos.length > 0) {
      lines.push(...this.buildTodoContent(width, profile));
      // Subagents strip (Phase 5-B): live child progress below the lanes.
      // It follows the board's visibility — rendered only while the board
      // itself is on screen, inside the same panel frame.
      const stripLines = this.renderSubagentStrip(contentWidth);
      if (stripLines.length > 0) {
        lines.push(
          currentTheme.fg('border', `  ${'─'.repeat(Math.max(4, Math.min(24, contentWidth - 2)))}`),
        );
        lines.push(...stripLines);
      }
    }

    if (profile === 'tiny') {
      const tinyLines = lines.map((line) => truncateToWidth(line, width));
      // Time-driven frames must not be memoized: a render after the cues
      // expire but inside the same second bucket would otherwise reuse the
      // still-flashing bytes instead of settling.
      return animating ? tinyLines : this.memoizeRender(width, secondBucket, budget, tinyLines);
    }

    const counts = countTodos(this.todos);
    const title =
      liveGoal !== null
        ? this.todos.length > 0
          ? ` Goal · ${liveGoal.status} · ${String(counts.done)}/${String(this.todos.length)} done `
          : goalMonitorTitle(liveGoal, profile)
        : ` Todo Board · ${String(counts.done)}/${String(this.todos.length)} done `;
    const borderToken =
      liveGoal !== null ? goalMonitorBorderToken(liveGoal.status) : 'border';

    const panelLines = renderRoundedPanel({
      title,
      content: lines,
      width,
      borderToken,
      leftMargin: 2,
      minBoxWidth: profile === 'compact' ? 60 : BOARD_MIN_WIDTH,
    });
    // See the tiny path: animating frames stay out of the memo so expired
    // cues settle to resting bytes on the very next render.
    return animating ? panelLines : this.memoizeRender(width, secondBucket, budget, panelLines);
  }

  private goalWallClockMs(goal: GoalSnapshot): number {
    if (goal.status !== 'active') return goal.wallClockMs;
    return goal.wallClockMs + Math.max(0, Date.now() - this.goalObservedAtMs);
  }

  private buildTodoContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    const contentWidth = this.interiorWidth(width, profile);
    const lines: string[] = [
      renderBoardMeta(this.todos, this.currentChangeSummary(), this.callsSinceUpdate),
    ];

    const highlights = this.currentHighlights();
    const changedAtMs = this.currentChangeSummary()?.changedAtMs;
    const stabilizeRows = (rows: number): number => this.stabilizeBoardRows(rows);
    const laneFlashes = this.currentLaneFlashes();
    if (this.expanded) {
      this.refreshMotionCues(this.todos, changedAtMs);
      lines.push(
        ...renderTodos(
          this.todos,
          contentWidth,
          highlights,
          changedAtMs,
          profile,
          stabilizeRows,
          this.currentMotionCues(),
          laneFlashes,
        ),
      );
      if (this.todos.length > MAX_VISIBLE) {
        lines.push(
          currentTheme.fg('textDim', `  all ${String(this.todos.length)} items · ctrl+t to collapse`),
        );
      }
    } else {
      const laneRows = this.laneMaxRows();
      const viewport = this.viewportBoardRows(laneRows);
      if (viewport !== undefined) {
        // Windowed board: the full list stays in state; only the visible
        // row range renders. Boards that fit the budget paint every card
        // with no indicator — byte-identical to the unwindowed render.
        const offset = Math.min(this.scrollOffset, Math.max(0, laneRows - viewport));
        this.scrollOffset = offset;
        const rows = windowTodos(this.todos, offset, viewport);
        this.refreshMotionCues(rows, changedAtMs);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            this.currentMotionCues(),
            laneFlashes,
          ),
        );
        if (viewport < laneRows) {
          lines.push(renderBoardScrollIndicator(this.todos, offset, viewport));
        }
      } else {
        const { rows, hidden, hiddenCounts } = selectVisibleTodos(this.todos);
        this.refreshMotionCues(rows, changedAtMs);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            this.currentMotionCues(),
            laneFlashes,
          ),
        );
        if (hidden > 0) {
          const distribution = formatHiddenCounts(hiddenCounts);
          const suffix = distribution.length > 0 ? ` (${distribution})` : '';
          lines.push(
            currentTheme.fg('textDim', `  … +${hidden} more${suffix} · ctrl+t to expand`),
          );
        }
      }
    }

    return lines;
  }

  private interiorWidth(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): number {
    if (profile === 'tiny') return width;
    const leftMargin = 2;
    const sidePadding = 1;
    return Math.max(1, width - leftMargin - 2 - 2 * sidePadding);
  }

  private currentChangeSummary(): TodoPanelChangeSummary | undefined {
    if (this.changeSummary === undefined) return undefined;
    const ageMs = appearanceAnimationNow() - this.changeSummary.changedAtMs;
    return ageMs <= changeFlashMs() ? this.changeSummary : undefined;
  }

  private currentHighlights(): ReadonlyMap<string, TodoChangeKind> {
    return this.currentChangeSummary() === undefined ? EMPTY_HIGHLIGHTS : this.recentChanges;
  }

  private currentMotionCues(): ReadonlyMap<string, CardMotionCue> {
    if (this.motionCues.size === 0) return EMPTY_MOTIONS;
    return shouldRenderAmbientEffects(getActiveAppearancePreferences())
      ? this.motionCues
      : EMPTY_MOTIONS;
  }

  private currentLaneFlashes(): Readonly<Partial<Record<TodoStatus, number>>> {
    return shouldRenderAmbientEffects(getActiveAppearancePreferences())
      ? this.laneCountFlashes
      : EMPTY_LANE_FLASHES;
  }

  private updateLaneCountFlashes(next: readonly TodoItem[]): void {
    const counts = countTodos(next);
    const now = appearanceAnimationNow();
    for (const status of TODO_STATUSES) {
      if (counts[status] !== this.lastLaneCounts[status]) {
        this.laneCountFlashes[status] = now;
      }
    }
    this.lastLaneCounts = counts;
  }

  /**
   * Diff rendered card positions once per (list, expanded) state and derive
   * motion cues: `enter` for cards newly visible (first appearance or
   * overflow window shift), `move` with a row direction for lane/index
   * travel. Expand/collapse recaptures positions silently — a viewport
   * change is not a card move.
   */
  private refreshMotionCues(
    rendered: readonly TodoItem[],
    changedAtMs: number | undefined,
  ): void {
    const base = this.positionBase;
    if (base !== undefined && base.todos === this.todos && base.expanded === this.expanded) {
      return;
    }
    const nextPositions = cardPositions(rendered);
    const stateChanged = base !== undefined && base.todos !== this.todos;
    if (stateChanged && changedAtMs !== undefined) {
      const cues = new Map<string, CardMotionCue>();
      for (const [title, position] of nextPositions) {
        const previous = this.lastPositions.get(title);
        if (previous === undefined) {
          cues.set(title, { kind: 'enter', startedAtMs: changedAtMs });
          continue;
        }
        if (previous.lane !== position.lane || previous.row !== position.row) {
          cues.set(title, {
            kind: 'move',
            direction:
              position.row > previous.row
                ? 'down'
                : position.row < previous.row
                  ? 'up'
                  : undefined,
            startedAtMs: changedAtMs,
          });
        }
      }
      this.motionCues = cues;
    } else {
      this.motionCues = new Map();
    }
    this.lastPositions = nextPositions;
    this.positionBase = { todos: this.todos, expanded: this.expanded };
  }

  private memoizeRender(width: number, secondBucket: number, budget: number, lines: string[]): string[] {
    this.lastRender = {
      width,
      expanded: this.expanded,
      todos: this.todos,
      goal: this.goal,
      calls: this.callsSinceUpdate,
      subagents: this.subagentVersion,
      secondBucket,
      scroll: this.scrollOffset,
      budget,
      lines,
    };
    return lines;
  }

  /** Grow instantly, but hold shrinks for BOARD_SHRINK_HOLD_MS to stop height bounce. */
  private stabilizeBoardRows(rows: number): number {
    if (rows >= this.lastBoardRows) {
      this.lastBoardRows = rows;
      this.boardShrinkRequestedAtMs = undefined;
      return rows;
    }
    if (this.boardShrinkRequestedAtMs === undefined) {
      this.boardShrinkRequestedAtMs = appearanceAnimationNow();
      return this.lastBoardRows;
    }
    if (appearanceAnimationNow() - this.boardShrinkRequestedAtMs >= BOARD_SHRINK_HOLD_MS) {
      this.lastBoardRows = rows;
      this.boardShrinkRequestedAtMs = undefined;
      return rows;
    }
    return this.lastBoardRows;
  }

  /** Keep the strip bounded: drop earliest-entered rows past the cap. */
  private evictExcessSubagentRows(): void {
    while (this.subagentRows.size > MAX_SUBAGENT_ROWS) {
      // Map iterates in insertion order; updates never reorder, so the first
      // key is the earliest-entered row.
      const oldest = this.subagentRows.keys().next();
      if (oldest.done === true) break;
      this.subagentRows.delete(oldest.value);
    }
  }

  /**
   * True while any strip settle flash is live. Gated on ambient effects so
   * off / SSH / NO_COLOR / CI sessions never emit time-driven frames — the
   * strip stays information-only there.
   */
  private subagentStripAnimating(): boolean {
    if (this.subagentRows.size === 0 && this.subagentStripFlashAtMs === undefined) return false;
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return false;
    if (
      this.subagentStripFlashAtMs !== undefined &&
      isToneSettleFlashActive(this.subagentStripFlashAtMs, appearance)
    ) {
      return true;
    }
    for (const row of this.subagentRows.values()) {
      if (isToneSettleFlashActive(row.enteredAtMs, appearance)) return true;
      if (isToneSettleFlashActive(row.updatedAtMs, appearance)) return true;
    }
    return false;
  }

  /**
   * Compact strip under the three lanes: header plus one row per tracked
   * subagent (short name, mini ratio bar, done/total). Reuses the board's
   * settle flash for entrance, count changes, and removal feedback; with
   * ambient effects gated off every byte is static.
   */
  private renderSubagentStrip(contentWidth: number): string[] {
    if (this.subagentRows.size === 0) return [];
    const appearance = getActiveAppearancePreferences();
    const animatable = shouldRenderAmbientEffects(appearance);
    const headerText = `subagents (${String(this.subagentRows.size)})`;
    const header =
      animatable &&
      this.subagentStripFlashAtMs !== undefined &&
      isToneSettleFlashActive(this.subagentStripFlashAtMs, appearance)
        ? renderToneSettleFlash(
            headerText,
            'todo:subagent-strip',
            this.subagentStripFlashAtMs,
            'primary',
            appearance,
          )
        : currentTheme.boldFg('textStrong', headerText);
    const lines = [`${BOARD_INDENT}${header}`];
    for (const row of this.subagentRows.values()) {
      lines.push(this.renderSubagentStripRow(row, contentWidth, animatable, appearance));
    }
    return lines;
  }

  private renderSubagentStripRow(
    row: SubagentStripRow,
    contentWidth: number,
    animatable: boolean,
    appearance: AppearancePreferences,
  ): string {
    const ratio = row.total > 0 ? row.done / row.total : 0;
    const bar = renderRendererRatioProgressBar({
      ratio,
      width: SUBAGENT_BAR_WIDTH,
      filledStyle: (text) => currentTheme.fg('success', text),
      emptyStyle: (text) => currentTheme.fg('textMuted', text),
    });
    const countText = `${String(row.done)}/${String(row.total)}`;
    const count =
      animatable && isToneSettleFlashActive(row.updatedAtMs, appearance)
        ? renderToneSettleFlash(
            countText,
            `todo:subagent-count:${row.subagentId}`,
            row.updatedAtMs,
            'primary',
            appearance,
          )
        : row.total > 0 && row.done === row.total
          ? currentTheme.fg('success', countText)
          : currentTheme.fg('textDim', countText);
    // ` ▸ ` before the name, then ` <bar> <count>` after it.
    const suffixWidth = 1 + SUBAGENT_BAR_WIDTH + 1 + countText.length;
    const nameWidth = Math.max(
      8,
      contentWidth - visibleWidth(BOARD_INDENT) - 2 - suffixWidth,
    );
    const displayName = truncateToWidth(row.name, nameWidth, '…');
    const name =
      animatable && isToneSettleFlashActive(row.enteredAtMs, appearance)
        ? renderSettleFlash(
            displayName,
            `todo:subagent:${row.subagentId}`,
            row.enteredAtMs,
            appearance,
          )
        : currentTheme.fg('text', displayName);
    return `${BOARD_INDENT}${currentTheme.fg('primary', '▸')} ${name} ${bar} ${count}`;
  }
}

