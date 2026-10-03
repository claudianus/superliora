import { createControlledPromise } from '@antfu/utils';
import type { ContentPart } from '@superliora/kosong';
import { basename } from 'pathe';

import type { Agent } from '..';
import { makeErrorPayload } from '#/errors/index';
import type { TurnCancelSource } from '../../rpc/core-api';
import { isUserCancellation, userCancellationReason } from '../../utils/abort';
import { USER_PROMPT_ORIGIN, type PromptOrigin } from '../context';
import {
  TurnTelemetry,
} from './telemetry';
import { runOneTurnFlow } from './run-one';
import type { ActiveTurn, TurnEndResult } from './types';

export type { TurnEndResult };

interface BufferedSteer {
  readonly input: readonly ContentPart[];
  readonly origin: PromptOrigin;
}


export class TurnFlow {
  private steerBuffer: BufferedSteer[] = [];
  private turnId = -1;
  private activeTurn: 'resuming' | ActiveTurn | null = null;
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
    const promise = this.turnWorker(turnId, input, origin, controller.signal);
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
    if (this.agent.records.restoring) return;
    this.agent.records.logRecord({ type: 'turn.cancel', turnId, source });
    if (turnId !== undefined && turnId !== this.currentId) {
      return;
    }
    const cancelReason = reason ?? userCancellationReason();
    this.abortTurn(cancelReason);
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
    if (signal === undefined) return active.promise;

    const turnId = this.currentId;
    const onAbort = (): void => {
      this.agent.turn.cancel(turnId, signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    return active.promise.finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  }

  waitForTurnFirstRequest(): Promise<void> {
    return this.ensureActiveTurn().firstRequest;
  }

  private abortTurn(reason: unknown): void {
    if (this.activeTurn === 'resuming') {
      this.activeTurn = null;
      return;
    }
    // Hold ownership until tool execution and transcript teardown settle.
    this.activeTurn?.controller.abort(reason);
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

  private async turnWorker(
    firstTurnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    try {
      return await this.runOneTurn(firstTurnId, input, origin, signal);
    } finally {
      this.releaseActiveTurnIfOwner(signal);
      // A steer may arrive after the loop consumed its terminal-boundary input
      // but before this worker releases ownership. Honor that real input.
      if (!signal.aborted && this.activeTurn === null && !this.agent.fullCompaction.isCompacting) {
        const next = this.steerBuffer.shift();
        if (next !== undefined) this.launch(next.input, next.origin);
      }
    }
  }

  private async runOneTurn(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
  ): Promise<TurnEndResult> {
    const result = await runOneTurnFlow(
      {
        agent: this.agent,
        turnTelemetry: this.turnTelemetry,
        flushSteerBuffer: () => this.flushSteerBuffer(),
        getActiveTurn: () => this.activeTurn,
        releaseActiveTurn: () => {
          if (this.currentId === turnId) this.releaseActiveTurnIfOwner(signal);
        },
      },
      turnId,
      input,
      origin,
      signal,
    );
    return result;
  }
}
