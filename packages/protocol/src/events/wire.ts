import { z } from 'zod';

import { agentStatusUpdatedEventSchema, type AgentStatusUpdatedEvent } from './agent';
import {
  backgroundTaskStartedEventSchema,
  backgroundTaskTerminatedEventSchema,
  type BackgroundTaskStartedEvent,
  type BackgroundTaskTerminatedEvent,
} from './background';
import {
  compactionBlockedEventSchema,
  compactionCancelledEventSchema,
  compactionCompletedEventSchema,
  compactionProgressEventSchema,
  compactionStartedEventSchema,
  type CompactionBlockedEvent,
  type CompactionCancelledEvent,
  type CompactionCompletedEvent,
  type CompactionProgressEvent,
  type CompactionStartedEvent,
} from './compaction';
import { errorEventSchema, warningEventSchema, type ErrorEvent, type WarningEvent } from './common';
import {
  runtimeDegradedEventSchema,
  type RuntimeDegradedEvent,
} from './runtime';
import { goalUpdatedEventSchema, type GoalUpdatedEvent } from './goal';
import {
  jobInboxEventSchema,
  jobUpdatedEventSchema,
  type JobInboxEvent,
  type JobUpdatedEvent,
} from './job';
import {
  cronFiredEventSchema,
  pluginCommandActivatedEventSchema,
  skillActivatedEventSchema,
  type CronFiredEvent,
  type PluginCommandActivatedEvent,
  type SkillActivatedEvent,
} from './origin';
import {
  configChangedEventSchema,
  modelCatalogChangedEventSchema,
  sessionCreatedEventSchema,
  sessionMetaUpdatedEventSchema,
  sessionStatusChangedEventSchema,
  workspaceCreatedEventSchema,
  workspaceDeletedEventSchema,
  workspaceUpdatedEventSchema,
  type ConfigChangedEvent,
  type ModelCatalogChangedEvent,
  type SessionCreatedEvent,
  type SessionMetaUpdatedEvent,
  type SessionStatusChangedEvent,
  type WorkspaceCreatedEvent,
  type WorkspaceDeletedEvent,
  type WorkspaceUpdatedEvent,
} from './session';
import {
  subagentCompletedEventSchema,
  subagentFailedEventSchema,
  subagentProgressEventSchema,
  subagentSpawnedEventSchema,
  subagentStalledEventSchema,
  subagentStartedEventSchema,
  subagentSuspendedEventSchema,
  subagentTodoUpdatedEventSchema,
  subagentToolCallEventSchema,
  subagentToolResultEventSchema,
  type SubagentCompletedEvent,
  type SubagentFailedEvent,
  type SubagentProgressEvent,
  type SubagentSpawnedEvent,
  type SubagentStalledEvent,
  type SubagentStartedEvent,
  type SubagentSuspendedEvent,
  type SubagentTodoUpdatedEvent,
  type SubagentToolCallEvent,
  type SubagentToolResultEvent,
} from './subagent';
import {
  mcpServerStatusEventSchema,
  shellOutputEventSchema,
  shellStartedEventSchema,
  toolCallDeltaEventSchema,
  toolCallStartedEventSchema,
  toolListUpdatedEventSchema,
  toolProgressEventSchema,
  toolResultEventSchema,
  toolsUpdateStoreEventSchema,
  type McpServerStatusEvent,
  type ShellOutputEvent,
  type ShellStartedEvent,
  type ToolCallDeltaEvent,
  type ToolCallStartedEvent,
  type ToolListUpdatedEvent,
  type ToolProgressEvent,
  type ToolResultEvent,
  type ToolsUpdateStoreEvent,
} from './tool';
import {
  assistantDeltaEventSchema,
  hookResultEventSchema,
  promptSubmittedEventSchema,
  thinkingDeltaEventSchema,
  turnEndedEventSchema,
  turnStartedEventSchema,
  turnStepCompletedEventSchema,
  turnStepInterruptedEventSchema,
  turnStepRetryingEventSchema,
  turnStepStartedEventSchema,
  type AssistantDeltaEvent,
  type HookResultEvent,
  type PromptSubmittedEvent,
  type ThinkingDeltaEvent,
  type TurnEndedEvent,
  type TurnStartedEvent,
  type TurnStepCompletedEvent,
  type TurnStepInterruptedEvent,
  type TurnStepRetryingEvent,
  type TurnStepStartedEvent,
} from './turn';
import { normalizeMissionOrFleetUltraworkEventAlias } from './fleet-alias';
import {
  ultraworkCollaborationDebateEventSchema,
  ultraworkCollaborationMentionEventSchema,
  ultraworkCollaborationMessageEventSchema,
  ultraworkCollaborationSteerEventSchema,
  ultraworkCouncilDecisionEventSchema,
  ultraworkKnowledgePromotedEventSchema,
  ultraworkResearchFindingVerifiedEventSchema,
  ultraworkResearchProviderSelectedEventSchema,
  ultraworkResearchStartedEventSchema,
  ultraworkStageChangedEventSchema,
  ultraworkSwarmPausedEventSchema,
  ultraworkSwarmResumedEventSchema,
  ultraworkTaskAssignedEventSchema,
  ultraworkTeamStaffedEventSchema,
  ultraworkVerificationCompletedEventSchema,
  type UltraworkCollaborationDebateEvent,
  type UltraworkCollaborationMentionEvent,
  type UltraworkCollaborationMessageEvent,
  type UltraworkCollaborationSteerEvent,
  type UltraworkCouncilDecisionEvent,
  type UltraworkKnowledgePromotedEvent,
  type UltraworkResearchFindingVerifiedEvent,
  type UltraworkResearchProviderSelectedEvent,
  type UltraworkResearchStartedEvent,
  type UltraworkStageChangedEvent,
  type UltraworkSwarmPausedEvent,
  type UltraworkSwarmResumedEvent,
  type UltraworkTaskAssignedEvent,
  type UltraworkTeamStaffedEvent,
  type UltraworkVerificationCompletedEvent,
} from './ultrawork';

