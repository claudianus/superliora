import { randomUUID } from 'node:crypto';

import { ErrorCodes, LioraError } from '#/errors/index';
import type { Agent } from '..';
import {
  maybeAdvanceUltraworkOnGoalComplete,
  maybeAdvanceUltraworkStage,
} from '../../ultrawork';
import type { CompletionAuditRejection } from '../../ultrawork/completion-audit';
import type { ModeActivationSource } from '../mode-activation';
import { DEFAULT_MODE_ACTIVATION_SOURCE } from '../mode-activation';
import type { AgentRecordOf } from '../records/types';
import { budgetTelemetryProperties } from './budget';
import {
  auditUltraworkBoundCompletion,
  checkCompleteRejectCooldown,
  evaluateStructuredCompletionPredicate,
  recordCompletionRejection,
} from './goal-completion-guards';
import {
  GOAL_CANCELLED_REMINDER,
  GOAL_COMPLETE_REJECT_COOLDOWN_TURNS,
  GOAL_NO_PROGRESS_STREAK_K,
} from './goal-constants';
import type { GoalModeHost } from './goal-mode-host';
import {
  appendGoalRecordUpdate,
  appendGoalStatusUpdate,
  clearGoalInternal,
  emitGoalUpdatedEvent,
  persistGoalState,
  trackGoalCreated,
  trackGoalEvent,
} from './goal-persistence';
import {
  normalizeGoalAfterReplay,
  restoreGoalClear,
  restoreGoalCreate,
  restoreGoalForked,
  restoreGoalUpdate,
} from './goal-restore';
import {
  applyGoalStatus,
  goalStatsOf,
  normalizeCompletionCriterion,
  toGoalSnapshot,
} from './goal-snapshot';
import {
  MAX_GOAL_OBJECTIVE_LENGTH,
  type CreateGoalInput,
  type GoalActor,
  type GoalBudgetLimits,
  type GoalChange,
  type GoalReasonInput,
  type GoalSnapshot,
  type GoalState,
  type GoalStatus,
  type GoalToolResult,
} from './types';

export * from './types';
export { GOAL_COMPLETE_REJECT_COOLDOWN_TURNS, GOAL_NO_PROGRESS_STREAK_K } from './goal-constants';

/**
 * Durable goal-mode state owned by {@link GoalMode}.
 *
 * Each agent keeps exactly one current goal, rebuilt from that agent's ordered
 * record log.
 * It owns the lifecycle rules, budget math, and actor boundaries that the
 * slash command, model tools, and goal continuation driver depend on.
 */

/**
 * Single durable owner of the current goal.
 *
 * Lifecycle rules (see the {@link GoalStatus} union for the full per-status map):
 * - Success: `markComplete` records success then clears the record (transient).
 *   The model marks completion via the `UpdateGoal('complete')` tool; the turn
 *   driver reads the status at the turn boundary. `markComplete` announces, then
 *   clears the record.
 * - Task stop: `markBlocked(reason)` sets `blocked` when the model cannot
 *   proceed, a prompt hook blocks, or a hard budget is reached. `blocked` is
 *   resumable.
 * - Pause: `pauseGoal`, `pauseActiveGoal`, and the interrupt path
 *   `pauseOnInterrupt` set `paused` (resumable); `cancelGoal` discards the
 *   record entirely (no status — this is what `/goal cancel` does, the single
 *   remove action).
 * - An aborted or failed turn is not terminal: it pauses the goal, so it stays
 *   resumable — mirroring how `normalizeAfterReplay` demotes an `active` goal to
 *   `paused` on agent resume.
 */
export class GoalMode {
  private state: GoalState | undefined;
  private activationSource: ModeActivationSource = DEFAULT_MODE_ACTIVATION_SOURCE;
  /** Consecutive false-complete rejections (cleared on successful complete). */
  private completionRejectStreak = 0;
  /** `turnsUsed` when the last completion rejection was recorded. */
  private lastRejectAtTurn: number | undefined;
  /** Progress fingerprint from the previous goal turn (no-progress detector). */
  private lastProgressSignature: string | undefined;
  private noProgressStreak = 0;
  private lastCompletionRejection: CompletionAuditRejection | undefined;

  constructor(private readonly agent: Agent) {
  }

  private get host(): GoalModeHost {
    return this as unknown as GoalModeHost;
  }

  normalizeAfterReplay(): void {
    normalizeGoalAfterReplay(this.host);
  }

