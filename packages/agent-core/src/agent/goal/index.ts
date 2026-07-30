import { randomUUID } from 'node:crypto';

import { ErrorCodes, LioraError } from '#/errors';
import type { Agent } from '..';
import {
  maybeAdvanceUltraworkOnGoalComplete,
  maybeAdvanceUltraworkStage,
} from '../../ultrawork';
import {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
  type CompletionAuditRejection,
} from '../../ultrawork/completion-audit';
import type { ModeActivationSource } from '../mode-activation';
import { DEFAULT_MODE_ACTIVATION_SOURCE } from '../mode-activation';
import type { AgentRecordOf } from '../records/types';
import {
  type TelemetryProperties,
} from '../../telemetry';
import {
  budgetTelemetryProperties,
  computeBudgetReport,
  liveWallClockMs,
} from './budget';
import { parseGoalPredicateCriterion } from './predicate';
import {
  countEvidenceIds,
  evaluateGoalPredicate,
  formatPredicateFailures,
} from './predicate-runner';
import {
  MAX_GOAL_OBJECTIVE_LENGTH,
  type CreateGoalInput,
  type GoalActor,
  type GoalBudgetLimits,
  type GoalChange,
  type GoalChangeStats,
  type GoalReasonInput,
  type GoalSnapshot,
  type GoalState,
  type GoalStatus,
  type GoalToolResult,
} from './types';

export * from './types';

/**
 * After a false-complete rejection, further `markComplete` attempts are rejected
 * with `reject_cooldown` until this many goal turns have elapsed (AC-A3).
 */
export const GOAL_COMPLETE_REJECT_COOLDOWN_TURNS = 3;

/**
 * Consecutive goal turns with an unchanged progress signature before the
 * driver injects a no-progress reminder (AC-C1).
 */
export const GOAL_NO_PROGRESS_STREAK_K = 6;

/**
 * Durable goal-mode state owned by {@link GoalMode}.
 *
 * Each agent keeps exactly one current goal, rebuilt from that agent's ordered
 * record log.
 * It owns the lifecycle rules, budget math, and actor boundaries that the
 * slash command, model tools, and goal continuation driver depend on.
 */

const GOAL_CANCELLED_REMINDER = [
  'The user cancelled the current goal.',
  'Ignore earlier active-goal reminders for that goal.',
  'Handle the next user request normally unless the user starts or resumes a goal.',
].join(' ');