export type AgentEvent =
  | ErrorEvent
  | WarningEvent
  | AgentStatusUpdatedEvent
  | SessionMetaUpdatedEvent
  | SessionCreatedEvent
  | WorkspaceCreatedEvent
  | WorkspaceUpdatedEvent
  | WorkspaceDeletedEvent
  | SessionStatusChangedEvent
  | ConfigChangedEvent
  | ModelCatalogChangedEvent
  | UltraworkStageChangedEvent
  | UltraworkResearchStartedEvent
  | UltraworkResearchProviderSelectedEvent
  | UltraworkResearchFindingVerifiedEvent
  | UltraworkTeamStaffedEvent
  | UltraworkTaskAssignedEvent
  | UltraworkCollaborationMessageEvent
  | UltraworkCollaborationMentionEvent
  | UltraworkCollaborationDebateEvent
  | UltraworkCollaborationSteerEvent
  | UltraworkCouncilDecisionEvent
  | UltraworkSwarmPausedEvent
  | UltraworkSwarmResumedEvent
  | UltraworkVerificationCompletedEvent
  | UltraworkKnowledgePromotedEvent
  | GoalUpdatedEvent
  | JobUpdatedEvent
  | JobInboxEvent
  | SkillActivatedEvent
  | PluginCommandActivatedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | TurnStepStartedEvent
  | TurnStepCompletedEvent
  | TurnStepRetryingEvent
  | TurnStepInterruptedEvent
  | AssistantDeltaEvent
  | HookResultEvent
  | ThinkingDeltaEvent
  | ToolCallDeltaEvent
  | ToolCallStartedEvent
  | ToolProgressEvent
  | ShellOutputEvent
  | ShellStartedEvent
  | ToolResultEvent
  | ToolListUpdatedEvent
  | McpServerStatusEvent
  | SubagentSpawnedEvent
  | SubagentStartedEvent
  | SubagentSuspendedEvent
  | SubagentProgressEvent
  | SubagentStalledEvent
  | SubagentToolCallEvent
  | SubagentToolResultEvent
  | SubagentCompletedEvent
  | SubagentFailedEvent
  | SubagentTodoUpdatedEvent
  | ToolsUpdateStoreEvent
  | CompactionStartedEvent
  | CompactionBlockedEvent
  | CompactionCancelledEvent
  | CompactionCompletedEvent
  | CompactionProgressEvent
  | BackgroundTaskStartedEvent
  | BackgroundTaskTerminatedEvent
  | CronFiredEvent
  | PromptSubmittedEvent
  | RuntimeDegradedEvent;

export type Event = AgentEvent & { agentId: string; sessionId: string };

