/**
 * Event/interaction-handler bridge for `SDKRpcClientBase` — extracted from
 * `rpc.ts`.
 *
 * Holds the per-process event listener set plus the per-session approval,
 * question, and credential handler maps, and answers the reverse-RPC calls
 * the core makes back into the SDK (`requestApproval`, `requestQuestion`,
 * `requestCredential`) by dispatching to whichever handler is registered for
 * that session. None of this depends on the transport (in-process vs remote);
 * `SDKRpcClientBase` owns one instance and forwards its public methods to it.
 */

import {
  ErrorCodes,
  type ApprovalRequest,
  type ApprovalResponse,
  type CredentialRequest,
  type CredentialResponse,
  type Event,
  type QuestionRequest,
  type QuestionResult,
} from '@superliora/agent-core';

import type {
  ApprovalHandler,
  CredentialHandler,
  InteractionHandlerOptions,
  QuestionHandler,
} from '#/session/events';
import { invokeInteractionHandler } from '#/rpc/rpc-helpers';
import type { Unsubscribe } from '#/session/types';

export interface QuestionAttention {
  readonly sessionId: string;
  readonly agentId: string;
  readonly attention: 'question' | 'error' | undefined;
}

export class SdkEventBridge {
  private readonly questionStates = new Map<string, { sessionId: string; pending: number; error: boolean }>();
  private readonly questionAttentionListeners = new Set<(change: QuestionAttention) => void>();
  private readonly eventListeners = new Set<(event: Event) => void>();
  private readonly approvalHandlers = new Map<string, ApprovalHandler>();
  private readonly questionHandlers = new Map<string, QuestionHandler>();
  private readonly credentialHandlers = new Map<string, CredentialHandler>();

  onEvent(listener: (event: Event) => void): Unsubscribe {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onQuestionAttention(listener: (change: QuestionAttention) => void): Unsubscribe {
    this.questionAttentionListeners.add(listener);
    return () => { this.questionAttentionListeners.delete(listener); };
  }

  private notifyQuestionAttention(change: QuestionAttention): void {
    for (const listener of this.questionAttentionListeners) {
      try { listener(change); } catch { /* Visibility observers cannot affect answers. */ }
    }
  }

  receiveEvent(event: Event): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  setApprovalHandler(sessionId: string, handler: ApprovalHandler | undefined): void {
    if (handler === undefined) {
      this.approvalHandlers.delete(sessionId);
      return;
    }
    this.approvalHandlers.set(sessionId, handler);
  }

  setQuestionHandler(sessionId: string, handler: QuestionHandler | undefined): void {
    if (handler === undefined) {
      this.questionHandlers.delete(sessionId);
      return;
    }
    this.questionHandlers.set(sessionId, handler);
  }

  setCredentialHandler(sessionId: string, handler: CredentialHandler | undefined): void {
    if (handler === undefined) {
      this.credentialHandlers.delete(sessionId);
      return;
    }
    this.credentialHandlers.set(sessionId, handler);
  }

  clearSessionHandlers(sessionId: string): void {
    this.approvalHandlers.delete(sessionId);
    this.questionHandlers.delete(sessionId);
    // Delete first (invalidating late completions), then notify: a listener that
    // reopens a question cannot extend this loop.
    const cleared: string[] = [];
    for (const [key, state] of this.questionStates) {
      if (state.sessionId !== sessionId) continue;
      this.questionStates.delete(key);
      cleared.push(key);
    }
    for (const key of cleared) {
      const [, agentId] = JSON.parse(key) as [string, string];
      this.notifyQuestionAttention({ sessionId, agentId, attention: undefined });
    }
    this.credentialHandlers.delete(sessionId);
  }

  async requestApproval(
    request: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    return invokeInteractionHandler(this.approvalHandlers.get(request.sessionId), request, {
      errorCode: ErrorCodes.SESSION_APPROVAL_HANDLER_ERROR,
      notRegisteredResult: { decision: 'cancelled', feedback: 'No approval handler registered.' },
      errorResult: { decision: 'cancelled', feedback: 'Approval handler failed.' },
      emitEvent: (event) => {
        this.receiveEvent(event);
      },
    });
  }

  async requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
    options?: InteractionHandlerOptions,
    fallback?: QuestionHandler,
  ): Promise<QuestionResult> {
    const handler = this.questionHandlers.get(request.sessionId) ?? fallback;
    if (handler === undefined) return null;
    const scope = { sessionId: request.sessionId, agentId: request.agentId };
    const key = JSON.stringify([request.sessionId, request.agentId]);
    const state = this.questionStates.get(key) ?? { sessionId: request.sessionId, pending: 0, error: false };
    if (state.pending === 0) state.error = false;
    state.pending++;
    this.questionStates.set(key, state);
    this.notifyQuestionAttention({ ...scope, attention: state.error ? 'error' : 'question' });
    try {
      return await invokeInteractionHandler(handler, request, {
        errorCode: ErrorCodes.SESSION_QUESTION_HANDLER_ERROR,
        notRegisteredResult: null,
        errorResult: null,
        signal: options?.signal,
        emitEvent: (event) => {
          state.error = true;
          this.receiveEvent(event);
          if (this.questionStates.get(key) === state) this.notifyQuestionAttention({ ...scope, attention: 'error' });
        },
      });
    } finally {
      state.pending--;
      // A cleared session already published its final attention; stay silent.
      if (this.questionStates.get(key) === state) {
        const attention = state.error ? 'error' : state.pending > 0 ? 'question' : undefined;
        this.notifyQuestionAttention({ ...scope, attention });
        if (attention === undefined) this.questionStates.delete(key);
      }
    }
  }

  async requestCredential(
    request: CredentialRequest & { sessionId: string; agentId: string },
  ): Promise<CredentialResponse | null> {
    return invokeInteractionHandler(this.credentialHandlers.get(request.sessionId), request, {
      errorCode: ErrorCodes.SESSION_CREDENTIAL_HANDLER_ERROR,
      notRegisteredResult: null,
      errorResult: null,
      emitEvent: (event) => {
        this.receiveEvent(event);
      },
    });
  }
}
