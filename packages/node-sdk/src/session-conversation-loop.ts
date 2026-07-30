/**
 * Conversation loop RPC delegation for Session — extracted from session.ts.
 */

import { SessionCore } from '#/session-core';

type ConversationLoopRecord = {
  readonly id: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly maxIterations: number;
  readonly expiresAt?: number | undefined;
  readonly status: 'active' | 'paused' | 'expired' | 'completed' | 'stopped';
  readonly iterations: number;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  readonly stopReason?: string | undefined;
};

export abstract class SessionConversationLoopMixin extends SessionCore {
  async startConversationLoop(options: {
    prompt: string;
    intervalMs?: number | undefined;
    maxIterations?: number | undefined;
    expiresAt?: number | undefined;
  }): Promise<ConversationLoopRecord> {
    this.ensureOpen();
    return this.rpc.startConversationLoop({
      sessionId: this.id,
      prompt: options.prompt,
      intervalMs: options.intervalMs,
      maxIterations: options.maxIterations,
      expiresAt: options.expiresAt,
    });
  }

  async stopConversationLoop(loopId?: string): Promise<ConversationLoopRecord | undefined> {
    this.ensureOpen();
    return this.rpc.stopConversationLoop({
      sessionId: this.id,
      ...(loopId !== undefined ? { loopId } : {}),
    });
  }

  async listConversationLoops(): Promise<readonly ConversationLoopRecord[]> {
    this.ensureOpen();
    return this.rpc.listConversationLoops({ sessionId: this.id });
  }
}
