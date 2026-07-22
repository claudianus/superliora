/**
 * Attention Controller — manages the 3-channel attention routing system.
 *
 * Channels:
 * 1. Visual pulse — cell border color change + pulse animation
 * 2. Auditory bell — terminal bell character (\a)
 * 3. Strip blink — thumbnail strip status blink (when in pinned mode)
 *
 * AC-2: waiting-approval/failed → pulse + bell within ≤2000ms of event receipt.
 *       12+ quests → thumbnail strip with status blink.
 */

import {
  type Quest,
  type QuestState,
  type AttentionEvent,
  ATTENTION_STATES,
} from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttentionControllerOptions {
  /** Write raw bytes to terminal stdout (for bell character). */
  readonly writeRaw: (data: string) => void;
  /** Request a full TUI re-render. */
  readonly requestRender: () => void;
  /** Current timestamp provider (injectable for testing). */
  readonly now?: () => number;
}

export interface AttentionState {
  /** Quests currently pulsing. */
  readonly pulsingQuestIds: ReadonlySet<string>;
  /** Attention event log for timing assertions. */
  readonly eventLog: readonly AttentionEvent[];
  /** Whether strip blink is active (12+ quests with attention). */
  readonly stripBlinkActive: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed latency from event receipt to pulse render (ms). */
export const ATTENTION_LATENCY_MAX_MS = 2000;

/** Terminal bell character. */
const BELL_CHAR = '\x07';

// ---------------------------------------------------------------------------
// AttentionController
// ---------------------------------------------------------------------------

export class AttentionController {
  private readonly pulsingQuestIds = new Set<string>();
  private readonly eventLog: AttentionEvent[] = [];
  private stripBlinkActive = false;
  private readonly writeRaw: (data: string) => void;
  private readonly requestRender: () => void;
  private readonly now: () => number;

  constructor(options: AttentionControllerOptions) {
    this.writeRaw = options.writeRaw;
    this.requestRender = options.requestRender;
    this.now = options.now ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Event Handling
  // -------------------------------------------------------------------------

  /**
   * Called when a quest's state changes. If the new state requires attention,
   * triggers pulse + bell immediately.
   */
  onQuestStateChanged(questId: string, newState: QuestState): void {
    if (!ATTENTION_STATES.has(newState)) {
      // State no longer needs attention — stop pulsing
      this.pulsingQuestIds.delete(questId);
      this.requestRender();
      return;
    }

    const receivedAt = this.now();

    // Trigger pulse (visual)
    this.pulsingQuestIds.add(questId);

    // Trigger bell (auditory) — simultaneous with pulse
    this.writeRaw(BELL_CHAR);

    // Request render for pulse visual
    this.requestRender();

    // Record attention event with pulse render timestamp
    const pulseRenderedAt = this.now();
    this.eventLog.push({
      questId,
      state: newState,
      receivedAt,
      pulseRenderedAt,
    });
  }

  /**
   * Update strip blink state based on total quest count and attention quests.
   * Called when the quest list changes or when entering/leaving pinned mode.
   */
  updateStripBlink(totalQuests: number, attentionQuestCount: number): void {
    const shouldBeActive = totalQuests > 12 && attentionQuestCount > 0;
    if (this.stripBlinkActive !== shouldBeActive) {
      this.stripBlinkActive = shouldBeActive;
      this.requestRender();
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether a quest is currently pulsing. */
  isPulsing(questId: string): boolean {
    return this.pulsingQuestIds.has(questId);
  }

  /** Get all pulsing quest ids. */
  getPulsingQuestIds(): ReadonlySet<string> {
    return this.pulsingQuestIds;
  }

  /** Whether strip blink is active. */
  isStripBlinkActive(): boolean {
    return this.stripBlinkActive;
  }

  /** Get the attention event log. */
  getEventLog(): readonly AttentionEvent[] {
    return this.eventLog;
  }

  // -------------------------------------------------------------------------
  // Regression Gate: Attention Latency
  // -------------------------------------------------------------------------

  /**
   * Validate that all attention events meet the ≤2000ms latency requirement.
   * Returns true if all events pass, false if any exceed the threshold.
   */
  validateAttentionLatency(): boolean {
    for (const event of this.eventLog) {
      if (event.pulseRenderedAt === null) return false;
      const latency = event.pulseRenderedAt - event.receivedAt;
      if (latency > ATTENTION_LATENCY_MAX_MS) return false;
    }
    return true;
  }

  /**
   * Get the maximum attention latency observed (ms).
   * Returns null if no events recorded.
   */
  getMaxLatency(): number | null {
    if (this.eventLog.length === 0) return null;
    let max = 0;
    for (const event of this.eventLog) {
      if (event.pulseRenderedAt !== null) {
        const latency = event.pulseRenderedAt - event.receivedAt;
        if (latency > max) max = latency;
      }
    }
    return max;
  }

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  /** Clear all pulsing state (e.g. when leaving dashboard). */
  clearAll(): void {
    this.pulsingQuestIds.clear();
    this.stripBlinkActive = false;
    this.requestRender();
  }
}
