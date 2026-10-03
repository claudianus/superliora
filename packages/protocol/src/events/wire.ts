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
import {
  jobInboxEventSchema,
  jobUpdatedEventSchema,
  type JobInboxEvent,
  type JobUpdatedEvent,
} from './job';
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
  subagentStartedEventSchema,
  subagentToolCallEventSchema,
  subagentToolProgressEventSchema,
  subagentToolResultEventSchema,
  type SubagentCompletedEvent,
  type SubagentFailedEvent,
  type SubagentProgressEvent,
  type SubagentSpawnedEvent,
  type SubagentStartedEvent,
  type SubagentToolCallEvent,
  type SubagentToolProgressEvent,
  type SubagentToolResultEvent,
} from './subagent';
import {
  shellOutputEventSchema,
  shellStartedEventSchema,
  toolCallDeltaEventSchema,
  toolCallStartedEventSchema,
  toolProgressEventSchema,
  toolResultEventSchema,
  type ShellOutputEvent,
  type ShellStartedEvent,
  type ToolCallDeltaEvent,
  type ToolCallStartedEvent,
  type ToolProgressEvent,
  type ToolResultEvent,
} from './tool';
import {
  assistantDeltaEventSchema,
  promptSubmittedEventSchema,
  thinkingDeltaEventSchema,
  turnEndedEventSchema,
  turnStartedEventSchema,
  turnStepCompletedEventSchema,
  turnStepInterruptedEventSchema,
  turnStepStartedEventSchema,
  type AssistantDeltaEvent,
  type PromptSubmittedEvent,
  type ThinkingDeltaEvent,
  type TurnEndedEvent,
  type TurnStartedEvent,
  type TurnStepCompletedEvent,
  type TurnStepInterruptedEvent,
  type TurnStepStartedEvent,
} from './turn';

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
  | JobUpdatedEvent
  | JobInboxEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | TurnStepStartedEvent
  | TurnStepCompletedEvent
  | TurnStepInterruptedEvent
  | AssistantDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallDeltaEvent
  | ToolCallStartedEvent
  | ToolProgressEvent
  | ShellOutputEvent
  | ShellStartedEvent
  | ToolResultEvent
  | SubagentSpawnedEvent
  | SubagentStartedEvent
  | SubagentProgressEvent
  | SubagentToolCallEvent
  | SubagentToolResultEvent
  | SubagentToolProgressEvent
  | SubagentCompletedEvent
  | SubagentFailedEvent
  | CompactionStartedEvent
  | CompactionBlockedEvent
  | CompactionCancelledEvent
  | CompactionCompletedEvent
  | CompactionProgressEvent
  | BackgroundTaskStartedEvent
  | BackgroundTaskTerminatedEvent
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
  configChangedEventSchema,
  modelCatalogChangedEventSchema,
  jobUpdatedEventSchema,
  jobInboxEventSchema,
  turnStartedEventSchema,
  turnEndedEventSchema,
  turnStepStartedEventSchema,
  turnStepCompletedEventSchema,
  turnStepInterruptedEventSchema,
  assistantDeltaEventSchema,
  thinkingDeltaEventSchema,
  toolCallDeltaEventSchema,
  toolCallStartedEventSchema,
  toolProgressEventSchema,
  shellOutputEventSchema,
  shellStartedEventSchema,
  toolResultEventSchema,
  subagentSpawnedEventSchema,
  subagentStartedEventSchema,
  subagentProgressEventSchema,
  subagentToolCallEventSchema,
  subagentToolResultEventSchema,
  subagentToolProgressEventSchema,
  subagentCompletedEventSchema,
  subagentFailedEventSchema,
  compactionStartedEventSchema,
  compactionBlockedEventSchema,
  compactionCancelledEventSchema,
  compactionCompletedEventSchema,
  compactionProgressEventSchema,
  backgroundTaskStartedEventSchema,
  backgroundTaskTerminatedEventSchema,
  promptSubmittedEventSchema,
  runtimeDegradedEventSchema,
]);

export const agentEventSchema = agentEventDiscriminatedSchema as z.ZodType<AgentEvent>;

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
  'subagent.tool_progress',
  'shell.output',
  'shell.started',
  'agent.status.updated',
  'compaction.progress',
  'runtime.degraded',
] as const satisfies readonly AgentEvent['type'][];

export type VolatileEventType = (typeof VOLATILE_EVENT_TYPES)[number];

const volatileEventTypeSet: ReadonlySet<string> = new Set(VOLATILE_EVENT_TYPES);

export function isVolatileEventType(type: string): type is VolatileEventType {
  return volatileEventTypeSet.has(type);
}
