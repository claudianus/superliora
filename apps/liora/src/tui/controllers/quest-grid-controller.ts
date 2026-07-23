/**
 * Quest Grid Controller — manages the bento grid layout for the dashboard.
 *
 * Responsibilities:
 * - Maintain the list of active quests (3–12).
 * - Compute bento grid cell bounds via measureBentoGridLayout.
 * - Handle pin/expand toggling (hybrid model C).
 * - Provide quest state updates from session events.
 *
 * AC-1: bento grid renders 3–12 quests with 6-state visual encoding,
 *        cell bounds never exceed terminal dimensions (measureBentoGridLayout).
 */

import type { RendererRect } from '@harness-kit/tui-renderer';
import {
  measureBentoGridLayout,
  type BentoGridLayout,
  type BentoGridCell,
  type BentoPanelSpec,
} from '@harness-kit/tui-renderer';

import {
  type Quest,
  type QuestState,
  type QuestCellBounds,
  type QuestChangeCount,
  type DashboardViewMode,
  type QuestSortMode,
  ATTENTION_STATES,
  contextSeverityToken,
  nextSortMode,
  questHealthScore,
} from './quest-types';
import { compareByUrgency } from './quest-urgency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestGridState {
  readonly quests: ReadonlyMap<string, Quest>;
  readonly pinnedQuestId: string | null;
  readonly viewMode: DashboardViewMode;
  readonly focusedQuestId: string | null;
  readonly bentoLayout: BentoGridLayout | null;
}

export interface QuestGridControllerOptions {
  readonly getViewport: () => RendererRect;
  readonly requestRender: () => void;
  /**
   * Gen 27: called when a quest transitions into an attention state
   * (waiting-approval or failed). Used to auto-pin in the dashboard.
   */
  readonly onAttentionTransition?: (questId: string, state: QuestState) => void;
  /**
   * Gen 85: returns the error+warning line count for a quest's stream, used
   * by the `problems` sort mode. Defaults to 0 when not provided.
   */
  readonly getProblemCount?: (questId: string) => number;
}

// ---------------------------------------------------------------------------
// QuestGridController
// ---------------------------------------------------------------------------

export class QuestGridController {
  private readonly quests = new Map<string, Quest>();
  private pinnedQuestId: string | null = null;
  private focusedQuestId: string | null = null;
  private bentoLayout: BentoGridLayout | null = null;
  private readonly getViewport: () => RendererRect;
  private readonly requestRender: () => void;
  private readonly onAttentionTransition:
    | ((questId: string, state: QuestState) => void)
    | undefined;
  // Gen 85: problem-count provider for the `problems` sort mode.
  private readonly getProblemCount: ((questId: string) => number) | undefined;
  // Gen 24: dashboard filter query (matches name or state).
  private filterQuery = '';
  // Gen 26: show only attention-needing quests.
  private attentionOnly = false;
  // Gen 75: show only context-at-risk quests (>=80% usage).
  private ctxRiskOnly = false;
  // Gen 86: show only quests with error/warning lines in the stream.
  private problemsOnly = false;
  // Gen 30: active dashboard sort mode.
  private sortMode: QuestSortMode = 'attention';
  // Gen 97: when true, the active sort order is reversed (e.g. cheapest first).
  private sortReversed = false;

  constructor(options: QuestGridControllerOptions) {
    this.getViewport = options.getViewport;
    this.requestRender = options.requestRender;
    this.onAttentionTransition = options.onAttentionTransition;
    this.getProblemCount = options.getProblemCount;
  }

  // -------------------------------------------------------------------------
  // Quest CRUD
  // -------------------------------------------------------------------------

  /** Register a new quest. */
  addQuest(quest: Quest): void {
    // Gen 33: if a quest is born directly into an attention state, stamp the
    // dwell clock so the header shows how long it has been waiting.
    const stamped =
      ATTENTION_STATES.has(quest.state) && quest.attentionEnteredAt === undefined
        ? { ...quest, attentionEnteredAt: Date.now() }
        : quest;
    this.quests.set(stamped.id, stamped);
    this.recomputeLayout();
  }

  /** Remove a quest by id. */
  removeQuest(questId: string): void {
    this.quests.delete(questId);
    if (this.pinnedQuestId === questId) {
      this.pinnedQuestId = null;
    }
    if (this.focusedQuestId === questId) {
      this.focusedQuestId = null;
    }
    this.recomputeLayout();
  }