  restoreCreate(record: AgentRecordOf<'goal.create'>): void {
    restoreGoalCreate(this.host, record);
  }

  restoreUpdate(record: AgentRecordOf<'goal.update'>): void {
    restoreGoalUpdate(this.host, record);
  }

  restoreClear(record: AgentRecordOf<'goal.clear'>): void {
    restoreGoalClear(this.host, record);
  }

  restoreForked(record: AgentRecordOf<'forked'>): void {
    restoreGoalForked(this.host, record);
  }

  // --- Reads -------------------------------------------------------------

  getGoal(): GoalToolResult {
    const state = this.state;
    return { goal: state === undefined ? null : this.toSnapshot(state) };
  }

  getActiveGoal(): GoalSnapshot | null {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    return this.toSnapshot(state);
  }

  // --- Creation ----------------------------------------------------------

  async createGoal(input: CreateGoalInput, actor: GoalActor = 'user'): Promise<GoalSnapshot> {
    const objective = input.objective.trim();
    if (objective.length === 0) {
      throw new LioraError(ErrorCodes.GOAL_OBJECTIVE_EMPTY, 'Goal objective cannot be empty');
    }
    if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
      throw new LioraError(
        ErrorCodes.GOAL_OBJECTIVE_TOO_LONG,
        `Goal objective cannot exceed ${MAX_GOAL_OBJECTIVE_LENGTH} characters`,
      );
    }

    const existing = this.state;
    if (existing !== undefined) {
      // Any persisted goal (active / paused / blocked) is intact and blocks a
      // new one unless `replace` is set; `complete` never persists, so it is not
      // observed here. This protects a resumable paused/blocked goal from being
      // silently overwritten.
      if (input.replace !== true) {
        throw new LioraError(
          ErrorCodes.GOAL_ALREADY_EXISTS,
          'A goal already exists; use replace to start a new one',
        );
      }
      // Clear the previous goal through the same internal clear path so records
      // stay consistent before storing the replacement.
      this.clearInternal('system');
    }

    const completionCriterion = normalizeCompletionCriterion(input.completionCriterion);
    const state: GoalState = {
      goalId: randomUUID(),
      objective,
      completionCriterion,
      status: 'active',
      turnsUsed: 0,
      tokensUsed: 0,
      wallClockMs: 0,
      wallClockResumedAt: Date.now(),
      budgetLimits: {},
    };

