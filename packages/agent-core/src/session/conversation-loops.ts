/**
 * Conversation loop management — extracted from Session class.
 *
 * Manages repeating prompt loops that fire on an interval within a session.
 * Each loop prompts the main agent when its interval elapses.
 */

import { ErrorCodes, LioraError } from '#/errors/index';
import {
  createConversationLoop,
  type ConversationLoopController,
  type ConversationLoopState,
  DEFAULT_LOOP_INTERVAL_MS,
  DEFAULT_LOOP_MAX_ITERATIONS,
} from '../agent/conversation-loop';

export interface ConversationLoopStartOptions {
  readonly prompt: string;
  readonly intervalMs?: number | undefined;
  readonly maxIterations?: number | undefined;
  readonly expiresAt?: number | undefined;
}

export class ConversationLoopManager {
  private readonly loops = new Map<string, ConversationLoopController>();
  private seq = 0;

  constructor(
    private readonly promptAgent: (prompt: string) => void,
  ) {}

  start(options: ConversationLoopStartOptions): ConversationLoopState {
    const prompt = options.prompt.trim();
    if (prompt.length === 0) {
      throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, 'Conversation loop prompt cannot be empty');
    }
    const id = `loop-${++this.seq}`;
    const controller = createConversationLoop(id, {
      prompt,
      intervalMs: options.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS,
      maxIterations: options.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS,
      expiresAt: options.expiresAt,
    });
    this.loops.set(id, controller);
    return controller.getState();
  }

  stop(loopId?: string): ConversationLoopState | undefined {
    if (loopId !== undefined) {
      const controller = this.loops.get(loopId);
      if (controller === undefined) return undefined;
      return controller.stop('user_stop');
    }
    // Stop the most recently created still-active/paused loop.
    let last: ConversationLoopController | undefined;
    for (const controller of this.loops.values()) {
      const status = controller.getState().status;
      if (status === 'active' || status === 'paused') last = controller;
    }
    return last?.stop('user_stop');
  }

  list(): readonly ConversationLoopState[] {
    return Array.from(this.loops.values()).map((c) => c.getState());
  }

  /** Evaluate and fire due conversation loops by prompting the main agent. */
  tick(): readonly ConversationLoopState[] {
    const fired: ConversationLoopState[] = [];
    for (const controller of this.loops.values()) {
      const result = controller.tick();
      if (!result.shouldFire) continue;
      this.promptAgent(result.state.config.prompt);
      fired.push(result.state);
    }
    return fired;
  }
}
