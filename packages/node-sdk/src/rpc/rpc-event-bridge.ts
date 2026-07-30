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

import type { ApprovalHandler, CredentialHandler, QuestionHandler } from '#/session/events';
import { invokeInteractionHandler } from '#/rpc/rpc-helpers';
import type { Unsubscribe } from '#/session/types';

export class SdkEventBridge {
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
  ): Promise<QuestionResult> {
    return invokeInteractionHandler(this.questionHandlers.get(request.sessionId), request, {
      errorCode: ErrorCodes.SESSION_QUESTION_HANDLER_ERROR,
      notRegisteredResult: null,
      errorResult: null,
      emitEvent: (event) => {
        this.receiveEvent(event);
      },
    });
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
