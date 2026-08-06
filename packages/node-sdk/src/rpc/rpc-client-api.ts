/**
 * Reverse-RPC surface the core calls back into the SDK — extracted from rpc.ts.
 */

import type {
  ApprovalRequest,
  ApprovalResponse,
  CredentialRequest,
  CredentialResponse,
  Event,
  QuestionRequest,
  QuestionResult,
  RPCCallOptions,
  SDKAPI,
  ToolCallRequest,
  ToolCallResponse,
} from '@superliora/agent-core';

import type { SDKRpcClientBase } from './rpc';

export class ClientAPI implements SDKAPI {
  constructor(readonly client: SDKRpcClientBase) {}

  emitEvent(event: Event): void {
    this.client.receiveEvent(event);
  }

  requestApproval(
    request: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    return this.client.requestApproval(request);
  }

  requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
    options?: RPCCallOptions,
  ): Promise<QuestionResult> {
    return this.client.requestQuestion(request, options);
  }

  requestCredential(
    request: CredentialRequest & { sessionId: string; agentId: string },
  ): Promise<CredentialResponse | null> {
    return this.client.requestCredential(request);
  }

  toolCall(request: ToolCallRequest): Promise<ToolCallResponse> {
    return this.client.toolCall(request);
  }
}
