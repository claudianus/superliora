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
  ATTENTION_STATES,
} from './quest-types';

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

  constructor(options: QuestGridControllerOptions) {
    this.getViewport = options.getViewport;
    this.requestRender = options.requestRender;
  }

  // -------------------------------------------------------------------------
  // Quest CRUD
  // -------------------------------------------------------------------------

  /** Register a new quest. */
  addQuest(quest: Quest): void {
    this.quests.set(quest.id, quest);
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
    this.quests.set(questId, {
      ...quest,
      state,
      lastActivityAt: Date.now(),
      approvalPending: state === 'waiting-approval',
    });
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
  ): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    this.quests.set(questId, { ...quest, todoProgress, contextUsage });
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
    const ids = [...this.quests.keys()];
    if (ids.length === 0) return;
    const currentIdx = this.focusedQuestId ? ids.indexOf(this.focusedQuestId) : -1;
    const nextIdx = (currentIdx + 1) % ids.length;
    this.focusedQuestId = ids[nextIdx]!;
    this.recomputeLayout();
  }

  /** Move focus to the previous quest in order. */
  focusPrev(): void {
    const ids = [...this.quests.keys()];
    if (ids.length === 0) return;
    const currentIdx = this.focusedQuestId ? ids.indexOf(this.focusedQuestId) : -1;
    const prevIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
    this.focusedQuestId = ids[prevIdx]!;
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
    const questList = [...this.quests.values()];
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

  /** Get all quests. */
  getQuests(): readonly Quest[] {
    return [...this.quests.values()];
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
