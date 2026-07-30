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

import { truncateToWidth, type Component } from '#/tui/renderer';
import type { GoalSnapshot } from '@superliora/sdk';

import {
  goalMonitorBorderToken,
  goalMonitorSnapshotKey,
  goalMonitorTitle,
  isLiveGoal,
  renderGoalMonitorLines,
} from '#/tui/components/chrome/goal-monitor';
import { currentTheme } from '#/tui/theme/theme';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import {
  appearanceAnimationNow,
} from '#/tui/features/appearance/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';

import {
  MAX_VISIBLE,
  countTodos,
  diffTodos,
  formatHiddenCounts,
  selectVisibleTodos,
  windowTodos,
  type TodoChangeKind,
  type TodoPanelChangeSummary,
} from './todo-panel-model';
import { EMPTY_HIGHLIGHTS, TodoPanelMotionTracker } from './todo-panel-motion';
import {
  BOARD_MIN_WIDTH,
  changeFlashMs,
  renderBoardMeta,
  renderBoardScrollIndicator,
  renderTodos,
} from './todo-panel-render';
import {
  clampScrollOffset,
  computeBoardRowBudget,
  computeViewportBoardRows,
  nextScrollOffset,
} from './todo-panel-scroll';
import { TodoPanelSubagentStrip } from './todo-panel-subagent-strip';
import type {
  SubagentStripEntry,
  SubagentTodosInput,
  TodoBoardScrollAction,
  TodoBoardScrollSnapshot,
  TodoItem,
  TodoPanelOptions,
  TodoStatus,
} from './todo-panel-types';

export {
  formatHiddenCounts,
  selectVisibleTodos,
  diffTodos,
  type VisibleTodos,
} from './todo-panel-model';
export { formatSwarmMemberTodoLines } from './todo-panel-render';
export type {
  SubagentStripEntry,
  SubagentTodosInput,
  TodoBoardScrollAction,
  TodoBoardScrollSnapshot,
  TodoItem,
  TodoPanelOptions,
  TodoStatus,
} from './todo-panel-types';

/**
 * Grace period before the board may shrink. Cards hop between lanes on
 * updates; shrinking instantly would bounce the panel height and flicker,
 * so shrinks are delayed while growth stays instant.
 */
const BOARD_SHRINK_HOLD_MS = 1500;

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
  private readonly motion = new TodoPanelMotionTracker();
  private readonly subagentStrip = new TodoPanelSubagentStrip();
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
    this.motion.updateLaneCountFlashes(next);
    if (next.length === 0) {
      // An empty board has no layout; the next batch enters fresh.
      this.motion.reset();
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

  setSubagentTodos(input: SubagentTodosInput): void {
    this.subagentStrip.setTodos(input);
  }

  removeSubagent(subagentId: string): boolean {
    return this.subagentStrip.remove(subagentId);
  }

  clearSubagents(): void {
    this.subagentStrip.clear();
  }

  getSubagentStrip(): readonly SubagentStripEntry[] {
    return this.subagentStrip.getStrip();
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
    this.motion.reset();
    this.subagentStrip.reset();
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
    const next = nextScrollOffset(this.scrollOffset, action, viewport);
    const clamped = clampScrollOffset(next, total, viewport);
    if (clamped === this.scrollOffset) return false;
    this.scrollOffset = clamped;
    return true;
  }

  /** Current window position; offset is clamped, viewport falls back to total. */
  getScrollSnapshot(): TodoBoardScrollSnapshot {
    const total = this.laneMaxRows();
    const viewport = this.viewportBoardRows(total) ?? total;
    const offset = clampScrollOffset(this.scrollOffset, total, viewport);
    return { offset, viewport, total };
  }

  /** Longest lane in cards; the board grid has this many rows. */
  private laneMaxRows(): number {
    const counts = countTodos(this.todos);
    return Math.max(counts.done, counts.in_progress, counts.pending);
  }

  private boardRowBudget(): number | undefined {
    return computeBoardRowBudget(this.options.terminalRows);
  }

  private viewportBoardRows(total: number): number | undefined {
    return computeViewportBoardRows(total, this.boardRowBudget());
  }

  invalidate(): void {}

  render(width: number): string[] {
    const liveGoal = isLiveGoal(this.goal) ? this.goal : null;
    if (this.todos.length === 0 && liveGoal === null) return [];

    // While the change flash is active the frame is time-driven; otherwise
    // unchanged state must yield byte-identical lines so the renderer's line
    // diff can skip this panel during ambient ticks.
    const animating =
      this.currentChangeSummary() !== undefined || this.subagentStrip.isAnimating();
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
      memo.subagents === this.subagentStrip.getVersion() &&
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
      const stripLines = this.subagentStrip.render(contentWidth);
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
    const laneFlashes = this.motion.currentLaneFlashes();
    if (this.expanded) {
      this.motion.refreshMotionCues(this.todos, this.expanded, this.todos, changedAtMs);
      lines.push(
        ...renderTodos(
          this.todos,
          contentWidth,
          highlights,
          changedAtMs,
          profile,
          stabilizeRows,
          this.motion.currentMotionCues(),
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
        const offset = clampScrollOffset(this.scrollOffset, laneRows, viewport);
        this.scrollOffset = offset;
        const rows = windowTodos(this.todos, offset, viewport);
        this.motion.refreshMotionCues(this.todos, this.expanded, rows, changedAtMs);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            this.motion.currentMotionCues(),
            laneFlashes,
          ),
        );
        if (viewport < laneRows) {
          lines.push(renderBoardScrollIndicator(this.todos, offset, viewport));
        }
      } else {
        const { rows, hidden, hiddenCounts } = selectVisibleTodos(this.todos);
        this.motion.refreshMotionCues(this.todos, this.expanded, rows, changedAtMs);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            this.motion.currentMotionCues(),
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

  private memoizeRender(width: number, secondBucket: number, budget: number, lines: string[]): string[] {
    this.lastRender = {
      width,
      expanded: this.expanded,
      todos: this.todos,
      goal: this.goal,
      calls: this.callsSinceUpdate,
      subagents: this.subagentStrip.getVersion(),
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
}