const agentEventDiscriminatedSchema = z.discriminatedUnion('type', [
  errorEventSchema,
  warningEventSchema,
  agentStatusUpdatedEventSchema,
  sessionMetaUpdatedEventSchema,
  sessionCreatedEventSchema,
  workspaceCreatedEventSchema,
  workspaceUpdatedEventSchema,
  workspaceDeletedEventSchema,
  sessionStatusChangedEventSchema,
  modelCatalogChangedEventSchema,
  ultraworkStageChangedEventSchema,
  ultraworkResearchStartedEventSchema,
  ultraworkResearchProviderSelectedEventSchema,
  ultraworkResearchFindingVerifiedEventSchema,
  ultraworkTeamStaffedEventSchema,
  ultraworkTaskAssignedEventSchema,
  ultraworkCollaborationMessageEventSchema,
  ultraworkCollaborationMentionEventSchema,
  ultraworkCollaborationDebateEventSchema,
  ultraworkCollaborationSteerEventSchema,
  ultraworkCouncilDecisionEventSchema,
  ultraworkSwarmPausedEventSchema,
  ultraworkSwarmResumedEventSchema,
  ultraworkVerificationCompletedEventSchema,
  ultraworkKnowledgePromotedEventSchema,
  goalUpdatedEventSchema,
  jobUpdatedEventSchema,
  jobInboxEventSchema,
  skillActivatedEventSchema,
  pluginCommandActivatedEventSchema,
  turnStartedEventSchema,
  turnEndedEventSchema,
  turnStepStartedEventSchema,
  turnStepCompletedEventSchema,
  turnStepRetryingEventSchema,
  turnStepInterruptedEventSchema,
  assistantDeltaEventSchema,
  hookResultEventSchema,
  thinkingDeltaEventSchema,
  toolCallDeltaEventSchema,
  toolCallStartedEventSchema,
  toolProgressEventSchema,
  shellOutputEventSchema,
  shellStartedEventSchema,
  toolResultEventSchema,
  toolListUpdatedEventSchema,
  mcpServerStatusEventSchema,
  subagentSpawnedEventSchema,
  subagentStartedEventSchema,
  subagentSuspendedEventSchema,
  subagentProgressEventSchema,
  subagentStalledEventSchema,
  subagentToolCallEventSchema,
  subagentToolResultEventSchema,
  subagentCompletedEventSchema,
  subagentFailedEventSchema,
  subagentTodoUpdatedEventSchema,
  toolsUpdateStoreEventSchema,
  compactionStartedEventSchema,
  compactionBlockedEventSchema,
  compactionCancelledEventSchema,
  compactionCompletedEventSchema,
  compactionProgressEventSchema,
  backgroundTaskStartedEventSchema,
  backgroundTaskTerminatedEventSchema,
  cronFiredEventSchema,
  promptSubmittedEventSchema,
  runtimeDegradedEventSchema,
]);

export const agentEventSchema = z.preprocess((value) => {
  if (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  ) {
    return normalizeMissionOrFleetUltraworkEventAlias(value as { type: string });
  }
  return value;
}, agentEventDiscriminatedSchema) as z.ZodType<AgentEvent>;

export const eventSchema = agentEventSchema.and(
  z.object({
    agentId: z.string(),
    sessionId: z.string(),
  }),
) satisfies z.ZodType<Event>;

/**
 * Volatile (ephemeral) event types — the IM-style "typing indicator" class.
 *
 * Volatile events are NOT journaled and do NOT advance the per-session
 * durable `seq`. They are fanned out live with the current durable watermark
 * (`seq` = last durable seq, `volatile: true` on the envelope) and are never
 * replayed after a reconnect. Clients recover any state they convey from the
 * session snapshot (`GET /sessions/{sid}/snapshot` → `in_flight_turn`) or
 * other REST surfaces instead of delta replay.
 *
 * Everything not listed here is durable: journaled, seq-bearing, replayable.
 */
export const VOLATILE_EVENT_TYPES = [
  'assistant.delta',
  'thinking.delta',
  'tool.call.delta',
  'tool.progress',
  'shell.output',
  'shell.started',
  'agent.status.updated',
  'subagent.todo.updated',
  'tools.update_store',
  'compaction.progress',
  'runtime.degraded',
] as const satisfies readonly AgentEvent['type'][];

export type VolatileEventType = (typeof VOLATILE_EVENT_TYPES)[number];

const volatileEventTypeSet: ReadonlySet<string> = new Set(VOLATILE_EVENT_TYPES);

export function isVolatileEventType(type: string): type is VolatileEventType {
  return volatileEventTypeSet.has(type);
}
