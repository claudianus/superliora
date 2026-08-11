import { z } from 'zod';

import { tokenUsageSchema, type TokenUsage } from './common';

export interface SubagentSpawnedEvent {
  readonly type: 'subagent.spawned';
  readonly subagentId: string;
  readonly subagentName: string;
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly parentAgentId?: string;
  readonly description?: string;
  readonly runInBackground: boolean;
  /** Effective model alias for this child (explore cheap route or parent). */
  readonly modelAlias?: string;
  /** Smart-router reason when auto-assigned (e.g. `coding/max`). */
  readonly routeReason?: string;
}

export interface SubagentStartedEvent {
  readonly type: 'subagent.started';
  readonly subagentId: string;
}

export interface SubagentSuspendedEvent {
  readonly type: 'subagent.suspended';
  readonly subagentId: string;
  readonly reason: string;
}

export interface SubagentProgressEvent {
  readonly type: 'subagent.progress';
  readonly subagentId: string;
  readonly subagentName?: string;
  readonly lastTool?: string;
  readonly lastTarget?: string;
  readonly toolCount: number;
  readonly elapsedMs: number;
  readonly tokens: number;
  readonly budgetMs?: number;
  readonly budgetRemainingMs?: number;
  readonly finishing?: boolean;
}

export interface SubagentStalledEvent {
  readonly type: 'subagent.stalled';
  readonly subagentId: string;
  readonly subagentName?: string;
  readonly silentMs: number;
  readonly toolCount: number;
}

/**
 * Structured per-tool detail for `subagent.tool_call` (Phase 1-B realtime
 * overhaul). Computed from the FULL child args at the emitter and attached
 * for the common file/shell tools only, so clients can render the same
 * numeric chips the main agent's tool stream shows without shipping full
 * args. Unknown tools omit detail entirely.
 */
export type SubagentToolDetail =
  | SubagentToolEditDetail
  | SubagentToolWriteDetail
  | SubagentToolReadDetail
  | SubagentToolBashDetail
  | SubagentToolSearchDetail;

export interface SubagentToolEditDetail {
  readonly kind: 'edit';
  readonly path: string;
  readonly addedLines: number;
  readonly removedLines: number;
}

export interface SubagentToolWriteDetail {
  readonly kind: 'write';
  readonly path: string;
  readonly lines: number;
  readonly bytes: number;
}

export interface SubagentToolReadDetail {
  readonly kind: 'read';
  readonly path: string;
}

export interface SubagentToolBashDetail {
  readonly kind: 'bash';
  /** Command flattened to a single line and truncated at the emitter (~120 chars). */
  readonly command: string;
}

export interface SubagentToolSearchDetail {
  /** Grep / Glob share one variant; the event `name` tells them apart. */
  readonly kind: 'search';
  readonly pattern: string;
}

/**
 * Live tool-call telemetry for a running subagent (Phase 1-A realtime
 * overhaul). Emitted on the PARENT agent when a child tool call starts, so
 * clients can render a per-subagent live feed without routing every raw
 * child event. Args are truncated to a short single-line preview at the
 * emitter; the wire payload stays small by construction.
 */
export interface SubagentToolCallEvent {
  readonly type: 'subagent.tool_call';
  readonly subagentId: string;
  readonly subagentName?: string;
  /** Parent tool call that spawned the subagent; correlates panel state. */
  readonly parentToolCallId?: string;
  /** Parent run id when the subagent is part of a fan-out run. */
  readonly runId?: string;
  readonly toolCallId: string;
  readonly name: string;
  /** Single-line args preview, truncated at the emitter (~400 chars). */
  readonly argsPreview?: string;
  /** Structured chip detail for common tools (Phase 1-B); absent otherwise. */
  readonly detail?: SubagentToolDetail;
}

/**
 * Completion counterpart to {@link SubagentToolCallEvent}. Emitted on the
 * parent agent when a child tool call finishes; the result summary is
 * truncated at the emitter (~500 chars).
 */
export interface SubagentToolResultEvent {
  readonly type: 'subagent.tool_result';
  readonly subagentId: string;
  readonly runId?: string;
  readonly toolCallId: string;
  /** Tool name tracked from the matching `subagent.tool_call`, when seen. */
  readonly name?: string;
  readonly isError?: boolean;
  /** Single-line result summary, truncated at the emitter (~500 chars). */
  readonly resultPreview?: string;
}

export interface SubagentCompletedEvent {
  readonly type: 'subagent.completed';
  readonly subagentId: string;
  readonly resultSummary: string;
  readonly usage?: TokenUsage;
  readonly contextTokens?: number;
}

export interface SubagentFailedEvent {
  readonly type: 'subagent.failed';
  readonly subagentId: string;
  readonly error: string;
  /** 1-based model-fallback attempt count when the host is retrying on a fallback model. */
  readonly retryAttempt?: number;
  /** Maximum model-fallback hops configured for this spawn. */
  readonly retryLimit?: number;
  /**
   * With `retryAttempt`: alias the host will try next.
   * Without `retryAttempt` (terminal): last alias attempted after >=1 fallback hop.
   */
  readonly fellBackToModel?: string;
}

