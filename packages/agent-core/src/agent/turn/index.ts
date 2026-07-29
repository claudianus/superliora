import { createControlledPromise, type ControlledPromise } from '@antfu/utils';
import {
  APIContextOverflowError,
  grandTotal,
  type ContentPart,
} from '@superliora/kosong';
import { basename } from 'pathe';

import type { Agent } from '..';
import {
  ErrorCodes,
  isKimiError,
  makeErrorPayload,
  toKimiErrorPayload,
} from '#/errors';
import { isAbortError, isMaxStepsExceededError } from '../../loop/errors';
import {
  createLoopEventDispatcher,
  runTurn,
  type LoopEvent,
  type LoopRecordedEvent,
  type LoopTurnStopReason,
  type RecordStepUsageInfo,
} from '../../loop/index';
import type { AgentEvent, TurnEndedEvent, TurnEndReason } from '../../rpc/events';
import type { TelemetryPropertyValue } from '../../telemetry';
import type { TurnCancelSource } from '../../rpc/core-api';
import { abortable, isUserCancellation, userCancellationReason } from '../../utils/abort';
import { StreamingThinkScrubber } from '../../utils/think-scrubber';
import { USER_PROMPT_ORIGIN, type PromptOrigin } from '../context';
import { renderUserPromptHookBlockResult, renderUserPromptHookResult } from '../../session/hooks';
import { ToolCallDeduplicator } from './tool-dedup';
import { budgetToolResultForModel } from './tool-result-budget';
import { isRetryableProviderFailure } from '../provider-failover';
import { GOAL_NO_PROGRESS_STREAK_K } from '../goal';
import {
  TurnTelemetry,
  classifyApiError,
  currentTurnInputTokens,
  toolInputRecord,
  toolOutputText,
} from './telemetry';
import { mapLoopEvent } from './event-handler';
import {
  GOAL_PROVIDER_FILTERED_PAUSE_REASON,
  summarizeTurnError,
  goalFailurePauseReason,
  abandonedToolResultOutput,
  recoverFromProviderFailure,
} from './error-recovery';
import {
  GOAL_CONTINUATION_ORIGIN,
  GOAL_CONTINUATION_PROMPT,
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
  buildGoalProgressSignature,
  isGoalOutcomeReminderOrigin,
  hasStepBudgetRemaining,
} from './goal-driver';

export {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
};

interface ActiveTurn {
  readonly turnId: number;
  readonly controller: AbortController;
  readonly promise: Promise<TurnEndResult>;
  readonly firstRequest: ControlledPromise<void>;
}

interface BufferedSteer {
  readonly input: readonly ContentPart[];
  readonly origin: PromptOrigin;
}

export interface TurnEndResult {
  readonly event: TurnEndedEvent;
  readonly stopReason?: LoopTurnStopReason;
  readonly blockedByUserPromptHook?: boolean;
}

interface PromptHookEndResult {
  readonly event: TurnEndedEvent;
  readonly blocked: boolean;
}

export class TurnFlow {
  private steerBuffer: BufferedSteer[] = [];
  private turnId = -1;
  private activeTurn: 'resuming' | ActiveTurn | null = null;
  /** Suppress leaked `<think>`/`<reasoning>` tags in assistant text deltas. */
  private readonly assistantThinkScrubber = new StreamingThinkScrubber();
  private readonly turnTelemetry: TurnTelemetry;

  constructor(protected readonly agent: Agent) {
    this.turnTelemetry = new TurnTelemetry(agent);
  }

  /** Returns the id of the currently active turn, or undefined if no turn is running. */
  currentTurnId(): number | undefined {
    if (this.activeTurn === null || this.activeTurn === 'resuming') return undefined;
    return this.activeTurn.turnId;
  }

  /** Best-effort agent id (main / generated id) derived from the agent homedir. */
  private get agentId(): string {
    return this.agent.homedir ? basename(this.agent.homedir) : this.agent.type;
  }

  // Returns the new turnId, or null if the turn was marked as resuming.
  prompt(input: readonly ContentPart[], origin: PromptOrigin = USER_PROMPT_ORIGIN): number | null {
    this.agent.records.logRecord({
      type: 'turn.prompt',
      input,
      origin,
    });
    return this.launch(input, origin);
  }

  // Returns the new turnId, or null if the input was buffered as a steer
  // message or the turn was marked as resuming.
  steer(input: readonly ContentPart[], origin: PromptOrigin = USER_PROMPT_ORIGIN): number | null {
    this.agent.records.logRecord({
      type: 'turn.steer',
      input,
      origin,
    });
    if (this.activeTurn || this.agent.fullCompaction.isCompacting) {
      this.steerBuffer.push({ input, origin });
      return null;
    }
    return this.launch(input, origin);
  }

