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
  // Gen 32: when each quest entered its current attention state (ms epoch),
  // used to surface how long a quest has been left unattended.
  private readonly attentionEnteredAt = new Map<string, number>();
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
      this.attentionEnteredAt.delete(questId);
      this.requestRender();
      return;
    }

    // Gen 45: idempotency guard — if the quest is already pulsing (already in
    // an attention state), a repeated attention event must not re-ring the
    // bell or append another event-log entry. The operator is already aware;
    // re-firing would spam the bell and pollute the latency metrics.
    const alreadyPulsing = this.pulsingQuestIds.has(questId);

    const receivedAt = this.now();

    // Trigger pulse (visual)
    this.pulsingQuestIds.add(questId);
    // Gen 32: record when this quest entered an attention state so dwell time
    // can be surfaced. Only set on first entry — repeated same-state events
    // must not reset the clock.
    if (!this.attentionEnteredAt.has(questId)) {
      this.attentionEnteredAt.set(questId, receivedAt);
    }

    if (alreadyPulsing) {
      return;
    }

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
  // Gen 32: Attention Dwell Time
  // -------------------------------------------------------------------------

  /**
   * How long (ms) a quest has been sitting in an attention state, measured
   * from when it first entered the state. Returns null if the quest is not
   * currently in an attention state.
   */
  getDwellTime(questId: string): number | null {
    const enteredAt = this.attentionEnteredAt.get(questId);
    if (enteredAt === undefined) return null;
    return Math.max(0, this.now() - enteredAt);
  }

  /**
   * The quest id that has been left unattended the longest, or null when no
   * quest currently needs attention. Lets the dashboard surface the single
   * most-neglected quest for immediate triage.
   */
  getMostNeglectedQuestId(): string | null {
    let oldestId: string | null = null;
    let oldestEnteredAt = Number.POSITIVE_INFINITY;
    for (const [questId, enteredAt] of this.attentionEnteredAt) {
      if (enteredAt < oldestEnteredAt) {
        oldestEnteredAt = enteredAt;
        oldestId = questId;
      }
    }
    return oldestId;
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
    this.attentionEnteredAt.clear();
    this.stripBlinkActive = false;
    this.requestRender();
  }
}
