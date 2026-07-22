/**
 * Pin Controller — manages the hybrid (C) interaction model.
 *
 * Dashboard mode: all quests shown as equal bento cells.
 * Pinned mode: one quest expanded to 60–70% of grid, rest as thumbnail strip.
 *
 * AC-3: pin/expand toggle works, pinned quest gets 60–70% grid area,
 *        expand view shows agent live stream.
 */

import type { QuestGridController } from './quest-grid-controller';
import type { Quest } from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinControllerOptions {
  readonly gridController: QuestGridController;
  readonly requestRender: () => void;
}

// ---------------------------------------------------------------------------
// PinController
// ---------------------------------------------------------------------------

export class PinController {
  private readonly gridController: QuestGridController;
  private readonly requestRender: () => void;
  // Gen 37: stack of previously pinned quest ids for quick back-navigation.
  private readonly pinHistory: string[] = [];

  constructor(options: PinControllerOptions) {
    this.gridController = options.gridController;
    this.requestRender = options.requestRender;
  }

  /** Toggle pin on a quest. If already pinned, unpin. */
  togglePin(questId: string): void {
    this.recordHistory(this.gridController.getPinnedQuestId());
    this.gridController.togglePin(questId);
    this.requestRender();
  }

  /** Pin a specific quest (no-op if already pinned). */
  pin(questId: string): void {
    if (this.gridController.getPinnedQuestId() !== questId) {
      this.recordHistory(this.gridController.getPinnedQuestId());
      this.gridController.togglePin(questId);
      this.requestRender();
    }
  }

  /** Unpin the currently pinned quest. */
  unpin(): void {
    const pinnedId = this.gridController.getPinnedQuestId();
    if (pinnedId) {
      this.gridController.togglePin(pinnedId);
      this.requestRender();
    }
  }

  /**
   * Gen 37: push the outgoing pinned quest onto the history stack. Only
   * records a real, different quest so the back-stack stays meaningful.
   */
  private recordHistory(outgoingPinnedId: string | null): void {
    if (outgoingPinnedId === null) return;
    const top = this.pinHistory[this.pinHistory.length - 1];
    if (top === outgoingPinnedId) return;
    this.pinHistory.push(outgoingPinnedId);
  }

  /**
   * Gen 37: re-pin the most recently viewed quest (LIFO). Returns true when
   * a previous quest was restored, false when the history is empty or the
   * target no longer exists.
   */
  pinPrevious(): boolean {
    while (this.pinHistory.length > 0) {
      const prevId = this.pinHistory.pop()!;
      // Skip ids that no longer resolve to a live quest.
      if (this.gridController.getQuest(prevId) === undefined) continue;
      if (this.gridController.getPinnedQuestId() === prevId) continue;
      // Push the outgoing pin so the user can navigate forward again.
      this.recordHistory(this.gridController.getPinnedQuestId());
      this.gridController.togglePin(prevId);
      this.requestRender();
      return true;
    }
    return false;
  }

  /** Gen 37: whether there is a previous pin to go back to. */
  get canPinPrevious(): boolean {
    return this.pinHistory.length > 0;
  }

  /**
   * Gen 39: cycle the pin to the next quest in display order (wrapping).
   * Lets the operator sweep through quests with `l` without unpinning.
   * No-op when fewer than two quests exist.
   */
  pinNextInStrip(): void {
    this.cyclePin(1);
  }

  /**
   * Gen 39: cycle the pin to the previous quest in display order (wrapping).
   * No-op when fewer than two quests exist.
   */
  pinPrevInStrip(): void {
    this.cyclePin(-1);
  }

  /** Gen 39: shared cycle helper — move the pin by `delta` in ordered quests. */
  private cyclePin(delta: number): void {
    const quests = this.gridController.getQuests();
    if (quests.length < 2) return;
    const pinnedId = this.gridController.getPinnedQuestId();
    const currentIdx = pinnedId
      ? quests.findIndex((q) => q.id === pinnedId)
      : -1;
    const nextIdx = (currentIdx + delta + quests.length) % quests.length;
    const target = quests[nextIdx];
    if (target && target.id !== pinnedId) {
      this.pin(target.id);
    }
  }

  /** Whether any quest is pinned. */
  get isPinned(): boolean {
    return this.gridController.getPinnedQuestId() !== null;
  }

  /** Get the pinned quest entity, or null. */
  getPinnedQuest(): Quest | null {
    const id = this.gridController.getPinnedQuestId();
    if (!id) return null;
    return this.gridController.getQuest(id) ?? null;
  }

  /**
   * Get quests that should appear in the thumbnail strip
   * (all except the pinned one).
   */
  getStripQuests(): readonly Quest[] {
    const pinnedId = this.gridController.getPinnedQuestId();
    if (!pinnedId) return [];
    return this.gridController.getQuests().filter((q) => q.id !== pinnedId);
  }
}
