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
  renderRendererDividerRow,
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
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
import {
  GOAL_DOT,
  PENDING_GLYPH,
  PULSE_ACTIVE_FRAMES,
  TODO_ADDED,
  TODO_COMPLETED,
  TODO_MOVED,
  TODO_REOPENED,
} from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  renderPulseGlyph,
  renderSettleFlash,
  renderShimmerPrefix,
  renderToneSettleFlash,
  resolveQualityAdjustedAmbientEffectMode,
  SETTLE_FLASH_MS,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}

const MAX_VISIBLE = 5;
const BOARD_MIN_WIDTH = 72;
const BOARD_COLUMN_MIN_WIDTH = 16;
const BOARD_INDENT = '  ';
const BOARD_SEPARATOR = ' │ ';
const STALE_TOOL_CALLS = 2;
/**
 * Grace period before the board may shrink. Cards hop between lanes on
 * updates; shrinking instantly would bounce the panel height and flicker,
 * so shrinks are delayed while growth stays instant.
 */
const BOARD_SHRINK_HOLD_MS = 1500;

function changeFlashMs(): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences());
  return mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS;
}
const EMPTY_HIGHLIGHTS: ReadonlyMap<string, TodoChangeKind> = new Map();

/**
 * Card-motion transition budget. A true vertical FLIP offset is not viable
 * in this grid: every board row joins all three lane cells, so a card
 * sliding through a neighbour's row would either overwrite that card or
 * flash a `No cards` gap, and it would fight the shrink-hold padding. The
 * rearrangement instead reads as motion through cues that stay inside the
 * card's own cell — a decaying slide-in indent (absorbed by the cell's
 * right padding), a directional brand glyph, and a brand title fade.
 */
const BOARD_MOVE_CUE_MS = 320;
const MOVE_SLIDE_MAX_INDENT = 2;
const MOVE_GLYPH_UP = '▴';
const MOVE_GLYPH_DOWN = '▾';

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'done'];

function moveCueMs(): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences());
  return mode === 'subtle' ? BOARD_MOVE_CUE_MS * 1.4 : BOARD_MOVE_CUE_MS;
}

/** Clock-driven 0→1 decay; shared by the slide, glyph, and title-fade stages. */
function cueProgress(startedAtMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (appearanceAnimationNow() - startedAtMs) / durationMs));
}

interface CardPosition {
  readonly lane: TodoStatus;
  readonly row: number;
}

interface CardMotionCue {
  readonly kind: 'move' | 'enter';
  /** Row travel direction for moves; undefined for lane hops on the same row. */
  readonly direction?: 'up' | 'down';
  readonly startedAtMs: number;
}

const EMPTY_MOTIONS: ReadonlyMap<string, CardMotionCue> = new Map();
const EMPTY_LANE_FLASHES: Readonly<Partial<Record<TodoStatus, number>>> = {};

/** Lane row of each rendered card, keyed by title (same identity as diffTodos). */
function cardPositions(todos: readonly TodoItem[]): Map<string, CardPosition> {
  const laneRows: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  const positions = new Map<string, CardPosition>();
  for (const todo of todos) {
    const row = laneRows[todo.status];
    laneRows[todo.status] = row + 1;
    positions.set(todo.title, { lane: todo.status, row });
  }
  return positions;
}

export interface VisibleTodos {
  readonly rows: readonly TodoItem[];
  readonly hidden: number;
  readonly hiddenCounts: Record<TodoStatus, number>;
}

type TodoChangeKind = 'added' | 'moved' | 'completed' | 'reopened';

interface TodoPanelChangeSummary {
  readonly added: number;
  readonly completed: number;
  readonly moved: number;
  readonly reopened: number;
  readonly removed: number;
  readonly reordered: boolean;
  readonly changedAtMs: number;
}