  retry(trigger?: string): number | null {
    return this.prompt([], { kind: 'retry', trigger });
  }

  private launch(input: readonly ContentPart[], origin: PromptOrigin): number | null {
    if (this.activeTurn) {
      this.agent.emitEvent({
        type: 'error',
        ...makeErrorPayload(
          'turn.agent_busy',
          `Cannot launch a new turn while another turn (ID ${this.turnId}) is active`,
          { details: { turnId: this.turnId } },
        ),
      });
      return null;
    }

    if (this.agent.fullCompaction.isCompacting) {
      this.steerBuffer.push({ input, origin });
      return null;
    }

    // Per-turn setup (telemetry, usage window, `turn.started`, appending the
    // prompt) now lives in `runOneTurn`, so a goal-driven run emits a clean
    // start/end pair per continuation turn rather than one mega-turn.
    const turnId = this.allocateTurnId();
    const controller = new AbortController();
    const promise = this.turnWorker(turnId, input, origin, controller.signal);
    const firstRequest = createControlledPromise<void>();
    this.activeTurn = {
      turnId,
      controller,
      promise,
      firstRequest,
    };

    void firstRequest.catch(() => undefined);
    // Resolve the first-request gate when the turn ends cleanly so callers
    // can treat rejection strictly as an error. If a stream event already
    // resolved it, the second resolve is a harmless no-op. The turn promise
    // resolves with a TurnEndResult; we discard it so the void-typed
    // first-request gate stays type-clean.
    void promise.then(
      () => firstRequest.resolve(),
      firstRequest.reject,
    );

    return turnId;
  }

  /** Allocates the next monotonic turn id. */
  private allocateTurnId(): number {
    this.turnId += 1;
    return this.turnId;
  }

  restorePrompt(): void {
    if (this.activeTurn) {
      return;
    }
    this.turnId += 1;
    this.activeTurn = 'resuming';
  }

  /**
   * Raise the turn counter to cover a turnId observed in a replayed loop event.
   * This is the authoritative source of the restored counter: every turn that
   * ran — a prompted turn, a goal continuation, or a steer-launched turn —
   * emits loop events carrying its real turnId, even though only prompted turns
   * write a `turn.prompt` record. Resuming then continues from `max + 1`. Only
   * ever raises the counter, never lowers it, so the live path (where `turnId`
   * is already allocated before any loop event) is unaffected.
   */
  observeRestoredTurnId(turnId: number): void {
    if (Number.isInteger(turnId) && turnId > this.turnId) {
      this.turnId = turnId;
    }
  }

  restoreSteer(input: readonly ContentPart[], origin: PromptOrigin): void {
    if (this.activeTurn) {
      this.steerBuffer.push({ input, origin });
      return;
    }
    this.turnId += 1;
    this.activeTurn = 'resuming';
  }

  cancel(turnId?: number, reason?: unknown, source?: TurnCancelSource): void {
    this.agent.records.logRecord({ type: 'turn.cancel', turnId, source });
    if (turnId !== undefined && turnId !== this.currentId) {
      return; // Ignore cancel for non-active turn
    }
    const cancelReason = reason ?? userCancellationReason();
    this.abortTurn(cancelReason);
    this.agent.subagentHost?.cancelAll(cancelReason);
    this.agent.telemetry.track('turn_cancel', {
      source: source ?? (isUserCancellation(cancelReason) ? 'rpc' : 'signal'),
      user_cancelled: isUserCancellation(cancelReason),
    });
  }

  get currentId() {
    return this.turnId;
  }

  get hasActiveTurn(): boolean {
    return this.activeTurn !== null && this.activeTurn !== 'resuming';
  }

  private ensureActiveTurn(): ActiveTurn {
    if (this.activeTurn === null || this.activeTurn === 'resuming') {
      throw new Error('No active turn');
    }
    return this.activeTurn;
  }

