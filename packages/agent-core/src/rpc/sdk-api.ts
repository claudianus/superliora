
import type { RPCMethods } from './client';
import type { AgentEvent, ToolInputDisplay } from './events';
import type { WithAgentId, WithSessionId } from './types';

export type ApprovalDecision = 'approved' | 'rejected' | 'cancelled';
export type ApprovalScope = 'session';

export interface ApprovalResponse {
  readonly decision: ApprovalDecision;
  readonly scope?: ApprovalScope | undefined;
  readonly feedback?: string | undefined;
}

export interface ApprovalRequest {
  readonly turnId?: number | undefined;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly action: string;
  readonly display: ToolInputDisplay;
}

export interface QuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface QuestionItem {
  readonly question: string;
  readonly header?: string;
  readonly body?: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect?: boolean;
  readonly otherLabel?: string;
  readonly otherDescription?: string;
}

export type QuestionAnswerMethod = 'enter' | 'space' | 'number_key' | 'auto';
export type QuestionAnswers = Record<string, string | true>;

export interface QuestionResponse {
  readonly answers: QuestionAnswers;
  readonly method?: QuestionAnswerMethod | undefined;
}

export type QuestionResult = null | QuestionAnswers | QuestionResponse;

export interface CredentialRequest {
  readonly id: string;
  readonly title: string;
  readonly subtitleLines?: readonly string[] | undefined;
  readonly toolCallId?: string | undefined;
}

export interface CredentialResponse {
  readonly value?: string | undefined;
}

export interface QuestionRequest {
  readonly turnId?: number;
  readonly toolCallId?: string;
  readonly questions: readonly QuestionItem[];
}


export interface SDKAgentAPI {
  emitEvent: (event: AgentEvent) => void;
  requestApproval: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  requestQuestion: (request: QuestionRequest) => Promise<QuestionResult>;
  requestCredential: (request: CredentialRequest) => Promise<CredentialResponse | null>;
}
export type SDKAgentRPC = RPCMethods<SDKAgentAPI>;

export type SDKSessionAPI = WithAgentId<SDKAgentAPI>;
export type SDKSessionRPC = RPCMethods<SDKSessionAPI>;

export type SDKAPI = WithSessionId<SDKSessionAPI>;
export type SDKRPC = RPCMethods<SDKAPI>;
