import { createControlledPromise } from '@antfu/utils';
import type { ContentPart } from '@superliora/kosong';
import { basename } from 'pathe';

import type { Agent } from '..';
import { makeErrorPayload } from '#/errors/index';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';
import type { TurnCancelSource } from '../../rpc/core-api';
import type { TurnEndedEvent } from '../../rpc/events';
import { abortable, isUserCancellation, userCancellationReason } from '../../utils/abort';
import { StreamingThinkScrubber } from '../../utils/think-scrubber';
import { USER_PROMPT_ORIGIN, type PromptOrigin } from '../context';
import { shouldEnterProviderRecovery } from '../provider-failover';
import {
  TurnTelemetry,
} from './telemetry';
import {
  recoverFromProviderFailure,
} from './error-recovery';
import {
  GOAL_CONTINUATION_ORIGIN,
  GOAL_CONTINUATION_PROMPT,
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
} from './goal-driver';
import {
  driveGoalTurnLoop,
  endGoalTurnWithoutModel,
} from './goal-loop';
import { frameInterruptContent, frameSteerContent, shouldFrameSteer } from './interjection';
import { runOneTurnFlow } from './run-one';
import type { ActiveTurn, TurnEndResult } from './types';

export type { TurnEndResult };
export {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
};

interface BufferedSteer {
  readonly input: readonly ContentPart[];
  readonly origin: PromptOrigin;
}

/**
 * How long a new turn waits for a cancelled turn's worker to stop writing to
 * the context. The loop already caps aborted tool calls with a 2s grace
 * timeout, so this only has to cover the teardown that follows.
 */
const CANCELLED_WORKER_DRAIN_MS = 5_000;

export class TurnFlow {
  private steerBuffer: BufferedSteer[] = [];
  private turnId = -1;
  private activeTurn: 'resuming' | ActiveTurn | null = null;
  /** Next real user prompt after a user cancel is framed as an interrupt. */
  private pendingInterruptFrame = false;
  /** Workers of cancelled turns that may still be appending to the context. */
  private cancelledWorker: Promise<unknown> | null = null;
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

    const turnId = this.allocateTurnId();
    const controller = new AbortController();
    const framed = this.consumeInterruptFrame(input, origin);
    const promise = this.turnWorker(turnId, framed, origin, controller.signal);
    const firstRequest = createControlledPromise<void>();
    this.activeTurn = {
      turnId,
      controller,
      promise,
      firstRequest,
    };