    this.persistState(state);
    this.agent.records.logRecord({
      type: 'goal.create',
      goalId: state.goalId,
      objective: state.objective,
      completionCriterion: state.completionCriterion,
    });
    trackGoalCreated(this.host, actor, input.replace === true);
    this.activationSource = input.source ?? DEFAULT_MODE_ACTIVATION_SOURCE;
    if (this.activationSource === 'ultrawork') {
      maybeAdvanceUltraworkStage(this.agent, 'goal', 'UltraGoal created');
    }
    return this.toSnapshot(state);
  }

  // --- User-owned lifecycle ---------------------------------------------

  async pauseGoal(input: GoalReasonInput = {}, actor: GoalActor = 'user'): Promise<GoalSnapshot> {
    const state = this.requireState();
    if (state.status === 'paused') return this.toSnapshot(state);
    if (state.status !== 'active') {
      throw new LioraError(
        ErrorCodes.GOAL_STATUS_INVALID,
        `Cannot pause a goal in status "${state.status}"`,
      );
    }
    this.applyStatus(state, 'paused');
    state.terminalReason = input.reason;
    this.persistState(state, {
      change: { kind: 'lifecycle', status: 'paused', reason: input.reason, actor },
    });
    this.appendStatusUpdate(state, actor, input.reason);
    return this.toSnapshot(state);
  }

  /**
   * Parks the current active goal without throwing if it already stopped. Runtime
   * paths use this after a turn has ended, where the user may already have
   * paused, cleared, or otherwise changed the goal.
   */
  async pauseActiveGoal(
    input: GoalReasonInput = {},
    actor: GoalActor = 'runtime',
  ): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    this.applyStatus(state, 'paused');
    state.terminalReason = input.reason;
    this.persistState(state, {
      change: { kind: 'lifecycle', status: 'paused', reason: input.reason, actor },
    });
    this.appendStatusUpdate(state, actor, input.reason);
    return this.toSnapshot(state);
  }

  async resumeGoal(input: GoalReasonInput = {}, actor: GoalActor = 'user'): Promise<GoalSnapshot> {
    const state = this.requireState();
    if (state.status === 'active') return this.toSnapshot(state);
    if (state.status !== 'paused' && state.status !== 'blocked') {
      throw new LioraError(
        ErrorCodes.GOAL_NOT_RESUMABLE,
        `Cannot resume a goal in status "${state.status}"`,
      );
    }
    // Resuming is a fresh attempt: clear the stop reason so a re-activated goal
    // starts clean.
    state.terminalReason = undefined;
    this.applyStatus(state, 'active');
    this.persistState(state, {
      change: { kind: 'lifecycle', status: 'active', reason: input.reason, actor },
    });
    this.appendStatusUpdate(state, actor, input.reason);
    return this.toSnapshot(state);
  }

  async setBudgetLimits(
    input: { budgetLimits: GoalBudgetLimits },
    actor: GoalActor = 'user',
  ): Promise<GoalSnapshot> {
    const state = this.requireState();
    state.budgetLimits = { ...state.budgetLimits, ...input.budgetLimits };
    this.persistState(state);
    appendGoalRecordUpdate(this.host, { budgetLimits: state.budgetLimits });
    trackGoalEvent(this.host, 'goal_budget_set', {
      actor,
      ...budgetTelemetryProperties(input.budgetLimits),
    });
    return this.toSnapshot(state);
  }

  /**
   * Discards the current goal — the single user-facing "remove" action
   * (`/goal cancel`). There is no `cancelled` status: cancel clears the durable
   * record and returns the snapshot it removed, so callers can report what was
   * cancelled. Throws if no goal exists. (Internal callers that need to clear
   * without a return — e.g. `createGoal` replacing an existing goal — use the
   * private `clearInternal`.)
   */
  async cancelGoal(actor: GoalActor = 'user'): Promise<GoalSnapshot> {
    const state = this.requireState();
    const snapshot = this.toSnapshot(state);
    this.clearInternal(actor);
    if (actor === 'user') {
      this.agent.context.appendSystemReminder(GOAL_CANCELLED_REMINDER, {
        kind: 'system_trigger',
        name: 'goal_cancelled',
      });
    }
    return snapshot;
  }

  // --- Terminal outcomes (system-decided) -------------------------------

  /**
   * Marks the goal `blocked`: the system stopped pursuing it for `reason` — the
   * model's `UpdateGoal('blocked')` (incl. objectives it deems unachievable), a
   * hard budget reached by the goal driver, or a prompt-hook block.
   * `blocked` is persisted and **resumable** via
   * `/goal resume` (it is a sibling of `paused`, not a dead end), so it emits a
   * `lifecycle` change. No-ops for a goal that is missing or not active, so a
   * user pause / clear is never overwritten.
   */
  async markBlocked(
    input: GoalReasonInput = {},
    actor: GoalActor = 'runtime',
  ): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    this.applyStatus(state, 'blocked');
    state.terminalReason = input.reason;
    this.persistState(state, {
      change: { kind: 'lifecycle', status: 'blocked', reason: input.reason, actor },
    });
    this.appendStatusUpdate(state, actor, input.reason);
    return this.toSnapshot(state);
  }

  /**
   * Records goal success, then clears the durable record. `complete` is
   * transient: this records and emits a terminal `complete` change carrying the
   * final stats (so the UI/caller can render the outcome), then clears the goal
   * so the box disappears. Returns the final snapshot (status `complete`). No-ops
   * for a goal that is missing or not active.
   *
   * Guards (keep goal `active` on failure — AC-A2/A3):
   * 1. Reject cooldown N={@link GOAL_COMPLETE_REJECT_COOLDOWN_TURNS} after a
   *    false complete (model actor only — runtime finish may close verified runs).
   * 2. Ultrawork completion audit when a live run is bound.
   * 3. Structured GoalPredicate evaluation when present.
   *
   * Caller (UpdateGoal) should surface {@link getLastCompletionRejection}.
   */
  async markComplete(
    input: GoalReasonInput = {},
    actor: GoalActor = 'model',
  ): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;

    const rejection =
      checkCompleteRejectCooldown(this.host, state, actor) ??
      auditUltraworkBoundCompletion(this.agent, actor) ??
      (await evaluateStructuredCompletionPredicate(this.agent, state));

    if (rejection !== null) {
      recordCompletionRejection(this.host, state, rejection, actor);
      // Keep goal active so the autonomous loop continues.
      return null;
    }

    this.lastCompletionRejection = undefined;
    this.completionRejectStreak = 0;
    this.lastRejectAtTurn = undefined;
    this.noProgressStreak = 0;
    this.lastProgressSignature = undefined;

    this.applyStatus(state, 'complete');
    state.terminalReason = input.reason;
    const snapshot = this.toSnapshot(state);
    // Record + notify the UI of completion (with final stats) before clearing.
    this.appendStatusUpdate(state, actor, input.reason);
    this.emitGoalUpdated(snapshot, {
      kind: 'completion',
      status: 'complete',
      reason: input.reason,
      stats: this.statsOf(state),
      actor,
    });
    if (this.activationSource === 'ultrawork') {
      maybeAdvanceUltraworkOnGoalComplete(this.agent);
    }
    // ...then clear the durable record (emits onGoalUpdated(null) → box clears).
    this.clearInternal(actor);
    return snapshot;
  }

  /**
   * Last rejection from {@link markComplete} (ultrawork / predicate / cooldown).
   * Cleared on a successful complete. UpdateGoal reads this for tool output.
   */
  getLastCompletionRejection(): CompletionAuditRejection | undefined {
    return this.lastCompletionRejection;
  }

  /** Consecutive false-complete rejections since last success (tests / dashboards). */
  getCompletionRejectStreak(): number {
    return this.completionRejectStreak;
  }

  /**
   * Record end-of-turn progress for the no-progress detector (AC-C1).
   * Call from the goal driver after each completed goal turn while still active.
   * Returns the current streak after update.
   */
  noteGoalTurnProgress(signature: string): number {
    const sig = signature.trim();
    if (sig.length === 0) return this.noProgressStreak;
    if (this.lastProgressSignature !== undefined && this.lastProgressSignature === sig) {
      this.noProgressStreak += 1;
    } else {
      this.noProgressStreak = 0;
      this.lastProgressSignature = sig;
    }
    return this.noProgressStreak;
  }

  getNoProgressStreak(): number {
    return this.noProgressStreak;
  }

  // --- User-interrupt transition ----------------------------------------

  /**
   * Parks an active goal when its live turn is aborted (Esc, shutdown, or any
   * other turn-level cancellation). This is **not** terminal: the goal becomes
   * `paused` and stays resumable via `/goal resume`, mirroring how
   * `normalizeAfterReplay` demotes an `active` goal on agent resume. No-ops for
   * a goal that is missing or already non-active, so a user pause / clear or an
   * already-stopped goal is never overwritten.
   */
  async pauseOnInterrupt(input: { reason?: string } = {}): Promise<GoalSnapshot | null> {
    return this.pauseActiveGoal(input, 'user');
  }

  // --- Accounting & reporting -------------------------------------------

  async recordTokenUsage(tokenDelta: number): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    const delta = Math.max(0, tokenDelta);
    state.tokensUsed += delta;
    this.persistState(state, { silent: true }); // per-step: no UI update
    appendGoalRecordUpdate(this.host, { tokensUsed: state.tokensUsed });
    return this.toSnapshot(state);
  }

  async incrementTurn(): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    state.turnsUsed += 1;
    this.persistState(state);
    appendGoalRecordUpdate(this.host, { turnsUsed: state.turnsUsed });
    trackGoalEvent(this.host, 'goal_continued', {
      turns_used: state.turnsUsed,
    });
    return this.toSnapshot(state);
  }

  // --- Internals ---------------------------------------------------------

  private clearInternal(
    actor: GoalActor,
    opts: { emit?: boolean; track?: boolean } = {},
  ): void {
    clearGoalInternal(this.host, actor, opts);
  }

  private appendStatusUpdate(state: GoalState, actor: GoalActor, reason?: string): void {
    appendGoalStatusUpdate(this.host, state, actor, reason);
  }

  private applyStatus(state: GoalState, status: GoalStatus): void {
    applyGoalStatus(state, status);
  }

  private persistState(
    state: GoalState | undefined,
    opts: { silent?: boolean; change?: GoalChange } = {},
  ): void {
    persistGoalState(this.host, state, opts);
  }

  private emitGoalUpdated(snapshot: GoalSnapshot | null, change?: GoalChange): void {
    emitGoalUpdatedEvent(this.host, snapshot, change);
  }

  private statsOf(state: GoalState) {
    return goalStatsOf(state);
  }

  private toSnapshot(state: GoalState): GoalSnapshot {
    return toGoalSnapshot(state);
  }

  private requireState(): GoalState {
    const state = this.state;
    if (state === undefined) {
      throw new LioraError(ErrorCodes.GOAL_NOT_FOUND, 'No current goal');
    }
    return state;
  }
}