  waitForCurrentTurn(signal?: AbortSignal | undefined): Promise<TurnEndResult> {
    const active = this.ensureActiveTurn();
    signal?.throwIfAborted();
    if (signal === undefined) return active.promise;

    const turnId = this.currentId;
    const onAbort = (): void => {
      this.agent.turn.cancel(turnId, signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    return abortable(active.promise, signal).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  }

  waitForTurnFirstRequest(): Promise<void> {
    return this.ensureActiveTurn().firstRequest;
  }

  private abortTurn(reason: unknown) {
    if (this.activeTurn !== 'resuming') {
      // The reason (a user cancellation by default, or the originating signal's
      // reason when propagated) travels as signal.reason so tools settling on
      // this signal can report a deliberate user interruption distinctly from a
      // timeout/system abort. linkAbortSignal forwards it to linked subagents.
      this.activeTurn?.controller.abort(reason);
    }
    this.activeTurn = null;
  }

  private flushSteerBuffer(): boolean {
    const steers = this.steerBuffer;
    if (steers.length === 0) return false;
    for (const steer of steers) {
      this.agent.context.appendUserMessage(steer.input, steer.origin);
    }
    steers.length = 0;
    return true;
  }

  onCompactionFinished(): void {
    if (this.steerBuffer.length === 0) return;
    if (this.activeTurn !== null) {
      this.flushSteerBuffer();
      return;
    }
    const next = this.steerBuffer.shift()!;
    this.launch(next.input, next.origin);
  }

  finishResume(): void {
    if (this.activeTurn === 'resuming') {
      this.activeTurn = null;
    }
    this.steerBuffer.length = 0;
  }

  /**
   * The body of the single in-flight `activeTurn`. Routes to the goal driver
   * (sequential continuation turns) when a goal is active, otherwise runs exactly
   * one turn. Clears `activeTurn` when the whole run finishes (identified by the
   * launch signal, so a superseding turn is never clobbered).
   */
  private async turnWorker(
    firstTurnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    const ownsActiveTurn = (): boolean =>
      this.activeTurn !== null &&
      this.activeTurn !== 'resuming' &&
      this.activeTurn.controller.signal === signal;
    try {
      const initialGoalStatus = this.agent.goal.getGoal().goal?.status;
      if (initialGoalStatus === 'active') {
        return await this.driveGoal(firstTurnId, input, origin, signal);
      }
      let end = await this.runOneTurn(firstTurnId, input, origin, signal, true);
      // Ordinary Ultrawork / single turns also hit rate limits and transient
      // provider failures. Recover here so a mid-run 429 does not silently end
      // the turn when a goal is not yet active.
      if (end.event.reason === 'failed' && isRetryableProviderFailure(end.event.error)) {
        end = await recoverFromProviderFailure(
          { agent: this.agent, runOneTurn: (tid, inp, org, sig, sa) => this.runOneTurn(tid, inp, org, sig, sa) },
          firstTurnId,
          input,
          origin,
          signal,
          end,
        );
      }
      // A goal can become active during an ordinary turn: the model creates one
      // with CreateGoal, or resumes a paused/blocked goal via UpdateGoal. Either
      // way, hand the now-active goal to the driver so it is actually pursued,
      // instead of stopping after the turn that merely started it. (The
      // already-active case took the early return above.)
      const goalBecameActive = this.agent.goal.getGoal().goal?.status === 'active';
      if (
        goalBecameActive &&
        end.event.reason !== 'cancelled' &&
        end.event.reason !== 'failed' &&
        end.event.reason !== 'filtered'
      ) {
        return await this.driveGoal(
          this.allocateTurnId(),
          [{ type: 'text', text: GOAL_CONTINUATION_PROMPT }],
          GOAL_CONTINUATION_ORIGIN,
          signal,
        );
      }
      await this.markUltraworkInterruptedForTurnEnd(end);
      return end;
    } finally {
      if (ownsActiveTurn()) {
        this.activeTurn = null;
      }
    }
  }

  /**
   * Drives an active goal as a sequence of ordinary turns — the autonomous
   * equivalent of the user repeatedly typing "continue". Each iteration runs one
   * full turn, then reads the goal status the model set via `UpdateGoal`:
   * `complete` (the record is cleared) / `blocked` / `paused` stop the loop;
   * `active` (the model didn't decide) re-injects the goal reminder and runs the
   * next continuation turn. Aborted or failed turns pause the goal. Goal-state
   * blockers, such as explicit `UpdateGoal('blocked')`, prompt-hook blocks, and
   * budget limits, block it (all resumable). Returns the final turn's result.
   */
  private async driveGoal(
    firstTurnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    let turnId = firstTurnId;
    let turnInput = input;
    let turnOrigin = origin;
    while (true) {
      const goalBeforeTurn = this.agent.goal.getGoal().goal;
      if (goalBeforeTurn?.status === 'active' && goalBeforeTurn.budget.overBudget) {
        await this.agent.goal.markBlocked({ reason: 'A configured budget was reached' });
        const ended = await this.endGoalTurnWithoutModel(turnId, turnInput, turnOrigin);
        return { event: ended };
      }

      // Count the turn about to run (no-op if the goal isn't active), so the
      // completion stats include the turn in which the model reports `complete`.
      // Wall-clock is tracked live by the store (anchored while `active`), so the
      // timer is correct even when the model completes mid-turn.
      await this.agent.goal.incrementTurn();
      let end = await this.runOneTurn(turnId, turnInput, turnOrigin, signal, false);
      if (end.event.reason === 'failed' && isRetryableProviderFailure(end.event.error)) {
        end = await recoverFromProviderFailure(
          { agent: this.agent, runOneTurn: (tid, inp, org, sig, sa) => this.runOneTurn(tid, inp, org, sig, sa) },
          turnId,
          turnInput,
          turnOrigin,
          signal,
          end,
        );
      }

      if (end.event.reason === 'cancelled') {
        await this.agent.goal.pauseOnInterrupt({ reason: 'Paused after interruption' });
        await this.agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });
        return end;
      }
      if (end.event.reason === 'failed') {
        const reason = goalFailurePauseReason(end.event.error);
        await this.agent.goal.pauseActiveGoal({ reason });
        await this.agent.ultrawork.markInterrupted({ reason });
        return end;
      }
      if (end.event.reason === 'filtered') {
        await this.agent.goal.pauseActiveGoal({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
        await this.agent.ultrawork.markInterrupted({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
        return end;
      }
      if (end.blockedByUserPromptHook === true) {
        await this.agent.goal.markBlocked({ reason: 'Blocked by UserPromptSubmit hook' });
        return end;
      }

      // The model decides via UpdateGoal: a cleared record means `complete`;
      // anything non-active means it stopped (blocked / paused). Only a still
      // `active` goal continues to another turn.
      const goal = this.agent.goal.getGoal().goal;
      if (goal === null || goal.status !== 'active') {
        return end;
      }
      // Hard budgets (turn / token / wall-clock, set via the SDK) are a
      // deterministic ceiling: block when reached. `blocked` is resumable.
      if (goal.budget.overBudget) {
        await this.agent.goal.markBlocked({ reason: 'A configured budget was reached' });
        return end;
      }

      // No-progress detector (AC-C1): same WorkGraph/goal progress signature for K turns
      // → inject a reminder so the model changes approach instead of spinning.
      const progressSignature = buildGoalProgressSignature(this.agent);
      const streak = this.agent.goal.noteGoalTurnProgress(progressSignature);
      if (streak >= GOAL_NO_PROGRESS_STREAK_K) {
        this.agent.context.appendSystemReminder(
          [
            '<goal_no_progress>',
            `No material progress for ${streak} consecutive goal turns (threshold K=${GOAL_NO_PROGRESS_STREAK_K}).`,
            `Progress signature: ${progressSignature}`,
            'Change approach: re-read open WorkGraph nodes, run real verification, avoid repeating the same failing tool path.',
            'If truly blocked on external input, call UpdateGoal with `blocked`.',
            '</goal_no_progress>',
          ].join('\n'),
          { kind: 'injection', variant: 'goal_no_progress' },
        );
        this.agent.telemetry.track('goal_no_progress', {
          streak,
          threshold: GOAL_NO_PROGRESS_STREAK_K,
        });
      }

      turnId = this.allocateTurnId();
      turnInput = [{ type: 'text', text: GOAL_CONTINUATION_PROMPT }];
      turnOrigin = GOAL_CONTINUATION_ORIGIN;
    }
  }

  private async markUltraworkInterruptedForTurnEnd(end: TurnEndResult): Promise<void> {
    if (end.event.reason === 'cancelled') {
      await this.agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });
      return;
    }
    if (end.event.reason === 'failed') {
      await this.agent.ultrawork.markInterrupted({ reason: goalFailurePauseReason(end.event.error) });
      return;
    }
    if (end.event.reason === 'filtered') {
      await this.agent.ultrawork.markInterrupted({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
    }
  }

  private async endGoalTurnWithoutModel(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
  ): Promise<TurnEndedEvent> {
    this.agent.usage.beginTurn();
    const startedAt = Date.now();
    this.agent.emitEvent({ type: 'turn.started', turnId, origin });
    this.agent.context.appendUserMessage(input, origin);
    const ended: TurnEndedEvent = {
      type: 'turn.ended',
      turnId,
      reason: 'completed',
      durationMs: Date.now() - startedAt,
    };
    this.agent.usage.endTurn();
    this.agent.fileSnapshots?.commitTurn(String(turnId));
    this.agent.emitEvent(ended);
    return ended;
  }

  /**
   * Runs exactly one logical turn end to end: per-turn bookkeeping, `turn.started`,
   * the prompt + goal reminder, the step loop, and `turn.ended`. Goal-agnostic —
   * the driver layers goal semantics on top. Never throws; abnormal ends are
   * mapped to a `cancelled`/`failed` `turn.ended` and returned.
   */
  private async runOneTurn(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
    standalone: boolean,
  ): Promise<TurnEndResult> {
    this.assistantThinkScrubber.reset();
    const telemetryMode = this.turnTelemetry.telemetryMode();
    this.turnTelemetry.resetForTurn(turnId, telemetryMode);
    this.agent.telemetry.track('turn_started', { mode: telemetryMode });
    this.agent.fullCompaction.resetForTurn();
    this.agent.usage.beginTurn();
    this.agent.emitEvent({ type: 'turn.started', turnId, origin });
    this.agent.context.appendUserMessage(input, origin);

    const startedAt = Date.now();
    let ended: TurnEndedEvent;
    let blockedByUserPromptHook = false;
    let completedStopReason: LoopTurnStopReason | undefined;
    // Emitted after turn.ended (preserving prior ordering), so the error event
    // sits just past the turn.ended boundary that consumers watch for.
    let errorEvent: AgentEvent | undefined;
    try {
      await this.agent.fullCompaction.prepareForTurn(signal);
      const promptHookEnded = await this.applyUserPromptHook(turnId, input, origin, signal, startedAt);
      if (promptHookEnded !== undefined) {
        ended = promptHookEnded.event;
        blockedByUserPromptHook = promptHookEnded.blocked;
      } else {
        const stopReason = await this.runStepLoop(turnId, signal);
        completedStopReason = stopReason;
        const reason: TurnEndReason =
          stopReason === 'aborted' ? 'cancelled' : stopReason === 'filtered' ? 'filtered' : 'completed';
        ended = {
          type: 'turn.ended',
          turnId,
          reason,
          durationMs: Date.now() - startedAt,
          ...(reason === 'cancelled'
            ? { cancelledByUser: isUserCancellation(signal.reason) }
            : {}),
        };
      }
    } catch (error) {
      if (isAbortError(error)) {
        ended = {
          type: 'turn.ended',
          turnId,
          reason: 'cancelled',
          durationMs: Date.now() - startedAt,
          cancelledByUser: isUserCancellation(signal.reason),
        };
      } else {
        const summary = summarizeTurnError(error, turnId);
        void this.agent.hooks?.fireAndForgetTrigger('StopFailure', {
          matcherValue: summary.name,
          inputData: { errorType: summary.name, errorMessage: summary.message },
        });
        ended = { type: 'turn.ended', turnId, reason: 'failed', error: summary, durationMs: Date.now() - startedAt };
        errorEvent = { type: 'error', ...summary };
        if (this.turnTelemetry.shouldTrackApiError(turnId)) {
          const classification = classifyApiError(error, summary);
          const properties: Record<string, TelemetryPropertyValue> = {
            error_type: classification.errorType,
            model: this.agent.config.model,
            retryable: summary.retryable,
            duration_ms: Date.now() - startedAt,
          };
          if (classification.statusCode !== undefined) {
            properties['status_code'] = classification.statusCode;
          }
          const inputTokens = currentTurnInputTokens(this.agent.usage.data().currentTurn);
          if (inputTokens !== undefined) {
            properties['input_tokens'] = inputTokens;
          }
          this.agent.telemetry.track('api_error', properties);
        }
      }
    }
    // A turn that ended with recorded tool calls still awaiting results must
    // close the exchange before turn.ended so later messages are not stranded.
    this.closeAbandonedToolExchange(ended);
    // Emit the terminal turn.ended and (for a standalone turn) release the active
    // turn in the SAME synchronous frame, so the session is observably idle the
    // instant turn.ended fires. A goal drive keeps the active turn across its
    // continuation turns and releases it in `turnWorker` instead (`standalone`
    // is false for those).
    if (this.currentId === turnId) {
      this.agent.usage.endTurn();
    }
    // Seal any pending write/edit captures for this turn so `/rewind` can restore.
    // Commit even on cancelled/failed turns — partial mutations still need a snapshot.
    this.agent.fileSnapshots?.commitTurn(String(turnId));
    // A user interrupt (e.g. Esc) aborts the turn without the normal Stop hook
    // firing, so external tooling that tracks status from hooks would otherwise
    // never see the turn stop. Emit an observation-only Interrupt event for it.
    // Gate on isUserCancellation: a `cancelled` turn can also come from a
    // programmatic abort (e.g. a subagent deadline timeout, which shares this
    // hook engine), and those must not be misreported as a user interrupt.
    if (ended.reason === 'cancelled' && isUserCancellation(signal.reason)) {
      void this.agent.hooks?.fireAndForgetTrigger('Interrupt', {
        inputData: { turnId, reason: 'cancelled' },
      });
    }
    this.agent.emitEvent(ended);
    // Release the active turn in the same frame as turn.ended for a standalone
    // turn, so the session is observably idle the instant turn.ended fires.
    // Exception: if the model turned the goal active during this turn (e.g.
    // CreateGoal), the session is NOT idle — turnWorker is about to drive the
    // goal. Keep the active turn alive (as the already-active goal path does) so
    // those autonomous continuations stay cancelable and exclude concurrent
    // turns; turnWorker releases it after the drive.
    // Keep the launch AbortController alive when provider recovery will run
    // after this turn.ended. Clearing it here made Esc/Ctrl+C no-ops during
    // the recovery sleep (activeTurn was null so abortTurn could not abort).
    if (
      standalone &&
      this.currentId === turnId &&
      this.agent.goal.getGoal().goal?.status !== 'active' &&
      !(ended.reason === 'failed' && isRetryableProviderFailure(ended.error))
    ) {
      this.activeTurn = null;
    }
    if (this.agent.swarmMode.shouldAutoExit && !this.isUltraworkSwarmSession()) {
      this.agent.swarmMode.exit();
    }
    if (errorEvent !== undefined) {
      this.agent.emitEvent(errorEvent);
    }
    await this.recordTurnMemory(turnId, input, ended.reason);
    this.agent.dream?.maybeSchedule();
    if (ended.reason !== 'completed') {
      this.turnTelemetry.trackTurnInterrupted(turnId, this.turnTelemetry.currentStepForTurn(turnId));
    }
    this.turnTelemetry.cleanupTurn(turnId);
    return { event: ended, stopReason: completedStopReason, blockedByUserPromptHook };
  }

  private isUltraworkSwarmSession(): boolean {
    const ultrawork = this.agent.ultrawork;
    if (ultrawork === undefined) return false;
    const run = ultrawork.getRun();
    return ultrawork.isModeEnabled() && run !== null && run.status === 'running';
  }

  private async recordTurnMemory(
    turnId: number,
    input: readonly ContentPart[],
    reason: TurnEndReason,
  ): Promise<void> {
    try {
      await this.agent.memory?.recordTurn({ turnId, input, reason });
    } catch (error) {
      this.agent.log.warn('liora recall turn capture failed', error);
    }
  }

  private async applyUserPromptHook(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<PromptHookEndResult | undefined> {
    if (origin.kind !== 'user') return undefined;
    signal.throwIfAborted();
    const promptHookResults = await this.agent.hooks?.trigger('UserPromptSubmit', {
      matcherValue: input,
      signal,
      inputData: { prompt: input },
    });
    signal.throwIfAborted();
    const blockResult = renderUserPromptHookBlockResult(promptHookResults);
    if (blockResult !== undefined) {
      this.agent.context.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: blockResult.text }],
        toolCalls: [],
        origin: { kind: 'hook_result', event: 'UserPromptSubmit', blocked: true },
      });
      this.agent.emitEvent({
        type: 'hook.result',
        turnId,
        hookEvent: blockResult.event,
        content: blockResult.message,
        blocked: true,
      });
      // The terminal turn.ended is emitted by runOneTurn (synchronously with the
      // activeTurn clear), not here, so the session is idle the moment it fires.
      return {
        event: { type: 'turn.ended', turnId, reason: 'completed', durationMs: Date.now() - startedAt },
        blocked: true,
      };
    }

    const hookResult = renderUserPromptHookResult(promptHookResults);
    if (hookResult === undefined) return undefined;

    this.agent.context.appendUserMessage([{ type: 'text', text: hookResult.text }], {
      kind: 'hook_result',
      event: 'UserPromptSubmit',
    });
    this.agent.emitEvent({
      type: 'hook.result',
      turnId,
      hookEvent: hookResult.event,
      content: hookResult.message,
    });
    return undefined;
  }

  private async runStepLoop(turnId: number, signal: AbortSignal): Promise<LoopTurnStopReason> {
    let stopHookContinuationUsed = false;
    let goalOutcomeMessageContinuationUsed = false;
    const deduper = new ToolCallDeduplicator({ telemetry: this.agent.telemetry });
    await this.agent.mcp?.waitForInitialLoad(signal);
    // Surface the active goal at the start of the turn (append-only; no-op when
    // there is no active goal). Each goal continuation is its own turn, so this
    // re-injects the reminder once per turn rather than per step, preserving prompt caching.
    await this.agent.injection.injectGoal();
    while (true) {
      signal.throwIfAborted();
      const model = this.agent.config.model;
      let stepUsageModel = model;
      const loopControl = this.agent.kimiConfig?.loopControl;
      let stopForGoalBudget = false;
      try {
        const result = await runTurn({
          turnId: String(turnId),
          signal,
          llm: this.agent.llm,
          buildMessages: () => this.agent.context.messages,
          buildMessagesStrict: () => this.agent.context.strictMessages,
          dispatchEvent: this.buildDispatchEvent(turnId),
          tools: this.agent.tools.loopTools,
          log: this.agent.log,
          maxSteps: loopControl?.maxStepsPerTurn,
          maxRetryAttempts: loopControl?.maxRetriesPerStep,
          recordStepUsage: async (usage, info?: RecordStepUsageInfo) => {
            stepUsageModel = info?.model ?? model;
            try {
              const snapshot = await this.agent.goal.recordTokenUsage(grandTotal(usage));
              stopForGoalBudget = snapshot?.budget.overBudget === true;
            } catch (error) {
              this.agent.log.warn('goal token accounting failed', { error });
            }
          },
          hooks: {
            beforeStep: async ({ signal: stepSignal }) => {
              this.flushSteerBuffer();
              this.agent.microCompaction.detect();
              await this.agent.fullCompaction.beforeStep(stepSignal);
              await this.agent.injection.inject();
              deduper.beginStep();
              return;
            },
            afterStep: async ({ usage }) => {
              this.agent.usage.record(stepUsageModel, usage, 'turn');
              this.agent.usage.recordCacheDiagnostics(
                this.agent.tools.loopTools,
                0, // injection count tracked by batch injector
                this.agent.context.history.length,
              );
              await this.agent.fullCompaction.afterStep();
              deduper.endStep();
              return stopForGoalBudget ? { stopTurn: true } : undefined;
            },
            // oxlint-disable-next-line no-loop-func -- stop hook continuation state is scoped to this turn.
            shouldContinueAfterStop: async (ctx) => {
              const { signal } = ctx;
              // 1. Flush any steered user messages.
              if (this.flushSteerBuffer()) return { continue: true };
              signal.throwIfAborted();

              if (this.agent.printDrainAgentTasksOnStop) {
                const remaining = this.agent.printDrainDeadlineMs - Date.now();
                const hasActiveAgentTask = this.agent.background
                  .list(true)
                  .some((task) => task.kind === 'agent');
                if (hasActiveAgentTask && remaining > 0) {
                  await this.agent.background.waitForActiveTasks(
                    (task) => task.kind === 'agent',
                    { timeoutMs: remaining, signal },
                  );
                  this.flushSteerBuffer();
                  return { continue: true };
                }
              }

              // 2. After UpdateGoal marks a goal terminal, ask the model for one
              //    final user-facing outcome message before the turn ends.
              if (
                !goalOutcomeMessageContinuationUsed &&
                isGoalOutcomeReminderOrigin(this.agent.context.history.at(-1)?.origin)
              ) {
                goalOutcomeMessageContinuationUsed = true;
                if (!hasStepBudgetRemaining(loopControl?.maxStepsPerTurn, ctx.stepNumber)) {
                  this.agent.context.popMatchedMessage(isGoalOutcomeReminderOrigin);
                  return { continue: false };
                }
                return { continue: true };
              }

              // 3. The external Stop hook gets exactly one continuation; the cap
              //    is intentionally separate from (and does not cap) goal mode.
              if (!stopHookContinuationUsed) {
                const stopBlock = await this.agent.hooks?.triggerBlock('Stop', {
                  signal,
                  inputData: { stopHookActive: stopHookContinuationUsed },
                });
                signal.throwIfAborted();
                if (stopBlock !== undefined) {
                  stopHookContinuationUsed = true;
                  this.agent.context.appendUserMessage(
                    [{ type: 'text', text: stopBlock.reason }],
                    {
                      kind: 'system_trigger',
                      name: 'stop_hook',
                    },
                  );
                  return { continue: true };
                }
              }

              // 4. Otherwise stop. Goal continuation is no longer driven here:
              //    each goal turn is an ordinary turn, and the goal driver decides
              //    whether to run another after this one ends.
              return { continue: false };
            },
            prepareToolExecution: async (ctx) => {
              const cached = deduper.checkSameStep(
                ctx.toolCall.id,
                ctx.toolCall.name,
                ctx.args,
              );
              if (cached !== null) return { syntheticResult: cached };
              return undefined;
            },
            authorizeToolExecution: async (ctx) => {
              return this.agent.permission.beforeToolCall(ctx);
            },
            finalizeToolResult: async (ctx) => {
              // Resolve dedup BEFORE firing the PostToolUse hook so same-step
              // dups (whose ctx.result is the dedup placeholder) report the
              // original's real outcome, not an empty success.
              const finalResult = await deduper.finalizeResult(
                ctx.toolCall.id,
                ctx.toolCall.name,
                ctx.args,
                ctx.result,
              );
              const { isError, output } = finalResult;
              const event = isError === true ? 'PostToolUseFailure' : 'PostToolUse';
              void this.agent.hooks?.fireAndForgetTrigger(event, {
                matcherValue: ctx.toolCall.name,
                inputData: {
                  toolName: ctx.toolCall.name,
                  toolInput: toolInputRecord(ctx.args),
                  toolCallId: ctx.toolCall.id,
                  error: isError === true ? toKimiErrorPayload(toolOutputText(output)) : undefined,
                  toolOutput: isError === true ? undefined : toolOutputText(output).slice(0, 2000),
                },
              });
              const budgeted = await budgetToolResultForModel({
                homedir: this.agent.homedir,
                toolName: ctx.toolCall.name,
                toolCallId: ctx.toolCall.id,
                result: finalResult,
                contextWindowTokens: this.agent.config.modelCapabilities.max_context_tokens,
              });
              return budgeted;
            },
          },
        });

        return result.stopReason;
      } catch (error) {
        const isContextOverflow =
          error instanceof APIContextOverflowError ||
          (isKimiError(error) && error.code === ErrorCodes.CONTEXT_OVERFLOW);
        const estimatedRequestTokens = isContextOverflow
          ? this.agent.fullCompaction.estimateCurrentRequestTokens()
          : undefined;
        if (
          isContextOverflow ||
          this.agent.fullCompaction.shouldRecoverFromContextOverflow(error, estimatedRequestTokens)
        ) {
          this.agent.fullCompaction.observeContextOverflow(
            estimatedRequestTokens ?? this.agent.fullCompaction.estimateCurrentRequestTokens(),
          );
          await this.agent.fullCompaction.handleOverflowError(signal, error);
          continue; // Retry with compacted context
        }
        if (isMaxStepsExceededError(error)) {
          this.agent.log.warn('turn hit max steps', {
            turnId,
            steps: this.turnTelemetry.currentStepForTurn(turnId),
            limit: isKimiError(error) ? error.details?.['maxSteps'] : undefined,
          });
        } else {
          this.agent.log.error('turn failed', { turnId, error });
        }
        throw error;
      }
    }
  }

  private closeAbandonedToolExchange(ended: TurnEndedEvent): void {
    try {
      const closed = this.agent.context.closeAbandonedToolExchange(
        abandonedToolResultOutput(ended),
      );
      if (closed === 0) return;
      this.agent.log.warn('closed abandoned tool exchange at turn end', {
        turnId: ended.turnId,
        reason: ended.reason,
        closed,
      });
      this.agent.telemetry.track('tool_exchange_abandoned', {
        reason: ended.reason,
        closed,
      });
    } catch (error) {
      this.agent.log.warn('failed to close abandoned tool exchange', { error });
    }
  }

  private buildDispatchEvent(turnId: number) {
    return createLoopEventDispatcher({
      appendTranscriptRecord: async (event: LoopRecordedEvent) => {
        this.agent.context.appendLoopEvent(event);
        // A tool intent record must be durable (fsync'd) BEFORE the tool runs,
        // so a crash mid-execution leaves proof that the side effect was
        // attempted. The loop awaits this dispatch before starting execution,
        // so flushing here establishes the durability boundary without
        // blocking read-only tool calls.
        if (event.type === 'tool.intend') {
          await this.agent.records.flush();
        }
      },
      emitLiveEvent: (event: LoopEvent) => {
        this.noteFirstRequestEvent(event);
        this.turnTelemetry.trackLoopTelemetry(event, turnId);
        const mapped = this.mapLiveLoopEvent(event, turnId);
        if (mapped !== undefined) this.agent.emitEvent(mapped);
      },
    });
  }

  private mapLiveLoopEvent(event: LoopEvent, turnId: number): AgentEvent | undefined {
    if (event.type === 'text.delta') {
      const scrubbed = this.assistantThinkScrubber.feed(event.delta);
      if (scrubbed.length === 0) return undefined;
      return {
        type: 'assistant.delta',
        turnId,
        delta: scrubbed,
      };
    }
    return mapLoopEvent(event, turnId);
  }

  private noteFirstRequestEvent(event: LoopEvent): void {
    switch (event.type) {
      case 'step.end':
      case 'content.part':
      case 'tool.call':
      case 'text.delta':
      case 'thinking.delta':
      case 'tool.call.delta': {
        const active = this.activeTurn;
        if (active === null || active === 'resuming') return;
        active.firstRequest.resolve();
        return;
      }
      default:
        return;
    }
  }
}
