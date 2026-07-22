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

/** Gen 47: a compact snapshot of the current attention situation. */
export interface AttentionSummary {
  /** Number of quests currently needing attention. */
  readonly count: number;
  /** Id of the quest left unattended the longest, or null when none. */
  readonly oldestQuestId: string | null;
  /** Dwell time (ms) of the oldest quest, or null when none. */
  readonly oldestDwellMs: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed latency from event receipt to pulse render (ms). */
export const ATTENTION_LATENCY_MAX_MS = 2000;

/**
 * Gen 51: dwell time (ms) after which an unattended quest is considered
 * escalated. A quest left in an attention state this long deserves stronger
 * emphasis so the operator does not lose track of it.
 */
export const ATTENTION_ESCALATION_MS = 5 * 60 * 1000;

/**
 * Gen 53: dwell time (ms) after which an unattended quest is considered
 * critical. Mirrors the idle-error threshold so a quest ignored for a long
 * time gets the strongest emphasis.
 */
export const ATTENTION_CRITICAL_MS = 15 * 60 * 1000;

/**
 * Gen 53: how urgently an unattended quest needs the operator.
 * 0 = none (not in attention or fresh), 1 = warning (≥ escalation threshold),
 * 2 = critical (≥ critical threshold).
 */
export type EscalationLevel = 0 | 1 | 2;

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
  // Gen 52: quests whose escalation has already been reported to the operator,
  // so pollNewlyEscalated() only fires once per escalation episode.
  private readonly escalatedReported = new Set<string>();
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
      // Gen 52: allow a fresh escalation report if the quest re-enters
      // attention later.
      this.escalatedReported.delete(questId);
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

  /**
   * Gen 47: a compact snapshot of the attention situation — how many quests
   * need attention and which has been left unattended the longest (with its
   * dwell time). Lets the summary bar render "3 need attention (oldest 2m)"
   * without callers recomputing the traversal.
   */
  getAttentionSummary(): AttentionSummary {
    const oldestQuestId = this.getMostNeglectedQuestId();
    return {
      count: this.pulsingQuestIds.size,
      oldestQuestId,
      oldestDwellMs: oldestQuestId !== null ? this.getDwellTime(oldestQuestId) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Gen 51: Attention Escalation
  // -------------------------------------------------------------------------

  /**
   * Gen 51: whether a quest has been left unattended long enough to be
   * escalated (dwell time ≥ ATTENTION_ESCALATION_MS). Only quests currently
   * in an attention state can be escalated.
   */
  isEscalated(questId: string): boolean {
    const dwell = this.getDwellTime(questId);
    return dwell !== null && dwell >= ATTENTION_ESCALATION_MS;
  }

  /**
   * Gen 51: ids of all currently escalated quests, in the order they entered
   * the attention state (most neglected first). Lets the dashboard apply
   * stronger emphasis to quests that have been ignored the longest.
   */
  getEscalatedQuestIds(): readonly string[] {
    return [...this.attentionEnteredAt.entries()]
      .filter(([, enteredAt]) => Math.max(0, this.now() - enteredAt) >= ATTENTION_ESCALATION_MS)
      .sort((a, b) => a[1] - b[1])
      .map(([questId]) => questId);
  }

  // -------------------------------------------------------------------------
  // Gen 53: Escalation Levels
  // -------------------------------------------------------------------------

  /**
   * Gen 53: the escalation level for a quest based on how long it has been
   * left unattended. 0 when the quest is not in an attention state or has not
   * reached the escalation threshold, 1 (warning) once it crosses the
   * escalation threshold, 2 (critical) once it crosses the critical threshold.
   * Lets the dashboard apply graduated emphasis instead of a single on/off
   * escalated flag.
   */
  getEscalationLevel(questId: string): EscalationLevel {
    const dwell = this.getDwellTime(questId);
    if (dwell === null || dwell < ATTENTION_ESCALATION_MS) return 0;
    if (dwell >= ATTENTION_CRITICAL_MS) return 2;
    return 1;
  }

  /**
   * Gen 60: the highest escalation level across all quests currently in an
   * attention state. Lets the thumbnail strip blink harder (e.g. a different
   * color) when any quest has been ignored long enough to be critical.
   * Returns 0 when nothing is escalated.
   */
  getMaxEscalationLevel(): EscalationLevel {
    let max: EscalationLevel = 0;
    for (const questId of this.attentionEnteredAt.keys()) {
      const level = this.getEscalationLevel(questId);
      if (level > max) max = level;
      if (max === 2) break; // cannot escalate further
    }
    return max;
  }

  // -------------------------------------------------------------------------
  // Gen 52: Escalation Polling
  // -------------------------------------------------------------------------

  /**
   * Gen 52: return the ids of quests that have crossed the escalation
   * threshold since the last poll, marking them as reported so they are not
   * returned again. Lets the TUI ring a distinct escalation bell exactly once
   * per episode. A quest that leaves and re-enters an attention state can be
   * reported again on its next escalation.
   */
  pollNewlyEscalated(): readonly string[] {
    const newlyEscalated = this.getEscalatedQuestIds().filter(
      (questId) => !this.escalatedReported.has(questId),
    );
    for (const questId of newlyEscalated) {
      this.escalatedReported.add(questId);
    }
    return newlyEscalated;
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

  /**
   * Gen 46: drop all attention state for a single quest. Called when a quest
   * is removed from the grid so a deleted quest cannot keep pulsing or hold
   * a stale dwell timestamp (a "ghost" attention entry).
   */
  clearQuest(questId: string): void {
    const wasPulsing = this.pulsingQuestIds.delete(questId);
    const hadDwell = this.attentionEnteredAt.delete(questId);
    this.escalatedReported.delete(questId);
    if (wasPulsing || hadDwell) {
      this.requestRender();
    }
  }

  /** Clear all pulsing state (e.g. when leaving dashboard). */
  clearAll(): void {
    this.pulsingQuestIds.clear();
    this.attentionEnteredAt.clear();
    this.escalatedReported.clear();
    this.stripBlinkActive = false;
    this.requestRender();
  }
}