/**
 * Pick which todos to render when the list exceeds {@link MAX_VISIBLE}.
 *
 * The selector is order-agnostic — the TodoList tool keeps whatever
 * order the model produced and does not group items by status, so an
 * interleaved sequence like `pending, done, pending, done, ...` is
 * possible and must still yield MAX_VISIBLE rows when enough exist.
 *
 * Strategy:
 * 1. Include every `in_progress` item (capped at MAX_VISIBLE).
 * 2. Fill remaining slots with "what's next" — the earliest `pending`
 *    items in their original positions — while reserving one slot for
 *    "what just finished" — the latest `done` item — when both kinds
 *    exist. If one side has too few candidates, the other expands.
 *
 * Items are returned in their original order.
 */
export function selectVisibleTodos(todos: readonly TodoItem[]): VisibleTodos {
  if (todos.length <= MAX_VISIBLE) {
    return {
      rows: [...todos],
      hidden: 0,
      hiddenCounts: { done: 0, in_progress: 0, pending: 0 },
    };
  }

  const inProgress: number[] = [];
  const pending: number[] = [];
  const done: number[] = [];
  for (const [i, todo] of todos.entries()) {
    if (todo.status === 'in_progress') inProgress.push(i);
    else if (todo.status === 'pending') pending.push(i);
    else done.push(i);
  }

  const picked = new Set<number>();
  for (const i of inProgress.slice(0, MAX_VISIBLE)) picked.add(i);

  if (picked.size < MAX_VISIBLE) {
    // Most recent done first; earliest pending first.
    const doneCandidates = done.toReversed();
    const pendingCandidates = pending;

    const remaining = MAX_VISIBLE - picked.size;
    let doneCount: number;
    let pendingCount: number;
    if (doneCandidates.length === 0) {
      doneCount = 0;
      pendingCount = Math.min(remaining, pendingCandidates.length);
    } else if (pendingCandidates.length === 0) {
      pendingCount = 0;
      doneCount = Math.min(remaining, doneCandidates.length);
    } else {
      doneCount = 1;
      pendingCount = Math.min(remaining - 1, pendingCandidates.length);
      if (pendingCount < remaining - 1) {
        doneCount = Math.min(doneCandidates.length, remaining - pendingCount);
      }
    }

    for (let i = 0; i < doneCount; i++) picked.add(doneCandidates[i] as number);
    for (let i = 0; i < pendingCount; i++) picked.add(pendingCandidates[i] as number);
  }

  const sortedIdx = [...picked].toSorted((a, b) => a - b);

  const hiddenCounts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  for (const [i, todo] of todos.entries()) {
    if (!picked.has(i)) {
      hiddenCounts[todo.status] += 1;
    }
  }

  return {
    rows: sortedIdx.map((i) => todos[i] as TodoItem),
    hidden: todos.length - sortedIdx.length,
    hiddenCounts,
  };
}

export class TodoPanelComponent implements Component {
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
  /** Frame memo: identical state yields the same lines array so the renderer diff skips the panel. */
  private lastRender:
    | {
        readonly width: number;
        readonly expanded: boolean;
        readonly todos: readonly TodoItem[];
        readonly goal: GoalSnapshot | null;
        readonly calls: number;
        readonly secondBucket: number;
        readonly lines: string[];
      }
    | undefined;

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
    this.lastRender = undefined;
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

  invalidate(): void {}

