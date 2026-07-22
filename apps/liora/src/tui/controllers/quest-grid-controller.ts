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
  // Gen 24: dashboard filter query (matches name or state).
  private filterQuery = '';
  // Gen 26: show only attention-needing quests.
  private attentionOnly = false;
  // Gen 30: active dashboard sort mode.
  private sortMode: QuestSortMode = 'attention';

  constructor(options: QuestGridControllerOptions) {
    this.getViewport = options.getViewport;
    this.requestRender = options.requestRender;
    this.onAttentionTransition = options.onAttentionTransition;
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
      return cmp !== 0 ? cmp : a.index - b.index;
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