export interface TodoItemPayload {
  readonly title: string;
  readonly status: 'pending' | 'in_progress' | 'done';
}

export interface SubagentTodoUpdatedEvent {
  readonly type: 'subagent.todo.updated';
  readonly subagentId: string;
  readonly subagentName: string;
  readonly parentToolCallId: string;
  readonly todos: readonly TodoItemPayload[];
}

export const subagentSpawnedEventSchema = z.object({
  type: z.literal('subagent.spawned'),
  subagentId: z.string(),
  subagentName: z.string(),
  parentToolCallId: z.string(),
  parentToolCallUuid: z.string().optional(),
  parentAgentId: z.string().optional(),
  description: z.string().optional(),
  runInBackground: z.boolean(),
  modelAlias: z.string().optional(),
  routeReason: z.string().optional(),
}) satisfies z.ZodType<SubagentSpawnedEvent>;

export const subagentStartedEventSchema = z.object({
  type: z.literal('subagent.started'),
  subagentId: z.string(),
}) satisfies z.ZodType<SubagentStartedEvent>;

export const subagentSuspendedEventSchema = z.object({
  type: z.literal('subagent.suspended'),
  subagentId: z.string(),
  reason: z.string(),
}) satisfies z.ZodType<SubagentSuspendedEvent>;

export const subagentProgressEventSchema = z.object({
  type: z.literal('subagent.progress'),
  subagentId: z.string(),
  subagentName: z.string().optional(),
  lastTool: z.string().optional(),
  lastTarget: z.string().optional(),
  toolCount: z.number(),
  elapsedMs: z.number(),
  tokens: z.number(),
  budgetMs: z.number().optional(),
  budgetRemainingMs: z.number().optional(),
  finishing: z.boolean().optional(),
}) satisfies z.ZodType<SubagentProgressEvent>;

export const subagentStalledEventSchema = z.object({
  type: z.literal('subagent.stalled'),
  subagentId: z.string(),
  subagentName: z.string().optional(),
  silentMs: z.number(),
  toolCount: z.number(),
}) satisfies z.ZodType<SubagentStalledEvent>;

export const subagentToolDetailSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('edit'),
    path: z.string(),
    addedLines: z.number(),
    removedLines: z.number(),
  }),
  z.object({
    kind: z.literal('write'),
    path: z.string(),
    lines: z.number(),
    bytes: z.number(),
  }),
  z.object({ kind: z.literal('read'), path: z.string() }),
  z.object({ kind: z.literal('bash'), command: z.string() }),
  z.object({ kind: z.literal('search'), pattern: z.string() }),
]) satisfies z.ZodType<SubagentToolDetail>;

export const subagentToolCallEventSchema = z.object({
  type: z.literal('subagent.tool_call'),
  subagentId: z.string(),
  subagentName: z.string().optional(),
  parentToolCallId: z.string().optional(),
  runId: z.string().optional(),
  toolCallId: z.string(),
  name: z.string(),
  argsPreview: z.string().optional(),
  detail: subagentToolDetailSchema.optional(),
}) satisfies z.ZodType<SubagentToolCallEvent>;

export const subagentToolResultEventSchema = z.object({
  type: z.literal('subagent.tool_result'),
  subagentId: z.string(),
  runId: z.string().optional(),
  toolCallId: z.string(),
  name: z.string().optional(),
  isError: z.boolean().optional(),
  resultPreview: z.string().optional(),
}) satisfies z.ZodType<SubagentToolResultEvent>;

export const subagentCompletedEventSchema = z.object({
  type: z.literal('subagent.completed'),
  subagentId: z.string(),
  resultSummary: z.string(),
  usage: tokenUsageSchema.optional(),
  contextTokens: z.number().optional(),
}) satisfies z.ZodType<SubagentCompletedEvent>;

export const subagentFailedEventSchema = z.object({
  type: z.literal('subagent.failed'),
  subagentId: z.string(),
  error: z.string(),
  retryAttempt: z.number().optional(),
  retryLimit: z.number().optional(),
  fellBackToModel: z.string().optional(),
}) satisfies z.ZodType<SubagentFailedEvent>;

const todoItemPayloadSchema = z.object({
  title: z.string(),
  status: z.enum(['pending', 'in_progress', 'done']),
}) satisfies z.ZodType<TodoItemPayload>;

export const subagentTodoUpdatedEventSchema = z.object({
  type: z.literal('subagent.todo.updated'),
  subagentId: z.string(),
  subagentName: z.string(),
  parentToolCallId: z.string(),
  todos: z.array(todoItemPayloadSchema),
}) satisfies z.ZodType<SubagentTodoUpdatedEvent>;
