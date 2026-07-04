import type {
  ApprovalRequest,
  ApprovalResponse,
  QuestionRequest,
  QuestionResult,
} from '@superliora/agent-core';

// Event union plus shared fields/payloads used across event families.
export type { LioraErrorPayload, Event } from '@superliora/agent-core';

export { MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE } from '@superliora/agent-core';

// Session lifecycle/status events and their status payload.
export type {
  AgentStatusUpdatedEvent,
  SessionMetaUpdatedEvent,
  GoalUpdatedEvent,
  SkillActivatedEvent,
  PluginCommandActivatedEvent,
  ProviderRouteCandidateStatus,
  ProviderRouteFailureKind,
  ProviderRouteStatus,
  ErrorEvent,
  WarningEvent,
  UsageStatus,
} from '@superliora/agent-core';

// Turn and step lifecycle events plus the turn-ending reason enum.
export type {
  TurnStartedEvent,
  TurnEndedEvent,
  TurnStepStartedEvent,
  TurnStepCompletedEvent,
  TurnStepRetryingEvent,
  TurnStepInterruptedEvent,
  TurnEndReason,
} from '@superliora/agent-core';

// Streaming content and hook-result events.
export type {
  AssistantDeltaEvent,
  HookResultEvent,
  ThinkingDeltaEvent,
} from '@superliora/agent-core';

// Tool-call events and incremental progress payloads.
export type {
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolProgressEvent,
  ToolResultEvent,
  ToolCallRequest,
  ToolCallResponse,
  ToolUpdate,
  McpOAuthAuthorizationUrlUpdateData,
} from '@superliora/agent-core';

// MCP tool-list and server status events.
export type {
  ToolListUpdatedEvent,
  ToolListUpdatedReason,
  McpServerStatusEvent,
  McpServerStatusPayload,
} from '@superliora/agent-core';

// Approval reverse-RPC request and response/display payloads.
export type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalScope,
  ApprovalResponse,
  ToolInputDisplay,
} from '@superliora/agent-core';

// Question reverse-RPC request and answer payloads.
export type {
  QuestionRequest,
  QuestionItem,
  QuestionOption,
  QuestionAnswerMethod,
  QuestionAnswers,
  QuestionResponse,
  QuestionResult,
} from '@superliora/agent-core';

// Subagent lifecycle events.
export type {
  SubagentSpawnedEvent,
  SubagentStartedEvent,
  SubagentSuspendedEvent,
  SubagentCompletedEvent,
  SubagentFailedEvent,
} from '@superliora/agent-core';

// Compaction lifecycle events and compaction result payload.
export type {
  CompactionStartedEvent,
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionResult,
} from '@superliora/agent-core';

// Background task lifecycle events emitted by the BPM. Covers both
// bash (`bash-*`) and agent (`agent-*`) tasks under one wire format.
export type {
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@superliora/agent-core';

export type { CronFiredEvent } from '@superliora/agent-core';

// Ultrawork lifecycle events for theatre-style orchestration UIs.
export type {
  UltraworkStageChangedEvent,
  UltraworkResearchStartedEvent,
  UltraworkResearchProviderSelectedEvent,
  UltraworkResearchFindingVerifiedEvent,
  UltraworkTeamStaffedEvent,
  UltraworkTaskAssignedEvent,
  UltraworkCouncilDecisionEvent,
  UltraworkVerificationCompletedEvent,
  UltraworkKnowledgePromotedEvent,
} from '@superliora/agent-core';

export type MaybePromise<T> = T | Promise<T>;

export type ApprovalHandler = (request: ApprovalRequest) => MaybePromise<ApprovalResponse>;

export type QuestionHandler = (request: QuestionRequest) => MaybePromise<QuestionResult>;