    void firstRequest.catch(() => undefined);
    void promise.then(
      () =>{  firstRequest.resolve(); },
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
      return;
    }
    const cancelReason = reason ?? userCancellationReason();
    if (isUserCancellation(cancelReason)) {
      this.pendingInterruptFrame = true;
    }
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
      this.activeTurn?.controller.abort(reason);
      // Freeing the slot here keeps cancel instant, but the aborted worker is
      // still draining: it has to pair every open `tool.call` with a result and
      // close abandoned exchanges. Hand the promise to the next turn so its
      // first user message is not appended in the middle of that. Cancelling
      // twice before the next turn starts must not drop the earlier worker.
      const aborted = this.activeTurn?.promise;
      if (aborted !== undefined) {
        const pending = this.cancelledWorker;
        this.cancelledWorker =
          pending === null ? aborted : Promise.allSettled([pending, aborted]);
      }
    }
    this.activeTurn = null;
  }

  /**
   * Wait for a cancelled turn's worker to finish writing to the shared context.
   * Bounded: a tool that ignores its abort signal must delay the next turn, not
   * wedge the session.
   */
  private async awaitCancelledWorker(): Promise<void> {
    const pending = this.cancelledWorker;
    if (pending === null) return;
    this.cancelledWorker = null;
    const timer = createControlledPromise<'timeout'>();
    const handle = setTimeout(() => { timer.resolve('timeout'); }, CANCELLED_WORKER_DRAIN_MS);
    try {
      const outcome = await Promise.race([
        pending.then(() => 'settled' as const, () => 'settled' as const),
        timer,
      ]);
      if (outcome === 'timeout') {
        this.agent.log?.warn('previous turn still draining; starting the next turn anyway', {
          drainMs: CANCELLED_WORKER_DRAIN_MS,
        });
      }
    } finally {
      clearTimeout(handle);
    }
  }

  /**
   * Release the active-turn slot before `turn.ended` is emitted so a prompt
   * that races the end event starts the next turn instead of being rejected
   * with `turn.agent_busy`. Mirrors the post-turn clear condition in
   * `runOneTurn`; the slot must stay held for goal continuations and
   * retryable-failure recovery, which keep running in the same worker.
   */
  private releaseActiveTurnIfFinished(
    turnId: number,
    ended: TurnEndedEvent,
    signal: AbortSignal,
    standalone: boolean,
  ): void {
    if (!standalone) return;
    if (this.currentId !== turnId) return;
    if (this.agent.goal.getGoal().goal?.status === 'active') return;
    if (ended.reason === 'failed' && shouldEnterProviderRecovery(this.agent, ended.error)) return;
    this.releaseActiveTurnIfOwner(signal);
  }

  private releaseActiveTurnIfOwner(signal: AbortSignal): void {
    if (
      this.activeTurn !== null &&
      this.activeTurn !== 'resuming' &&
      this.activeTurn.controller.signal === signal
    ) {
      this.activeTurn = null;
    }
  }

  private consumeInterruptFrame(
    input: readonly ContentPart[],
    origin: PromptOrigin,
  ): readonly ContentPart[] {
    if (!this.pendingInterruptFrame || !shouldFrameSteer(origin)) return input;
    this.pendingInterruptFrame = false;
    return frameInterruptContent(input, origin);
  }

  private flushSteerBuffer(): boolean {
    const steers = this.steerBuffer;
    if (steers.length === 0) return false;
    for (const steer of steers) {
      this.agent.context.appendUserMessage(
        frameSteerContent(steer.input, steer.origin),
        steer.origin,
      );
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

  private async turnWorker(
    firstTurnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    await this.awaitCancelledWorker();
    const ownsActiveTurn = (): boolean =>
      this.activeTurn !== null &&
      this.activeTurn !== 'resuming' &&
      this.activeTurn.controller.signal === signal;
    try {
      // Conductor never runs the goal continuation loop on the main lane —
      // `/goal` is offloaded to Goal Desk + goal-driver Jobs.
      const conductorMain =
        this.agent.type === 'main' &&
        this.agent.config.profileName === SOVEREIGN_CONDUCTOR_PROFILE_NAME;
      const initialGoalStatus = this.agent.goal.getGoal().goal?.status;
      if (initialGoalStatus === 'active' && !conductorMain) {
        return await this.driveGoal(firstTurnId, input, origin, signal);
      }
      const contextBaselineLength = this.agent.context.history.length;
      let end = await this.runOneTurn(firstTurnId, input, origin, signal, true);
      if (end.event.reason === 'failed' && shouldEnterProviderRecovery(this.agent, end.event.error)) {
        end = await recoverFromProviderFailure(
          { agent: this.agent, runOneTurn: (tid, inp, org, sig, sa) => this.runOneTurn(tid, inp, org, sig, sa) },
          firstTurnId,
          input,
          origin,
          signal,
          end,
          contextBaselineLength,
        );
      }
      const goalBecameActive = this.agent.goal.getGoal().goal?.status === 'active';
      if (
        !conductorMain &&
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
      return end;
    } finally {
      if (ownsActiveTurn()) {
        this.activeTurn = null;
      }
    }
  }

  private driveGoal(
    firstTurnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    return driveGoalTurnLoop(
      {
        agent: this.agent,
        runOneTurn: (turnId, turnInput, turnOrigin, turnSignal, standalone) =>
          this.runOneTurn(turnId, turnInput, turnOrigin, turnSignal, standalone),
        allocateTurnId: () => this.allocateTurnId(),
        endGoalTurnWithoutModel: (turnId, turnInput, turnOrigin) =>
          endGoalTurnWithoutModel(this.agent, turnId, turnInput, turnOrigin, () =>
            this.releaseActiveTurnIfOwner(signal),
          ),
      },
      firstTurnId,
      input,
      origin,
      signal,
    );
  }

  private async runOneTurn(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
    standalone: boolean,
  ): Promise<TurnEndResult> {
    const result = await runOneTurnFlow(
      {
        agent: this.agent,
        turnTelemetry: this.turnTelemetry,
        assistantThinkScrubber: this.assistantThinkScrubber,
        flushSteerBuffer: () => this.flushSteerBuffer(),
        getActiveTurn: () => this.activeTurn,
        releaseActiveTurn: (ended) =>
          this.releaseActiveTurnIfFinished(turnId, ended, signal, standalone),
      },
      turnId,
      input,
      origin,
      signal,
    );
    if (
      standalone &&
      this.currentId === turnId &&
      this.agent.goal.getGoal().goal?.status !== 'active' &&
      !(
        result.event.reason === 'failed' &&
        shouldEnterProviderRecovery(this.agent, result.event.error)
      )
    ) {
      this.activeTurn = null;
    }
    return result;
  }
}