  /** Update quest state. */
  updateQuestState(questId: string, state: QuestState): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    const wasAttention = ATTENTION_STATES.has(quest.state);
    const nowAttention = ATTENTION_STATES.has(state);
    // Gen 33: stamp when the quest enters an attention state; clear on exit.
    // Staying in an attention state keeps the original stamp so the dwell
    // clock is not reset by repeated same-state events.
    const attentionEnteredAt = nowAttention
      ? (wasAttention ? quest.attentionEnteredAt : Date.now())
      : undefined;
    this.quests.set(questId, {
      ...quest,
      state,
      lastActivityAt: Date.now(),
      approvalPending: state === 'waiting-approval',
      attentionEnteredAt,
    });
    // Gen 27: notify on transition into an attention state (not when already there).
    if (!wasAttention && nowAttention) {
      this.onAttentionTransition?.(questId, state);
    }
    this.requestRender();
  }

  /** Update quest change counts. */
  updateQuestChanges(questId: string, changeCount: QuestChangeCount): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, { ...quest, changeCount });
    this.requestRender();
  }

  /** Update quest plan step. */
  updateQuestPlanStep(questId: string, planStep: string): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, { ...quest, planStep, lastActivityAt: Date.now() });
    this.requestRender();
  }

  /** Update quest worktree path. */
  updateQuestWorktree(questId: string, worktreePath: string): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, { ...quest, worktreePath });
    this.requestRender();
  }

  /** Update quest progress indicators (Gen 9: todo progress + context usage). */
  updateQuestProgress(
    questId: string,
    todoProgress: { done: number; total: number } | undefined,
    contextUsage: number,
    pendingApprovalSummary: string | undefined,
    modelName: string | undefined,
    sessionCostUsd: number,
  ): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, {
      ...quest,
      todoProgress,
      contextUsage,
      pendingApprovalSummary,
      modelName,
      sessionCostUsd,
    });
    this.requestRender();
  }

  /** Update the last error message shown in a failed quest's cell (Gen 21). */
  updateQuestError(questId: string, lastErrorMessage: string | undefined): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, { ...quest, lastErrorMessage });
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Pin / Expand (Hybrid Model C)
  // -------------------------------------------------------------------------

  /** Pin a quest (expand to 60–70% of grid). Unpin if already pinned. */
  togglePin(questId: string): void {
    if (this.pinnedQuestId === questId) {
      this.pinnedQuestId = null;
    } else {
      this.pinnedQuestId = questId;
    }
    this.recomputeLayout();
  }

  /** Whether a quest is currently pinned. */
  isPinned(questId: string): boolean {
    return this.pinnedQuestId === questId;
  }

  // -------------------------------------------------------------------------
  // Focus
  // -------------------------------------------------------------------------

  /** Set the focused quest (for keyboard navigation). */
  setFocusedQuest(questId: string | null): void {
    this.focusedQuestId = questId;
    this.recomputeLayout();
  }

  /** Move focus to the next quest in order. */
  focusNext(): void {
    const ids = this.sortedQuestIds();
    if (ids.length === 0) return;
    const currentIdx = this.focusedQuestId ? ids.indexOf(this.focusedQuestId) : -1;
    const nextIdx = (currentIdx + 1) % ids.length;
    this.focusedQuestId = ids[nextIdx]!;
    this.recomputeLayout();
  }

  /** Move focus to the previous quest in order. */
  focusPrev(): void {
    const ids = this.sortedQuestIds();
    if (ids.length === 0) return;
    const currentIdx = this.focusedQuestId ? ids.indexOf(this.focusedQuestId) : -1;
    const prevIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
    this.focusedQuestId = ids[prevIdx]!;
    this.recomputeLayout();
  }

  /**
   * Gen 58: jump focus to the first quest in the current sort order.
   * Vim-style endpoint navigation for long fleets (paired with `focusLast`).
   * No-op when no quest is visible.
   */
  focusFirst(): void {
    const ids = this.sortedQuestIds();
    if (ids.length === 0) return;
    this.focusedQuestId = ids[0]!;
    this.recomputeLayout();
  }

  /**
   * Gen 58: jump focus to the last quest in the current sort order.
   * No-op when no quest is visible.
   */
  focusLast(): void {
    const ids = this.sortedQuestIds();
    if (ids.length === 0) return;
    this.focusedQuestId = ids[ids.length - 1]!;
    this.recomputeLayout();
  }

  /**
   * Gen 87: jump focus to the Nth quest (1-based) in the current sort order.
   * No-op when the index is out of range.
   */
  focusNth(n: number): void {
    const ids = this.sortedQuestIds();
    if (n < 1 || n > ids.length) return;
    this.focusedQuestId = ids[n - 1]!;
    this.recomputeLayout();
  }

  /**
   * Gen 89: jump focus to the next quest with error/warning lines in its
   * stream, cycling within that subset only. No-op when none have problems.
   */
  focusNextProblem(): void {
    const ids = this.sortedQuestIds();
    const problemIds = ids.filter(
      (id) => (this.getProblemCount?.(id) ?? 0) > 0,
    );
    if (problemIds.length === 0) return;
    const currentIdx = problemIds.indexOf(this.focusedQuestId ?? '');
    const nextIdx = (currentIdx + 1) % problemIds.length;
    this.focusedQuestId = problemIds[nextIdx]!;
    this.recomputeLayout();
  }

  /**
   * Gen 90: jump focus to the previous quest with error/warning lines in its
   * stream, cycling within that subset only. No-op when none have problems.
   */
  focusPrevProblem(): void {
    const ids = this.sortedQuestIds();
    const problemIds = ids.filter(
      (id) => (this.getProblemCount?.(id) ?? 0) > 0,
    );
    if (problemIds.length === 0) return;
    const currentIdx = problemIds.indexOf(this.focusedQuestId ?? '');
    const prevIdx =
      currentIdx === -1
        ? problemIds.length - 1
        : (currentIdx - 1 + problemIds.length) % problemIds.length;
    this.focusedQuestId = problemIds[prevIdx]!;
    this.recomputeLayout();
  }

  /**
   * Gen 94: jump focus to the next quest at risk of context exhaustion
   * (>=80% usage), cycling within that subset only. No-op when none are at risk.
   */
  focusNextCtxRisk(): void {
    const ids = this.sortedQuestIds();
    const riskIds = ids.filter((id) => {
      const quest = this.quests.get(id);
      if (quest === undefined || quest.contextUsage === undefined) return false;
      return contextSeverityToken(quest.contextUsage) !== 'success';
    });
    if (riskIds.length === 0) return;
    const currentIdx = riskIds.indexOf(this.focusedQuestId ?? '');
    const nextIdx = (currentIdx + 1) % riskIds.length;
    this.focusedQuestId = riskIds[nextIdx]!;
    this.recomputeLayout();
  }

  /**
   * Gen 25: move focus to the next quest that needs attention
   * (waiting-approval or failed), cycling within that subset only.
   * No-op when no quest needs attention.
   */
  focusNextAttention(): void {
    const attentionIds = this.sortedQuestIds().filter((id) => {
      const quest = this.quests.get(id);
      return quest !== undefined && ATTENTION_STATES.has(quest.state);
    });
    if (attentionIds.length === 0) return;
    const currentIdx = this.focusedQuestId
      ? attentionIds.indexOf(this.focusedQuestId)
      : -1;
    const nextIdx = (currentIdx + 1) % attentionIds.length;
    this.focusedQuestId = attentionIds[nextIdx]!;
    this.recomputeLayout();
  }

  /**
   * Gen 55: focus the least-healthy visible quest. Health (Gen 47) blends
   * state, idle time, and context pressure, so this lands the operator on the
   * quest most at risk — a softer triage than `focusNextAttention`, which only
   * considers attention states. No-op when no quest is visible.
   */
  focusWeakestHealth(): void {
    const visible = this.sortedQuestIds();
    if (visible.length === 0) return;
    const now = Date.now();
    let weakestId = visible[0]!;
    let weakestScore = Infinity;
    for (const id of visible) {
      const quest = this.quests.get(id);
      if (quest === undefined) continue;
      const score = questHealthScore(quest, now);
      if (score < weakestScore) {
        weakestScore = score;
        weakestId = id;
      }
    }
    this.focusedQuestId = weakestId;
    this.recomputeLayout();
  }

  /**
   * Gen 63: focus the most expensive visible quest (highest sessionCostUsd).
   * Cost-based triage so the operator can jump to the priciest session without
   * scanning the fleet. No-op when no quest is visible.
   */
  focusMostExpensive(): void {
    const visible = this.sortedQuestIds();
    if (visible.length === 0) return;
    let richestId = visible[0]!;
    let richestCost = -Infinity;
    for (const id of visible) {
      const quest = this.quests.get(id);
      if (quest === undefined) continue;
      const cost = quest.sessionCostUsd ?? 0;
      if (cost > richestCost) {
        richestCost = cost;
        richestId = id;
      }
    }
    this.focusedQuestId = richestId;
    this.recomputeLayout();
  }

  /**
   * Gen 109: focus the stalest visible quest (lowest lastActivityAt). Pairs with
   * the summary bar's "stalest" callout (Gen 70) so the operator can jump to the
   * most neglected session without scanning the fleet. No-op when no quest is
   * visible.
   */
  focusStalest(): void {
    const visible = this.sortedQuestIds();
    if (visible.length === 0) return;
    let stalestId = visible[0]!;
    let stalestAt = Infinity;
    for (const id of visible) {
      const quest = this.quests.get(id);
      if (quest === undefined) continue;
      if (quest.lastActivityAt < stalestAt) {
        stalestAt = quest.lastActivityAt;
        stalestId = id;
      }
    }
    this.focusedQuestId = stalestId;
    this.recomputeLayout();
  }

  /**
   * Gen 39: guarantee a valid focus. When nothing is focused, or the focused
   * quest is no longer in the visible (filtered/sorted) set, focus snaps to
   * the most urgent quest — the first in the urgency-ordered list. This makes
   * the dashboard land on the quest that needs the operator first.
   */
  ensureFocus(): void {
    const ids = this.sortedQuestIds();
    if (ids.length === 0) {
      if (this.focusedQuestId !== null) {
        this.focusedQuestId = null;
        this.recomputeLayout();
      }
      return;
    }
    if (this.focusedQuestId === null || !ids.includes(this.focusedQuestId)) {
      this.focusedQuestId = ids[0]!;
      this.recomputeLayout();
    }
  }

  /**
   * Gen 17: quest ids ordered by display priority (attention states first),
   * stable within the same priority. Used for rendering, focus navigation,
   * and panel spec ordering so the grid and keyboard order agree.
   * Gen 24: applies the active filter query (matches name or state).
   * Gen 30: applies the active sort mode (attention / cost / age / name).
   */
  private sortedQuestIds(): string[] {
    const query = this.filterQuery.trim().toLowerCase();
    const visible = [...this.quests.values()].filter((q) => {
      // Gen 26: attention-only mode hides healthy quests.
      if (this.attentionOnly && !ATTENTION_STATES.has(q.state)) return false;
      // Gen 75: context-risk-only mode hides quests below the 80% threshold.
      if (
        this.ctxRiskOnly &&
        (q.contextUsage === undefined || contextSeverityToken(q.contextUsage) === 'success')
      ) {
        return false;
      }
      // Gen 86: problems-only mode hides quests with no error/warning lines.
      if (this.problemsOnly && (this.getProblemCount?.(q.id) ?? 0) === 0) {
        return false;
      }
      if (query === '') return true;
      return (
        q.name.toLowerCase().includes(query) ||
        q.state.toLowerCase().includes(query)
      );
    });

    const indexed = visible.map((q, index) => ({ quest: q, index }));
    // Gen 51: capture the clock once so health sorting is stable within a pass.
    const now = Date.now();
    indexed.sort((a, b) => {
      const cmp = this.compareBySortMode(a.quest, b.quest, now);
      // Gen 97: apply the reversal flag to the primary comparison only; the
      // insertion-order tiebreak stays stable so equal quests keep their order.
      const directed = this.sortReversed ? -cmp : cmp;
      return directed !== 0 ? directed : a.index - b.index;
    });
    return indexed.map((entry) => entry.quest.id);
  }

  /**
   * Gen 30: comparator for the active sort mode. Returns negative when
   * `a` should come before `b`. `attention` uses the Gen 38 urgency score so
   * the longest-neglected quest of equal priority sorts first.
   * Gen 51: `health` sorts the least-healthy quest first.
   */
  private compareBySortMode(a: Quest, b: Quest, now: number): number {
    switch (this.sortMode) {
      case 'attention':
        return compareByUrgency(a, b);
      case 'cost':
        // Highest cost first.
        return (b.sessionCostUsd ?? 0) - (a.sessionCostUsd ?? 0);
      case 'age':
        // Oldest first.
        return a.createdAt - b.createdAt;
      case 'name':
        return a.name.localeCompare(b.name);
      case 'health':
        // Lowest health first.
        return questHealthScore(a, now) - questHealthScore(b, now);
      case 'ctx':
        // Gen 74: highest context usage first, so the most at-risk quest of
        // context exhaustion surfaces at the top.
        return (b.contextUsage ?? 0) - (a.contextUsage ?? 0);
      case 'problems':
        // Gen 85: most error+warning lines first, so the most troubled quest
        // surfaces at the top.
        return (
          (this.getProblemCount?.(b.id) ?? 0) - (this.getProblemCount?.(a.id) ?? 0)
        );
      default: {
        const _exhaustive: never = this.sortMode;
        return _exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Gen 24: Dashboard filter
  // -------------------------------------------------------------------------

  /** Set the dashboard filter query (matches quest name or state). */
  setFilter(query: string): void {
    this.filterQuery = query;
    this.recomputeLayout();
  }

  /** Get the active filter query. */
  getFilter(): string {
    return this.filterQuery;
  }

  // -------------------------------------------------------------------------
  // Gen 26: Attention-only toggle
  // -------------------------------------------------------------------------

  /** Set attention-only mode: show only quests needing attention. */
  setAttentionOnly(enabled: boolean): void {
    this.attentionOnly = enabled;
    this.recomputeLayout();
  }

  /** Toggle attention-only mode. */
  toggleAttentionOnly(): void {
    this.setAttentionOnly(!this.attentionOnly);
  }

  /** Whether attention-only mode is active. */
  isAttentionOnly(): boolean {
    return this.attentionOnly;
  }

  // -------------------------------------------------------------------------
  // Gen 75: Context-risk-only mode
  // -------------------------------------------------------------------------

  /** Set context-risk-only mode: show only quests at/above the 80% threshold. */
  setCtxRiskOnly(enabled: boolean): void {
    this.ctxRiskOnly = enabled;
    this.recomputeLayout();
  }

  /** Toggle context-risk-only mode. */
  toggleCtxRiskOnly(): void {
    this.setCtxRiskOnly(!this.ctxRiskOnly);
  }

  /** Whether context-risk-only mode is active. */
  isCtxRiskOnly(): boolean {
    return this.ctxRiskOnly;
  }

  // -------------------------------------------------------------------------
  // Gen 86: Problems-only mode
  // -------------------------------------------------------------------------

  /** Set problems-only mode: show only quests with error/warning lines. */
  setProblemsOnly(enabled: boolean): void {
    this.problemsOnly = enabled;
    this.recomputeLayout();
  }

  /** Toggle problems-only mode. */
  toggleProblemsOnly(): void {
    this.setProblemsOnly(!this.problemsOnly);
  }

  /** Whether problems-only mode is active. */
  isProblemsOnly(): boolean {
    return this.problemsOnly;
  }

  // -------------------------------------------------------------------------
  // Gen 30: Sort mode
  // -------------------------------------------------------------------------

  /** Cycle to the next sort mode (attention → cost → age → name). */
  cycleSortMode(): void {
    this.sortMode = nextSortMode(this.sortMode);
    this.recomputeLayout();
  }

  /** Get the active sort mode. */
  getSortMode(): QuestSortMode {
    return this.sortMode;
  }

  /**
   * Gen 97: toggle the sort direction. When reversed, the active sort mode's
   * order flips (e.g. cost goes highest→lowest to lowest→highest).
   */
  toggleSortReverse(): void {
    this.sortReversed = !this.sortReversed;
    this.recomputeLayout();
  }

  /** Whether the active sort order is reversed (Gen 97). */
  isSortReversed(): boolean {
    return this.sortReversed;
  }

  /**
   * Gen 54: reset all dashboard view state (filter, attention-only, sort mode)
   * back to defaults in one shot, so the operator can quickly return to the
   * baseline view after exploring.
   */
  resetView(): void {
    this.filterQuery = '';
    this.attentionOnly = false;
    this.ctxRiskOnly = false;
    this.problemsOnly = false;
    this.sortMode = 'attention';
    this.sortReversed = false;
    this.recomputeLayout();
  }

  // -------------------------------------------------------------------------
  // Layout Computation
  // -------------------------------------------------------------------------

  /** Recompute the bento grid layout from current quest list. */
  recomputeLayout(): void {
    const viewport = this.getViewport();
    const panels = this.buildPanelSpecs();
    this.bentoLayout = measureBentoGridLayout(viewport, panels, this.focusedQuestId);
    this.requestRender();
  }

  /** Build BentoPanelSpec array from current quests. */
  private buildPanelSpecs(): BentoPanelSpec[] {
    const questList = this.getQuests();
    if (questList.length === 0) return [];

    if (this.pinnedQuestId) {
      // Hybrid mode: pinned quest gets large cell, others get small
      return questList.map((q) => {
        if (q.id === this.pinnedQuestId) {
          return { id: q.id, colSpan: 3, rowSpan: 3, priority: 100 };
        }
        return { id: q.id, colSpan: 1, rowSpan: 1, priority: 1 };
      });
    }

    // Dashboard mode: all quests equal priority
    return questList.map((q) => ({
      id: q.id,
      colSpan: 1,
      rowSpan: 1,
      priority: 1,
    }));
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Get all quests in display-priority order (Gen 17: attention states first). */
  getQuests(): readonly Quest[] {
    const byId = this.quests;
    return this.sortedQuestIds()
      .map((id) => byId.get(id))
      .filter((q): q is Quest => q !== undefined);
  }

  /** Get a single quest by id. */
  getQuest(questId: string): Quest | undefined {
    return this.quests.get(questId);
  }

  /**
   * Gen 107: return the 1-based rank of a quest in the current sort order, or
   * null when the quest is not visible. Used by the pinned header to show the
   * quest's position in the fleet (e.g. "#2/8").
   */
  getSortRank(questId: string): { rank: number; total: number } | null {
    const ids = this.sortedQuestIds();
    const idx = ids.indexOf(questId);
    if (idx === -1) return null;
    return { rank: idx + 1, total: ids.length };
  }

  /** Get the current bento layout. */
  getBentoLayout(): BentoGridLayout | null {
    return this.bentoLayout;
  }

  /** Get the view mode. */
  getViewMode(): DashboardViewMode {
    return this.pinnedQuestId ? 'pinned' : 'dashboard';
  }

  /** Get quests that need attention (waiting-approval or failed). */
  getAttentionQuests(): readonly Quest[] {
    return [...this.quests.values()].filter((q) =>
      ATTENTION_STATES.has(q.state),
    );
  }

  /** Get the cell bounds for a quest from the current layout. */
  getQuestCellBounds(questId: string): QuestCellBounds | null {
    if (!this.bentoLayout) return null;
    const cell = this.bentoLayout.cells.find((c) => c.id === questId);
    if (!cell) return null;
    return {
      col: cell.col,
      row: cell.row,
      colSpan: cell.colSpan,
      rowSpan: cell.rowSpan,
    };
  }

  /** Get the focused quest id. */
  getFocusedQuestId(): string | null {
    return this.focusedQuestId;
  }

  /** Get the pinned quest id. */
  getPinnedQuestId(): string | null {
    return this.pinnedQuestId;
  }

  /** Quest count. */
  get questCount(): number {
    return this.quests.size;
  }

  // -------------------------------------------------------------------------
  // Bounds Validation (AC-1 regression gate)
  // -------------------------------------------------------------------------

  /**
   * Validate that no cell bounds exceed the viewport dimensions.
   * Returns true if all cells are within bounds (no clipping/overlap).
   */
  validateBounds(viewport: RendererRect): boolean {
    if (!this.bentoLayout) return true;
    for (const cell of this.bentoLayout.cells) {
      const rect = cell.rect;
      if (rect.x < viewport.x) return false;
      if (rect.y < viewport.y) return false;
      if (rect.x + rect.width > viewport.x + viewport.width) return false;
      if (rect.y + rect.height > viewport.y + viewport.height) return false;
    }
    return true;
  }
}