const GOAL_FORK_CLEARED_REMINDER = [
  'This fork does not have a current goal.',
  'Ignore earlier active-goal reminders from the source session.',
  'Handle requests normally unless the user starts a new goal.',
].join(' ');

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

  constructor(private readonly agent: Agent) {
  }

  /**
   * Reconciles replayed goal state with runtime reality on agent resume.
   *
   * An `active` goal cannot still be running after a process restart (goal
   * continuation only advances inside a live turn), so it is demoted to
   * `paused`, requiring `/goal resume` to restart work. `paused` and `blocked`
   * goals are preserved (both resumable). Any stray `complete` (which should
   * have been followed by `goal.clear`) is removed.
   */
  normalizeAfterReplay(): void {
    const state = this.state;
    if (state === undefined) return;

    state.wallClockResumedAt = undefined;

    if (state.status === 'complete') {
      this.clearInternal('runtime', { emit: false, track: false });
      return;
    }

    if (state.status === 'active') {
      const reason = 'Paused after agent resume';
      this.applyStatus(state, 'paused');
      state.terminalReason = reason;
      this.persistState(state, { silent: true });
      this.appendStatusUpdate(state, 'runtime', reason);
      return;
    }

    // `paused` and `blocked` goals are left intact (both resumable).
  }

  restoreCreate(record: AgentRecordOf<'goal.create'>): void {
    const state: GoalState = {
      goalId: record.goalId,
      objective: record.objective,
      completionCriterion: record.completionCriterion,
      status: 'active',
      turnsUsed: 0,
      tokensUsed: 0,
      wallClockMs: 0,
      budgetLimits: {},
    };
    this.state = state;
    this.agent.replayBuilder.push({
      type: 'goal_updated',
      snapshot: this.toSnapshot(state),
      change: { kind: 'created' },
    });
  }

  restoreUpdate(record: AgentRecordOf<'goal.update'>): void {
    const state = this.state;
    if (state === undefined) return;

    const status = record.status;
    if (status !== undefined) {
      state.status = status;
      state.wallClockResumedAt = undefined;
      state.terminalReason = status === 'active' ? undefined : record.reason;
    }
    if (record.turnsUsed !== undefined) state.turnsUsed = record.turnsUsed;
    if (record.tokensUsed !== undefined) state.tokensUsed = record.tokensUsed;
    if (record.wallClockMs !== undefined) {
      state.wallClockMs = record.wallClockMs;
      state.wallClockResumedAt = undefined;
    }
    if (record.budgetLimits !== undefined) state.budgetLimits = record.budgetLimits;
    if (status === undefined) return;

    this.agent.replayBuilder.push({
      type: 'goal_updated',
      snapshot: this.toSnapshot(state),
      change: status === 'complete'
        ? {
            kind: 'completion',
            status,
            reason: record.reason,
            stats: this.statsOf(state),
            actor: record.actor,
          }
        : {
            kind: 'lifecycle',
            status,
            reason: record.reason,
            actor: record.actor,
          },
    });
  }

  restoreClear(_record: AgentRecordOf<'goal.clear'>): void {
    this.state = undefined;
  }

  restoreForked(_record: AgentRecordOf<'forked'>): void {
    const hadGoal = this.state !== undefined;
    this.state = undefined;
    if (!hadGoal) return;
    this.agent.context.appendSystemReminder(GOAL_FORK_CLEARED_REMINDER, {
      kind: 'system_trigger',
      name: 'goal_fork_cleared',
    });
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
    this.trackGoalCreated(actor, input.replace === true);
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
    this.appendGoalUpdate({ budgetLimits: state.budgetLimits });
    this.track('goal_budget_set', {
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
   * 3. Structured {@link parseGoalPredicateCriterion} evaluation when present.
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
      this.checkCompleteRejectCooldown(state, actor) ??
      this.auditUltraworkBoundCompletion(actor) ??
      (await this.evaluateStructuredCompletionPredicate(state));

    if (rejection !== null) {
      this.recordCompletionRejection(state, rejection, actor);
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

  private lastCompletionRejection: CompletionAuditRejection | undefined;

  private checkCompleteRejectCooldown(
    state: GoalState,
    actor: GoalActor,
  ): CompletionAuditRejection | null {
    // Runtime finish paths may close a verified run without waiting for cooldown.
    if (actor === 'runtime' || actor === 'system') return null;
    if (this.lastRejectAtTurn === undefined || this.completionRejectStreak === 0) {
      return null;
    }
    const elapsed = state.turnsUsed - this.lastRejectAtTurn;
    if (elapsed >= GOAL_COMPLETE_REJECT_COOLDOWN_TURNS) return null;
    const remaining = GOAL_COMPLETE_REJECT_COOLDOWN_TURNS - elapsed;
    // Re-surface the prior audit rejection so cooldown turns still show
    // concrete repair actions (node_failed / dependsOn / stuck / verification-gap /
    // evidence hard-gate) instead of only "wait N turns" generic lines.
    const prior = this.lastCompletionRejection;
    const priorCode =
      prior !== undefined && prior.code !== 'reject_cooldown' ? prior.code : undefined;
    // Keep up to 3 prior actions so multi-hint audits (evidence + verification + stuck)
    // survive cooldown without collapsing to a single generic line.
    const priorActions =
      prior !== undefined && prior.code !== 'reject_cooldown'
        ? prior.nextActions.slice(0, 3)
        : [];
    return {
      ok: false,
      code: 'reject_cooldown',
      reasons: [
        `Completion rejected: cooldown active (${elapsed}/${GOAL_COMPLETE_REJECT_COOLDOWN_TURNS} turns since last false complete).`,
        `Reject streak: ${this.completionRejectStreak}. Wait ~${remaining} more goal turn(s) and make real progress before UpdateGoal(complete).`,
        ...(priorCode !== undefined ? [`Prior rejection code: ${priorCode}.`] : []),
        ...(prior !== undefined && prior.code !== 'reject_cooldown'
          ? prior.reasons.slice(0, 3)
          : []),
      ],
      nextActions: [
        ...priorActions,
        'Implement or verify open work (tests, evidence, WorkGraph nodes).',
        `Do not spam UpdateGoal(complete); wait at least ${GOAL_COMPLETE_REJECT_COOLDOWN_TURNS} goal turns after a rejection.`,
      ],
      openNodeIds: prior?.openNodeIds,
    };
  }

  private recordCompletionRejection(
    state: GoalState,
    rejection: CompletionAuditRejection,
    actor: GoalActor,
  ): void {
    this.lastCompletionRejection = rejection;
    // Cooldown rejections do not inflate the streak further.
    if (rejection.code !== 'reject_cooldown') {
      this.completionRejectStreak += 1;
      this.lastRejectAtTurn = state.turnsUsed;
    }
    this.agent.context.appendSystemReminder(formatCompletionAuditRejection(rejection), {
      kind: 'injection',
      variant: 'ultrawork_completion_rejected',
    });
    this.agent.log?.warn?.('goal markComplete rejected', {
      code: rejection.code,
      actor,
      reasons: rejection.reasons,
      streak: this.completionRejectStreak,
    });
    this.agent.telemetry.track('goal_complete_audit_rejected', {
      code: rejection.code,
      actor,
      open_nodes: rejection.openNodeIds?.length ?? 0,
      reject_streak: this.completionRejectStreak,
    });
  }

  /**
   * When the goal was activated by Ultrawork (or an Ultrawork run is live),
   * require a passing completion audit. Plain standalone goals are unrestricted
   * unless a structured GoalPredicate is set (see evaluateStructured…).
   * Runtime actor still requires audit so empty graphs cannot close via finish.
   */
  private auditUltraworkBoundCompletion(
    _actor: GoalActor,
  ): CompletionAuditRejection | null {
    const run = this.agent.ultrawork?.getRun() ?? null;
    // No live ultrawork run: plain goal mode may complete freely (predicate still applies).
    if (run === null) return null;
    // Already terminal: allow markComplete to clear the goal box.
    if (run.status === 'done' || run.status === 'failed') return null;
    const audit = auditUltraworkCompletion({ run, requireWorkGraph: true });
    if (audit.ok) return null;
    return audit;
  }

  /**
   * Evaluate structured GoalPredicate embedded in completionCriterion.
   * Legacy free-text criteria are not machine-checked here (model + UW audit).
   */
  private async evaluateStructuredCompletionPredicate(
    state: GoalState,
  ): Promise<CompletionAuditRejection | null> {
    const parsed = parseGoalPredicateCriterion(state.completionCriterion);
    if (parsed.kind !== 'structured') return null;

    const run = this.agent.ultrawork?.getRun() ?? null;
    const workspaceRoot =
      (this.agent as { config?: { cwd?: string } }).config?.cwd ?? process.cwd();

    try {
      const result = await evaluateGoalPredicate({
        spec: parsed.spec,
        workspaceRoot,
        ultraworkRun: run,
        evidenceIdCount: countEvidenceIds(run),
      });
      if (result.ok) return null;
      return {
        ok: false,
        code: 'predicate_failed',
        reasons: [
          'Structured GoalPredicate evaluation failed.',
          ...result.failures.map((f) => `[${f.code}] ${f.message}`),
        ],
        nextActions: [
          'Create missing requiredPaths or fix requiredTestFiles.',
          'Attach evidenceIds / pass Ultrawork audit when requireUltraworkGraph is set.',
          'Only then call UpdateGoal(complete).',
        ],
      };
    } catch (error) {
      return {
        ok: false,
        code: 'predicate_failed',
        reasons: [
          `GoalPredicate runner error: ${error instanceof Error ? error.message : String(error)}`,
          formatPredicateFailures([]),
        ],
        nextActions: [
          'Fix the predicate runner environment (workspace cwd, vitest) and retry.',
        ],
      };
    }
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
    this.appendGoalUpdate({ tokensUsed: state.tokensUsed });
    return this.toSnapshot(state);
  }

  async incrementTurn(): Promise<GoalSnapshot | null> {
    const state = this.state;
    if (state === undefined || state.status !== 'active') return null;
    state.turnsUsed += 1;
    this.persistState(state);
    this.appendGoalUpdate({ turnsUsed: state.turnsUsed });
    this.track('goal_continued', {
      turns_used: state.turnsUsed,
    });
    return this.toSnapshot(state);
  }

  // --- Internals ---------------------------------------------------------

  private clearInternal(
    actor: GoalActor,
    opts: { emit?: boolean; track?: boolean } = {},
  ): void {
    const state = this.state;
    if (state === undefined) return; // idempotent
    this.persistState(undefined, { silent: opts.emit === false });
    this.agent.records.logRecord({ type: 'goal.clear' });
    if (opts.track !== false) {
      this.track('goal_cleared', { actor });
    }
  }

  private appendStatusUpdate(state: GoalState, actor: GoalActor, reason?: string): void {
    this.appendGoalUpdate({
      status: state.status,
      reason,
      wallClockMs: liveWallClockMs(state, Date.now()),
      actor,
    });
    this.track('goal_status_changed', {
      actor,
      status: state.status,
      turns_used: state.turnsUsed,
      tokens_used: state.tokensUsed,
      wall_clock_ms: liveWallClockMs(state, Date.now()),
      ...budgetTelemetryProperties(state.budgetLimits),
    });
  }

  private appendGoalUpdate(
    update: Omit<AgentRecordOf<'goal.update'>, 'type' | 'time'>,
  ): void {
    this.agent.records.logRecord({
      type: 'goal.update',
      ...update,
    });
  }

  private trackGoalCreated(
    actor: GoalActor,
    replace: boolean,
  ): void {
    this.track('goal_created', {
      actor,
      replace,
    });
  }

  private track(event: string, properties: TelemetryProperties): void {
    this.agent.telemetry.track(event, properties);
  }

  private applyStatus(
    state: GoalState,
    status: GoalStatus,
  ): void {
    // Fold the live wall-clock interval into the running total when leaving
    // `active`, and anchor a fresh interval when entering it, so `wallClockMs`
    // stays a correct, persistable total across pause/resume/complete.
    const now = Date.now();
    if (state.status === 'active' && state.wallClockResumedAt !== undefined) {
      state.wallClockMs += Math.max(0, now - state.wallClockResumedAt);
      state.wallClockResumedAt = undefined;
    }
    if (status === 'active') {
      state.wallClockResumedAt = now;
    }
    state.status = status;
  }

  private requireState(): GoalState {
    const state = this.state;
    if (state === undefined) {
      throw new LioraError(ErrorCodes.GOAL_NOT_FOUND, 'No current goal');
    }
    return state;
  }


  /**
   * Updates in-memory goal state and (unless `silent`) emits a `goal.updated`
   * event with the resulting snapshot. `silent` is used for per-step token /
   * wall-clock accounting so the UI is not updated on every step.
   */
  private persistState(
    state: GoalState | undefined,
    opts: { silent?: boolean; change?: GoalChange } = {},
  ): void {
    this.state = state;
    if (opts.silent !== true) {
      this.emitGoalUpdated(state === undefined ? null : this.toSnapshot(state), opts.change);
    }
  }

  private emitGoalUpdated(snapshot: GoalSnapshot | null, change?: GoalChange): void {
    this.agent.emitEvent({ type: 'goal.updated', snapshot, change });
  }

  /** Counter snapshot for a {@link GoalChange}. */
  private statsOf(state: GoalState): GoalChangeStats {
    return {
      turnsUsed: state.turnsUsed,
      tokensUsed: state.tokensUsed,
      wallClockMs: liveWallClockMs(state, Date.now()),
    };
  }

  private toSnapshot(state: GoalState): GoalSnapshot {
    return {
      goalId: state.goalId,
      objective: state.objective,
      completionCriterion: state.completionCriterion,
      status: state.status,
      turnsUsed: state.turnsUsed,
      tokensUsed: state.tokensUsed,
      wallClockMs: liveWallClockMs(state, Date.now()),
      budget: computeBudgetReport(state, Date.now()),
      terminalReason: state.terminalReason,
    };
  }
}

function normalizeCompletionCriterion(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
}
