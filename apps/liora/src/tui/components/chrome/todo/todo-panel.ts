/**
 * TodoPanel — live Job board shown before the input area.
 * The host projects operator Job cards into lanes; card movement, focus and
 * streaming reveals share the existing appearance animation clock.
 */

import { truncateToWidth, type Component } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme/theme';
import { resolveResponsiveLayout } from '#/tui/controllers/layout/responsive-layout';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  CHROME_BAND_LEFT_MARGIN,
  CHROME_BAND_SIDE_PADDING,
  chromeBandInteriorWidth,
  renderRoundedPanel,
} from '#/tui/utils/ui/panel-frame';
import { formatJobDuration } from '#/tui/utils/job/job-strip';
import {
  createStreamingTextRevealState,
  isRevealCaughtUp,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
  type StreamingTextRevealState,
} from '#/tui/utils/streaming/streaming-text-reveal';

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
  boardNeedsMarquee,
  renderTodoDenseFooter,
  renderTodoFocus,
  renderTodoTicker,
  renderTodos,
  type CardMotionCue,
} from './todo-panel-render';
import {
  clampScrollOffset,
  computeBoardRowBudget,
  computeViewportBoardRows,
  nextScrollOffset,
} from './todo-panel-scroll';
import type {
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
  TodoBoardScrollAction,
  TodoBoardScrollSnapshot,
  TodoFocusLink,
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
  private lastBoardRows = 0;
  private boardShrinkRequestedAtMs: number | undefined;
  private readonly motion = new TodoPanelMotionTracker();
  /** Frame memo: identical state yields the same lines array so the renderer diff skips the panel. */
  private lastRender:
    | {
        readonly width: number;
        readonly expanded: boolean;
        readonly todos: readonly TodoItem[];
        readonly calls: number;
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
  /** WIP title currently tracked for focus age. */
  private focusTitle: string | undefined;
  private focusStartedAtMs: number | undefined;
  /** Enter-cue type-on reveal per card title. */
  private readonly revealByTitle = new Map<string, StreamingTextRevealState>();
  private lastRevealTickMs = 0;

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
    this.syncFocusTracking(next);
    if (next.length === 0) {
      // An empty board has no layout; the next batch enters fresh.
      this.motion.reset();
      this.revealByTitle.clear();
      this.focusTitle = undefined;
      this.focusStartedAtMs = undefined;
    }
  }

  private syncFocusTracking(todos: readonly TodoItem[]): void {
    const wip = todos.find((todo) => todo.status === 'in_progress');
    const title = wip?.title;
    if (title === this.focusTitle) return;
    this.focusTitle = title;
    this.focusStartedAtMs =
      title === undefined ? undefined : appearanceAnimationNow();
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
    this.lastBoardRows = 0;
    this.boardShrinkRequestedAtMs = undefined;
    this.motion.reset();
    this.lastRender = undefined;
    this.scrollOffset = 0;
  }

  isEmpty(): boolean {
    return this.todos.length === 0;
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
    if (this.todos.length === 0) return [];

    // While the change flash is active the frame is time-driven; otherwise
    // unchanged state must yield byte-identical lines so the renderer's line
    // diff can skip this panel during ambient ticks.
    // Catch up enter reveals before the memo gate so a large clock jump (or
    // the frame after the settle window) can memoize resting bytes.
    this.catchUpEnterReveals();
    const contentWidthForMarquee = this.interiorWidth(width, resolveResponsiveLayout({ width }));
    const ambient = shouldRenderAmbientEffects(getActiveAppearancePreferences());
    const revealPending = [...this.revealByTitle.values()].some(
      (state) => !isRevealCaughtUp(state),
    );
    const animating =
      this.currentChangeSummary() !== undefined ||
      boardNeedsMarquee(this.todos, contentWidthForMarquee) ||
      revealPending ||
      (ambient && this.todos.some((todo) => todo.status === 'in_progress'));
    // Focus age advances once per second while resting frames remain memoized.
    const secondBucket = Math.floor(appearanceAnimationNow() / 1000);
    const budget = this.boardRowBudget() ?? -1;
    const memo = this.lastRender;
    if (
      !animating &&
      memo !== undefined &&
      memo.width === width &&
      memo.expanded === this.expanded &&
      memo.todos === this.todos &&
      memo.calls === this.callsSinceUpdate &&
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


    if (this.todos.length > 0) {
      lines.push(...this.buildTodoContent(width, profile));
    }

    if (profile === 'tiny') {
      const tinyLines = lines.map((line) => truncateToWidth(line, width));
      // Time-driven frames must not be memoized: a render after the cues
      // expire but inside the same second bucket would otherwise reuse the
      // still-flashing bytes instead of settling.
      return animating
        ? tinyLines
: this.memoizeRender(width, secondBucket, budget, tinyLines);
    }

    const counts = countTodos(this.todos);
    const focusAge = this.focusAgeMs();
    const focusChip =
      focusAge !== undefined && focusAge > 0
        ? ` · focus ${formatJobDuration(focusAge)}`
        : '';
    const title = ` Job Board · ${String(counts.done)}/${String(this.todos.length)} done${focusChip} `;
    const borderToken = counts.in_progress > 0 ? 'primary' : 'border';

    const panelLines = renderRoundedPanel({
      title,
      content: lines,
      width,
      borderToken,
      leftMargin: CHROME_BAND_LEFT_MARGIN,
      sidePadding: CHROME_BAND_SIDE_PADDING,
      minBoxWidth: profile === 'compact' ? 60 : BOARD_MIN_WIDTH,
      fillWidth: true,
    });
    // See the tiny path: animating frames stay out of the memo so expired
    // cues settle to resting bytes on the very next render.
    return animating
      ? panelLines
      : this.memoizeRender(width, secondBucket, budget, panelLines);
  }

  private focusAgeMs(): number | undefined {
    if (this.focusStartedAtMs === undefined) return undefined;
    return Math.max(0, appearanceAnimationNow() - this.focusStartedAtMs);
  }


  private buildTodoContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    const contentWidth = this.interiorWidth(width, profile);
    const summary = this.currentChangeSummary();
    const highlights = this.currentHighlights();
    const live = shouldRenderAmbientEffects(getActiveAppearancePreferences());
    const lines: string[] = [
      renderBoardMeta(this.todos, summary, this.callsSinceUpdate),
    ];
    const ticker = renderTodoTicker(highlights, live && highlights.size > 0, summary);
    if (ticker !== undefined) lines.push(ticker);
    const focus = renderTodoFocus(
      this.todos,
      this.focusAgeMs(),
      this.options.resolveFocusLink?.(),
    );
    if (focus !== undefined) lines.push(focus);

    const changedAtMs = summary?.changedAtMs;
    const stabilizeRows = (rows: number): number => this.stabilizeBoardRows(rows);
    const laneFlashes = this.motion.currentLaneFlashes();
    let hasScroll = false;
    if (this.expanded) {
      this.motion.refreshMotionCues(this.todos, this.expanded, this.todos, changedAtMs);
      const motions = this.motion.currentMotionCues();
      const revealed = this.syncEnterReveals(motions);
      lines.push(
        ...renderTodos(
          this.todos,
          contentWidth,
          highlights,
          changedAtMs,
          profile,
          stabilizeRows,
          motions,
          laneFlashes,
          revealed,
          this.focusAgeMs(),
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
        const offset = clampScrollOffset(this.scrollOffset, laneRows, viewport);
        this.scrollOffset = offset;
        const rows = windowTodos(this.todos, offset, viewport);
        this.motion.refreshMotionCues(this.todos, this.expanded, rows, changedAtMs);
        const motions = this.motion.currentMotionCues();
        const revealed = this.syncEnterReveals(motions);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            motions,
            laneFlashes,
            revealed,
            this.focusAgeMs(),
          ),
        );
        if (viewport < laneRows) {
          hasScroll = true;
          lines.push(renderBoardScrollIndicator(this.todos, offset, viewport));
        }
      } else {
        const { rows, hidden, hiddenCounts } = selectVisibleTodos(this.todos);
        this.motion.refreshMotionCues(this.todos, this.expanded, rows, changedAtMs);
        const motions = this.motion.currentMotionCues();
        const revealed = this.syncEnterReveals(motions);
        lines.push(
          ...renderTodos(
            rows,
            contentWidth,
            highlights,
            changedAtMs,
            profile,
            stabilizeRows,
            motions,
            laneFlashes,
            revealed,
            this.focusAgeMs(),
          ),
        );
        if (hidden > 0) {
          hasScroll = true;
          const distribution = formatHiddenCounts(hiddenCounts);
          const suffix = distribution.length > 0 ? ` (${distribution})` : '';
          lines.push(
            currentTheme.fg('textDim', `  … +${hidden} more${suffix} · ctrl+t to expand`),
          );
        }
      }
    }
    lines.push(
      renderTodoDenseFooter(this.callsSinceUpdate, summary, this.expanded, hasScroll),
    );
    return lines;
  }

  /** Advance in-flight enter reveals against the animation clock. */
  private catchUpEnterReveals(): void {
    if (this.revealByTitle.size === 0) return;
    const now = appearanceAnimationNow();
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    for (const [title, prev] of this.revealByTitle) {
      let state = prev;
      if (!animated) {
        state = snapRevealToTarget(state, now);
      } else if (!isRevealCaughtUp(state)) {
        state = tickReveal(state, now);
      }
      this.revealByTitle.set(title, state);
    }
    this.lastRevealTickMs = now;
  }

  /** Type-on reveal for enter-cued cards; returns visible partial titles. */
  private syncEnterReveals(
    motions: ReadonlyMap<string, CardMotionCue>,
  ): ReadonlyMap<string, string> {
    const now = appearanceAnimationNow();
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const visible = new Map<string, string>();
    const liveTitles = new Set<string>();
    for (const [title, cue] of motions) {
      if (cue.kind !== 'enter') continue;
      liveTitles.add(title);
      let state = this.revealByTitle.get(title);
      if (state === undefined) {
        state = createStreamingTextRevealState(now);
      }
      state = setRevealTarget(state, title, now);
      // Past the enter window: snap full title. Motion-off snaps immediately.
      // Always tick new/incomplete state here — lastRevealTickMs may already
      // equal `now` from an earlier empty-board paint in the same clock ms.
      if (!animated || !isToneSettleFlashActive(cue.startedAtMs, appearance)) {
        state = snapRevealToTarget(state, now);
      } else if (!isRevealCaughtUp(state)) {
        state = tickReveal(state, now);
      }
      this.revealByTitle.set(title, state);
      visible.set(title, visibleText(state));
    }
    for (const title of this.revealByTitle.keys()) {
      if (!liveTitles.has(title)) this.revealByTitle.delete(title);
    }
    if (liveTitles.size > 0) this.lastRevealTickMs = now;
    return visible;
  }

  private interiorWidth(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): number {
    if (profile === 'tiny') return width;
    return chromeBandInteriorWidth(width);
  }

  private currentChangeSummary(): TodoPanelChangeSummary | undefined {
    if (this.changeSummary === undefined) return undefined;
    const ageMs = appearanceAnimationNow() - this.changeSummary.changedAtMs;
    return ageMs <= changeFlashMs() ? this.changeSummary : undefined;
  }

  private currentHighlights(): ReadonlyMap<string, TodoChangeKind> {
    return this.currentChangeSummary() === undefined ? EMPTY_HIGHLIGHTS : this.recentChanges;
  }

  private memoizeRender(
    width: number,
    secondBucket: number,
    budget: number,
    lines: string[],
  ): string[] {
    this.lastRender = {
      width,
      expanded: this.expanded,
      todos: this.todos,
      calls: this.callsSinceUpdate,
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
