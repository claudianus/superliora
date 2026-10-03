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
  /** Actual model alias used by this worker. */
  readonly modelAlias?: string;
}

export interface SubagentStartedEvent {
  readonly type: 'subagent.started';
  readonly subagentId: string;
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
}

/** Native model-tool details projected from the worker's actual arguments. */
export type SubagentToolDetail = SubagentToolBashDetail | SubagentToolSessionDetail;

export interface SubagentToolBashDetail {
  readonly kind: 'bash';
  readonly command: string;
}

export interface SubagentToolSessionDetail {
  readonly kind: 'session';
  readonly operation: string;
  readonly description?: string;
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

/**
 * Incremental counterpart to {@link SubagentToolCallEvent}. Emitted on the
 * parent agent when a child tool reports `tool.progress` (stdout/stderr/
 * status), so clients can paint logs and diffs while the child is still
 * running. Each chunk is truncated at the emitter (~500 chars); `custom`
 * updates are dropped so opaque payloads never hit the wire.
 */
export interface SubagentToolProgressEvent {
  readonly type: 'subagent.tool_progress';
  readonly subagentId: string;
  readonly runId?: string;
  readonly toolCallId: string;
  /** Tool name tracked from the matching `subagent.tool_call`, when seen. */
  readonly name?: string;
  readonly kind: 'stdout' | 'stderr' | 'progress' | 'status';
  /** Chunk preview, truncated at the emitter (~500 chars). */
  readonly textPreview?: string;
  /** Native terminal identity supplied by the executing terminal provider. */
  readonly terminalId?: string;
}

export interface SubagentCompletedEvent {
  readonly type: 'subagent.completed';
  readonly subagentId: string;
  readonly resultSummary: string;
  readonly usage?: TokenUsage;
  readonly contextTokens?: number;
  readonly filesChanged?: readonly string[];
}

export interface SubagentFailedEvent {
  readonly type: 'subagent.failed';
  readonly subagentId: string;
  readonly error: string;
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
}) satisfies z.ZodType<SubagentSpawnedEvent>;

export const subagentStartedEventSchema = z.object({
  type: z.literal('subagent.started'),
  subagentId: z.string(),
}) satisfies z.ZodType<SubagentStartedEvent>;

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
}) satisfies z.ZodType<SubagentProgressEvent>;

export const subagentToolDetailSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bash'), command: z.string() }),
  z.object({
    kind: z.literal('session'),
    operation: z.string(),
    description: z.string().optional(),
  }),
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

export const subagentToolProgressEventSchema = z.object({
  type: z.literal('subagent.tool_progress'),
  subagentId: z.string(),
  runId: z.string().optional(),
  toolCallId: z.string(),
  name: z.string().optional(),
  kind: z.enum(['stdout', 'stderr', 'progress', 'status']),
  textPreview: z.string().optional(),
  terminalId: z.string().optional(),
}) satisfies z.ZodType<SubagentToolProgressEvent>;

export const subagentCompletedEventSchema = z.object({
  type: z.literal('subagent.completed'),
  subagentId: z.string(),
  resultSummary: z.string(),
  usage: tokenUsageSchema.optional(),
  contextTokens: z.number().optional(),
  filesChanged: z.array(z.string()).readonly().optional(),
}) satisfies z.ZodType<SubagentCompletedEvent>;

export const subagentFailedEventSchema = z.object({
  type: z.literal('subagent.failed'),
  subagentId: z.string(),
  error: z.string(),
}) satisfies z.ZodType<SubagentFailedEvent>;

