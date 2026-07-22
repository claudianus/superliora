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

  constructor(options: PinControllerOptions) {
    this.gridController = options.gridController;
    this.requestRender = options.requestRender;
  }

  /** Toggle pin on a quest. If already pinned, unpin. */
  togglePin(questId: string): void {
    this.gridController.togglePin(questId);
    this.requestRender();
  }

  /** Pin a specific quest (no-op if already pinned). */
  pin(questId: string): void {
    if (this.gridController.getPinnedQuestId() !== questId) {
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