  render(width: number): string[] {
    const liveGoal = isLiveGoal(this.goal) ? this.goal : null;
    if (this.todos.length === 0 && liveGoal === null) return [];

    // While the change flash is active the frame is time-driven; otherwise
    // unchanged state must yield byte-identical lines so the renderer's line
    // diff can skip this panel during ambient ticks.
    const animating = this.currentChangeSummary() !== undefined;
    // The goal wall-clock label advances once per second; bucketing keeps the
    // memo valid within that second.
    const secondBucket = Math.floor(appearanceAnimationNow() / 1000);
    const memo = this.lastRender;
    if (
      !animating &&
      memo !== undefined &&
      memo.width === width &&
      memo.expanded === this.expanded &&
      memo.todos === this.todos &&
      memo.goal === this.goal &&
      memo.calls === this.callsSinceUpdate &&
      memo.secondBucket === secondBucket
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
    }

    if (profile === 'tiny') {
      const tinyLines = lines.map((line) => truncateToWidth(line, width));
      // Time-driven frames must not be memoized: a render after the cues
      // expire but inside the same second bucket would otherwise reuse the
      // still-flashing bytes instead of settling.
      return animating ? tinyLines : this.memoizeRender(width, secondBucket, tinyLines);
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
    return animating ? panelLines : this.memoizeRender(width, secondBucket, panelLines);
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

  private memoizeRender(width: number, secondBucket: number, lines: string[]): string[] {
    this.lastRender = {
      width,
      expanded: this.expanded,
      todos: this.todos,
      goal: this.goal,
      calls: this.callsSinceUpdate,
      secondBucket,
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

function renderTodos(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  profile: ReturnType<typeof resolveResponsiveLayout> = 'standard',
  stabilizeRows?: (rows: number) => number,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
  laneFlashes: Readonly<Partial<Record<TodoStatus, number>>> = EMPTY_LANE_FLASHES,
): string[] {
  if (profile === 'tiny') {
    return renderLanes(todos, width, highlights, changedAtMs, motions);
  }
  return width >= BOARD_MIN_WIDTH
    ? renderBoard(todos, width, highlights, changedAtMs, stabilizeRows, motions, laneFlashes)
    : renderLanes(todos, width, highlights, changedAtMs, motions);
}

function renderBoard(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  stabilizeRows?: (rows: number) => number,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
  laneFlashes: Readonly<Partial<Record<TodoStatus, number>>> = EMPTY_LANE_FLASHES,
): string[] {
  const availableWidth = Math.max(1, width - visibleWidth(BOARD_INDENT));
  const columnWidth = Math.floor(
    (availableWidth - visibleWidth(BOARD_SEPARATOR) * (TODO_LANES.length - 1)) /
      TODO_LANES.length,
  );
  if (columnWidth < BOARD_COLUMN_MIN_WIDTH) {
    return renderLanes(todos, width, highlights, changedAtMs, motions);
  }

  const lanes = TODO_LANES.map((lane) => ({
    ...lane,
    todos: todos.filter((todo) => todo.status === lane.status),
  }));
  const rawMaxRows = Math.max(1, ...lanes.map((lane) => lane.todos.length));
  // Hysteresis: grow instantly but delay shrinks so lane hops do not bounce the height.
  const maxRows = stabilizeRows === undefined ? rawMaxRows : stabilizeRows(rawMaxRows);
  const separator = currentTheme.fg('border', BOARD_SEPARATOR);
  const columnRule = renderRendererDividerRow({
    width: columnWidth,
    style: (text) => currentTheme.fg('border', text),
  });
  const lines = [
    BOARD_INDENT + lanes
      .map((lane) =>
        padCell(
          renderLaneHeader(lane.label, lane.todos.length, lane.status, laneFlashes[lane.status]),
          columnWidth,
        ),
      )
      .join(separator),
    BOARD_INDENT + lanes
      .map(() => columnRule)
      .join(separator),
  ];

  for (let row = 0; row < maxRows; row++) {
    lines.push(
      BOARD_INDENT + lanes
        .map((lane) => {
          const todo = lane.todos[row];
          if (todo === undefined) {
            return padCell(currentTheme.fg('textMuted', 'No cards'), columnWidth);
          }
          const cue = motions.get(todo.title);
          const indent = motionSlideIndent(cue);
          const cell = renderCell(todo, highlights.get(todo.title), changedAtMs, cue);
          // The slide indent borrows from the cell's own right padding, so
          // neighbouring columns never shift.
          return indent === 0
            ? padCell(cell, columnWidth)
            : ' '.repeat(indent) + padCell(cell, columnWidth - indent);
        })
        .join(separator),
    );
  }
  return lines;
}

function renderLanes(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
): string[] {
  const lines: string[] = [];
  for (const lane of TODO_LANES) {
    const laneTodos = todos.filter((todo) => todo.status === lane.status);
    if (laneTodos.length === 0) continue;
    lines.push(currentTheme.fg('textDim', `  ${lane.label}`));
    for (const todo of laneTodos) {
      lines.push(
        ...renderWrappedCell(todo, highlights.get(todo.title), changedAtMs, width, motions.get(todo.title)),
      );
    }
  }
  return lines;
}

function renderBoardMeta(
  todos: readonly TodoItem[],
  summary: TodoPanelChangeSummary | undefined,
  callsSinceUpdate: number,
): string {
  const counts = countTodos(todos);
  const total = todos.length;
  const ratio = total > 0 ? counts.done / total : 0;
  const wipText = `wip ${String(counts.in_progress)}/1`;
  const wip =
    counts.in_progress > 1
      ? currentTheme.boldFg('warning', wipText)
      : currentTheme.fg('textDim', wipText);
  const progress =
    total > 0
      ? `${renderRendererRatioProgressBar({
          ratio,
          width: 8,
          filledStyle: (text) => currentTheme.fg('success', text),
          emptyStyle: (text) => currentTheme.fg('textMuted', text),
        })}${currentTheme.fg('textDim', ` ${String(Math.round(ratio * 100))}%`)}`
      : undefined;
  const parts = [
    ...(progress !== undefined ? [progress] : []),
    wip,
    currentTheme.fg('textDim', `next ${String(counts.pending)}`),
    currentTheme.fg('textDim', `done ${String(counts.done)}`),
  ];
  const flow = summary === undefined ? undefined : formatChangeSummary(summary);
  if (flow !== undefined) {
    parts.unshift(currentTheme.fg('primary', `${renderShimmerPrefix()}flow ${flow}`));
  }
  if (callsSinceUpdate >= STALE_TOOL_CALLS) {
    parts.push(
      currentTheme.boldFg('warning', `stale · ${String(callsSinceUpdate)} calls since update`),
    );
  }
  return `  ${parts.join(currentTheme.fg('textMuted', ' · '))}`;
}

function renderLaneHeader(
  label: string,
  count: number,
  status: TodoStatus,
  countFlashStartedAtMs: number | undefined,
): string {
  const token = laneHeaderToken(status);
  const text = `${label} (${String(count)})`;
  const appearance = getActiveAppearancePreferences();
  // Count micro-feedback: a changed lane count briefly re-settles in its own
  // header tone. Resting bytes stay a single bold run when nothing flashes.
  if (
    countFlashStartedAtMs !== undefined &&
    shouldRenderAmbientEffects(appearance) &&
    isToneSettleFlashActive(countFlashStartedAtMs, appearance)
  ) {
    const countText = `(${String(count)})`;
    return `${currentTheme.boldFg(token, label)} ${renderToneSettleFlash(
      countText,
      `todo:lane-count:${status}`,
      countFlashStartedAtMs,
      token,
      appearance,
    )}`;
  }
  return currentTheme.boldFg(token, text);
}

function laneHeaderToken(status: TodoStatus): 'primary' | 'success' | 'textStrong' {
  switch (status) {
    case 'in_progress':
      return 'primary';
    case 'done':
      return 'success';
    case 'pending':
      return 'textStrong';
  }
}

function renderCell(
  todo: TodoItem,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  cue: CardMotionCue | undefined,
): string {
  const badge = changeBadge(change, cue);
  const marker = statusMarker(todo.status);
  const titleStyled = styleTitle(todo.title, todo.status, change, changedAtMs, cue);
  return `${badge}${marker} ${titleStyled}`;
}

function renderWrappedCell(
  todo: TodoItem,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  width: number,
  cue: CardMotionCue | undefined,
): string[] {
  const badge = changeBadge(change, cue);
  const marker = statusMarker(todo.status);
  const titleStyled = styleTitle(todo.title, todo.status, change, changedAtMs, cue);
  const firstPrefix = `${badge}${marker} `;
  const prefixWidth = visibleWidth(firstPrefix);
  const indent = motionSlideIndent(cue);
  const availableWidth = Math.max(
    1,
    width - visibleWidth(BOARD_INDENT) - prefixWidth - indent,
  );
  const titleLines =
    visibleWidth(titleStyled) <= availableWidth
      ? [titleStyled]
      : wrapTextWithAnsi(titleStyled, availableWidth);
  const slide = indent === 0 ? '' : ' '.repeat(indent);
  return titleLines.map((line, index) => {
    const prefix = index === 0 ? firstPrefix : ' '.repeat(prefixWidth);
    return `${BOARD_INDENT}${slide}${prefix}${line}`;
  });
}

function padCell(content: string, width: number): string {
  const truncated = truncateToWidth(content, width, '…');
  return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
}

function statusMarker(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return renderPulseGlyph(PULSE_ACTIVE_FRAMES, 'todo:in-progress', GOAL_DOT, 'primary');
    case 'done':
      return currentTheme.fg('success', '✓');
    case 'pending':
      return currentTheme.fg('textDim', PENDING_GLYPH);
  }
}

function styleTitle(
  title: string,
  status: TodoStatus,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  cue: CardMotionCue | undefined,
): string {
  const appearance = getActiveAppearancePreferences();
  const animatable = shouldRenderAmbientEffects(appearance);
  if (
    change !== undefined &&
    changedAtMs !== undefined &&
    animatable &&
    appearanceAnimationNow() - changedAtMs < changeFlashMs()
  ) {
    return renderSettleFlash(title, `todo:${change}:${title}`, changedAtMs, appearance);
  }
  if (cue !== undefined && animatable) {
    // Entrance settle for cards that surfaced without a change kind (e.g. an
    // overflow window shift); the change flash above already covers 'added'.
    if (cue.kind === 'enter' && isToneSettleFlashActive(cue.startedAtMs, appearance)) {
      return renderSettleFlash(title, `todo:enter:${title}`, cue.startedAtMs, appearance);
    }
    // Move transition: brand-color fade that decays into the resting style.
    if (cue.kind === 'move') {
      const p = cueProgress(cue.startedAtMs, moveCueMs());
      if (p < 0.35) return currentTheme.boldFg('primary', title);
      if (p < 0.7) return currentTheme.fg('primary', title);
    }
  }
  switch (status) {
    case 'in_progress':
      return currentTheme.boldFg('text', title);
    case 'done':
      return currentTheme.strikethroughFg('textDim', title);
    case 'pending':
      return currentTheme.fg('text', title);
  }
}

function changeBadge(change: TodoChangeKind | undefined, cue: CardMotionCue | undefined): string {
  const motion = motionBadge(cue);
  // A live directional badge subsumes the static moved arrow and is the only
  // badge for pure reorders (no change kind); semantic badges keep priority.
  if (motion !== '' && (change === undefined || change === 'moved')) return motion;
  if (change === undefined) return '';
  switch (change) {
    case 'added':
      return `${renderPulseGlyph([TODO_ADDED, '+'], 'todo:added', '+', 'accent')} `;
    case 'completed':
      return `${currentTheme.fg('success', TODO_COMPLETED)} `;
    case 'moved':
      return `${currentTheme.fg('primary', TODO_MOVED)} `;
    case 'reopened':
      return `${currentTheme.fg('warning', TODO_REOPENED)} `;
  }
}

/** Decaying directional glyph for moved cards; '' once settled or gated off. */
function motionBadge(cue: CardMotionCue | undefined): string {
  if (cue === undefined || cue.kind !== 'move') return '';
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return '';
  const p = cueProgress(cue.startedAtMs, moveCueMs());
  if (p >= 1) return '';
  const glyph =
    cue.direction === 'down'
      ? MOVE_GLYPH_DOWN
      : cue.direction === 'up'
        ? MOVE_GLYPH_UP
        : TODO_MOVED;
  return p < 0.5
    ? `${currentTheme.boldFg('primary', glyph)} `
    : `${currentTheme.fg('primary', glyph)} `;
}

/** Decaying slide-in indent (columns); 0 once settled or gated off. */
function motionSlideIndent(cue: CardMotionCue | undefined): number {
  if (cue === undefined) return 0;
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return 0;
  const p = cueProgress(cue.startedAtMs, moveCueMs());
  if (p < 0.35) return MOVE_SLIDE_MAX_INDENT;
  if (p < 0.7) return MOVE_SLIDE_MAX_INDENT - 1;
  return 0;
}

function countTodos(todos: readonly TodoItem[]): Record<TodoStatus, number> {
  const counts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  for (const todo of todos) counts[todo.status] += 1;
  return counts;
}

export function diffTodos(
  previous: readonly TodoItem[],
  next: readonly TodoItem[],
): {
  readonly highlights: Map<string, TodoChangeKind>;
  readonly summary: TodoPanelChangeSummary | undefined;
} {
  const previousByTitle = new Map(previous.map((todo) => [todo.title, todo]));
  const nextByTitle = new Map(next.map((todo) => [todo.title, todo]));
  const highlights = new Map<string, TodoChangeKind>();
  let added = 0;
  let completed = 0;
  let moved = 0;
  let reopened = 0;
  let removed = 0;

  for (const todo of next) {
    const before = previousByTitle.get(todo.title);
    if (before === undefined) {
      added += 1;
      highlights.set(todo.title, 'added');
      continue;
    }
    if (before.status === todo.status) continue;
    if (todo.status === 'done') {
      completed += 1;
      highlights.set(todo.title, 'completed');
    } else if (before.status === 'done') {
      reopened += 1;
      highlights.set(todo.title, 'reopened');
    } else {
      moved += 1;
      highlights.set(todo.title, 'moved');
    }
  }

  for (const todo of previous) {
    if (!nextByTitle.has(todo.title)) removed += 1;
  }

  const reordered =
    added === 0 &&
    removed === 0 &&
    previous.length === next.length &&
    previous.some((todo, index) => next[index]?.title !== todo.title);

  const changed = added + completed + moved + reopened + removed > 0 || reordered;
  return {
    highlights,
    summary: changed
      ? {
          added,
          completed,
          moved,
          reopened,
          removed,
          reordered,
          changedAtMs: appearanceAnimationNow(),
        }
      : undefined,
  };
}

function formatChangeSummary(summary: TodoPanelChangeSummary): string | undefined {
  const parts: string[] = [];
  if (summary.added > 0) parts.push(`+${String(summary.added)}`);
  if (summary.completed > 0) parts.push(`${String(summary.completed)} done`);
  if (summary.moved > 0) parts.push(`${String(summary.moved)} moved`);
  if (summary.reopened > 0) parts.push(`${String(summary.reopened)} reopened`);
  if (summary.removed > 0) parts.push(`${String(summary.removed)} pruned`);
  if (summary.reordered) parts.push('reordered');
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const STATUS_LABELS: readonly { status: TodoStatus; label: string }[] = [
  { status: 'done', label: 'done' },
  { status: 'in_progress', label: 'in progress' },
  { status: 'pending', label: 'pending' },
];

const TODO_LANES: readonly { status: TodoStatus; label: string }[] = [
  { status: 'in_progress', label: 'Doing' },
  { status: 'pending', label: 'Next' },
  { status: 'done', label: 'Done' },
];

export function formatHiddenCounts(counts: Record<TodoStatus, number>): string {
  return STATUS_LABELS.filter(({ status }) => counts[status] > 0)
    .map(({ status, label }) => `${counts[status]} ${label}`)
    .join(' · ');
}

export function formatSwarmMemberTodoLines(
  todos: readonly TodoItem[],
  width: number,
  // Palette now comes from currentTheme; the parameter stays for cross-component callers.
  _colors: ColorPalette,
  _memberLabel?: string,
): string[] {
  if (todos.length === 0) return [];
  const visible = selectVisibleTodos(todos);
  const doing = visible.rows.find((todo) => todo.status === 'in_progress');
  const next = visible.rows.find((todo) => todo.status === 'pending');
  const doneCount = todos.filter((todo) => todo.status === 'done').length;
  const lines: string[] = [];
  if (doing !== undefined) {
    lines.push(
      ` ${currentTheme.fg('primary', '▸')} doing: ${truncateToWidth(doing.title, Math.max(8, width - 11), '…')}`,
    );
  }
  if (next !== undefined) {
    lines.push(
      ` ${currentTheme.fg('textDim', PENDING_GLYPH)} next: ${truncateToWidth(next.title, Math.max(8, width - 9), '…')}`,
    );
  }
  if (doneCount > 0) {
    lines.push(` ${currentTheme.fg('success', '✓')} done: ${String(doneCount)}`);
  }
  return lines.slice(0, 3);
}
