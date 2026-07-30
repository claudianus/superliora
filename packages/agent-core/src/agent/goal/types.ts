import type { ModeActivationSource } from '../mode-activation';

/** Maximum objective length in characters. */
export const MAX_GOAL_OBJECTIVE_LENGTH = 4000;

/**
 * Lifecycle status of a goal — deliberately minimal. The durable record only
 * ever holds `active`, `paused`, or `blocked`; `complete` is transient
 * (announce-then-clear) and never rests on disk. There is exactly one running
 * state, two resumable "stopped" states, and one success outcome:
 *
 * | Status     | Persisted | Resumable | Set by                          | Meaning                                          |
 * |------------|-----------|-----------|---------------------------------|--------------------------------------------------|
 * | `active`   | yes       | (running) | createGoal / resumeGoal         | The goal driver may run continuation turns.      |
 * | `paused`   | yes       | yes       | pauseGoal / pauseActiveGoal /   | User, interrupt, resume, or retryable runtime    |
 * |            |           |           | pauseOnInterrupt /              | stop parked it; intact.                          |
 * |            |           |           | normalizeAfterReplay            |                                                  |
 * | `blocked`  | yes       | yes       | markBlocked                     | The system stopped it for some `reason`.         |
 * | `complete` | no        | —         | markComplete                    | Success — announced in a message, then cleared.  |
 *
 * Only an `active` goal advances: accounting and continuation turns all gate on
 * `status === 'active'`. `paused` and `blocked` are the same kind of
 * thing — "the driver is not running continuation turns, but the goal is intact
 * and resumable via `/goal resume`" — differing only in *who* stopped it (the
 * user vs the system) and the human-readable `reason`. There is no separate
 * `impossible`, `budget_limited`, `error`, or `cancelled` status: an
 * unachievable goal or an exhausted budget becomes `blocked(+reason)`,
 * runtime/model/provider failures become `paused(+reason)`, and `cancelGoal`
 * discards the record entirely. See {@link GoalMode}
 * for the setters and the per-status notes below.
 */
export type GoalStatus =
  /**
   * The goal is live and the goal driver may run continuation turns toward it.
   * Set on creation (`createGoal`) and when a paused/blocked goal is resumed
   * (`resumeGoal`). The only status under which turns/tokens/wall-clock are
   * accounted and continuation turns run.
   */
  | 'active'
  /**
   * The user stopped the goal but it is fully intact and resumable via
   * `/goal resume`. Reached three ways: the user pauses (`pauseGoal`); a live
   * turn is aborted mid-flight, e.g. Esc/shutdown (`pauseOnInterrupt`); or a
   * agent is resumed from disk, where an `active` goal cannot still be running
   * and is demoted (`normalizeAfterReplay`); or a runtime/model/provider failure
   * parked it via `pauseActiveGoal`.
   */
  | 'paused'
  /**
   * The *system* stopped pursuing the goal, for a reason carried in
   * `terminalReason`: the model reported it cannot proceed via
   * `UpdateGoal('blocked')` (an external blocker, or an objective it deems
   * unachievable); or a configured hard budget (token/turn/time) was reached.
   * Set by `markBlocked` from the model's `UpdateGoal`, the budget check in the
   * goal driver, and prompt-hook blocks.
   * Resumable like `paused` — `/goal resume` re-activates it; a plain message
   * just runs one normal turn without reactivating the loop. Editing the goal
   * while blocked takes effect on the next turn.
   */
  | 'blocked'
  /**
   * Success: the model reported the objective met via `UpdateGoal('complete')`.
   * Set by `markComplete`. This status is **transient**
   * — `markComplete` emits the completion event and then clears the durable
   * record, so the goal box disappears and `complete` never rests on disk.
   */
  | 'complete';

/** Who performed a goal action. `cleared` is a record action, not a status. */
export type GoalActor = 'user' | 'model' | 'runtime' | 'system';

export interface GoalBudgetLimits {
  readonly tokenBudget?: number;
  readonly turnBudget?: number;
  readonly wallClockBudgetMs?: number;
}

/** In-memory goal state rebuilt from agent records. */
export interface GoalState {
  goalId: string;
  objective: string;
  completionCriterion?: string;
  status: GoalStatus;
  turnsUsed: number;
  tokensUsed: number;
  /** Accumulated active-pursuit time from completed `active` intervals. */
  wallClockMs: number;
  /**
   * Epoch ms anchoring the current `active` interval (undefined when not active).
   * The live elapsed since this is added to `wallClockMs` when reporting, so the
   * timer is correct even when read mid-turn; the interval is folded into
   * `wallClockMs` when the goal leaves `active`. Reset on agent resume.
   */
  wallClockResumedAt?: number;
  budgetLimits: GoalBudgetLimits;
  /** Human-readable reason for a stopped or completed goal. */
  terminalReason?: string;
}

/** Computed budget view exposed through snapshots and tools. */
export interface GoalBudgetReport {
  readonly tokenBudget: number | null;
  readonly turnBudget: number | null;
  readonly wallClockBudgetMs: number | null;
  readonly remainingTokens: number | null;
  readonly remainingTurns: number | null;
  readonly remainingWallClockMs: number | null;
  readonly tokenBudgetReached: boolean;
  readonly turnBudgetReached: boolean;
  readonly wallClockBudgetReached: boolean;
  readonly overBudget: boolean;
}

/** Public, computed view of the current goal. */
export interface GoalSnapshot {
  readonly goalId: string;
  readonly objective: string;
  readonly completionCriterion?: string;
  readonly status: GoalStatus;
  readonly turnsUsed: number;
  readonly tokensUsed: number;
  readonly wallClockMs: number;
  readonly budget: GoalBudgetReport;
  readonly terminalReason?: string;
}

/** Wrapper returned by goal read operations and tools. */
export interface GoalToolResult {
  readonly goal: GoalSnapshot | null;
}

/** Snapshot of the goal's usage counters at the moment of a change. */
export interface GoalChangeStats {
  readonly turnsUsed: number;
  readonly tokensUsed: number;
  readonly wallClockMs: number;
}

/**
 * Describes what changed on a `goal.updated` event, so the UI can render the
 * right thing. Absent for snapshot-only refreshes (e.g. a turn increment that
 * only moves the badge).
 *
 * - `lifecycle`: a status transition — `paused` / `active` (resumed) / `blocked`
 *   — rendered as a low-profile transcript marker.
 * - `completion`: the goal completed successfully (the only outcome that posts
 *   the completion message and clears the record). This replaced the older
 *   `terminal` name, which since the state consolidation only ever meant
 *   `complete` — `blocked` is a resumable `lifecycle` change, not a completion.
 */
export type GoalChangeKind = 'lifecycle' | 'completion';

export interface GoalChange {
  readonly kind: GoalChangeKind;
  readonly status?: GoalStatus;
  readonly reason?: string;
  readonly stats?: GoalChangeStats;
  readonly actor?: GoalActor;
}

export interface CreateGoalInput {
  readonly objective: string;
  readonly completionCriterion?: string;
  readonly replace?: boolean;
  /** Whether this goal was created standalone or as part of Ultrawork orchestration. */
  readonly source?: ModeActivationSource;
}

export interface GoalReasonInput {
  readonly reason?: string;
}
