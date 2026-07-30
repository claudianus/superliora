import { z } from 'zod';

import { ToolInputDisplaySchema, type ToolInputDisplay } from '../display';
import { toolUpdateSchema, type ToolUpdate } from './common';

export interface ToolCallDeltaEvent {
  readonly type: 'tool.call.delta';
  readonly turnId: number;
  readonly toolCallId: string;
  readonly name?: string;
  readonly argumentsPart?: string;
}

export interface ToolCallStartedEvent {
  readonly type: 'tool.call.started';
  readonly turnId: number;
  readonly toolCallId: string;
  readonly name: string;
  readonly args: unknown;
  readonly description?: string;
  readonly display?: ToolInputDisplay;
}

export interface ToolProgressEvent {
  readonly type: 'tool.progress';
  readonly turnId: number;
  readonly toolCallId: string;
  readonly update: ToolUpdate;
}

/**
 * Live stdout/stderr chunk from a user-initiated `!` shell command. Transient
 * (never persisted, never replayed) — the final output is still recorded once
 * via `context.append_message` on completion. `commandId` lets the TUI route
 * chunks to the matching live entry and drop stale events from a prior run.
 */
export interface ShellOutputEvent {
  readonly type: 'shell.output';
  readonly commandId: string;
  readonly update: ToolUpdate;
}

/**
 * Fired once when a `!` shell command's foreground process task is registered,
 * carrying the task id so the client can detach (ctrl+b) it. Transient.
 */
export interface ShellStartedEvent {
  readonly type: 'shell.started';
  readonly commandId: string;
  readonly taskId: string;
}

export interface ToolResultEvent {
  readonly type: 'tool.result';
  readonly turnId: number;
  readonly toolCallId: string;
  readonly output: unknown;
  readonly isError?: boolean;
  readonly synthetic?: boolean;
}

export interface ToolsUpdateStoreEvent {
  readonly type: 'tools.update_store';
  readonly key: string;
  readonly value: unknown;
}

export type ToolListUpdatedReason = 'mcp.connected' | 'mcp.disconnected' | 'mcp.failed';

export interface ToolListUpdatedEvent {
  readonly type: 'tool.list.updated';
  readonly reason: ToolListUpdatedReason;
  readonly serverName: string;
}

export interface McpServerStatusPayload {
  readonly name: string;
  readonly transport: 'stdio' | 'http' | 'sse';
  readonly status: 'pending' | 'connected' | 'failed' | 'disabled' | 'needs-auth';
  readonly toolCount: number;
  readonly error?: string;
}

export interface McpServerStatusEvent {
  readonly type: 'mcp.server.status';
  readonly server: McpServerStatusPayload;
}

export const toolCallDeltaEventSchema = z.object({
  type: z.literal('tool.call.delta'),
  turnId: z.number(),
  toolCallId: z.string(),
  name: z.string().optional(),
  argumentsPart: z.string().optional(),
}) satisfies z.ZodType<ToolCallDeltaEvent>;

export const toolCallStartedEventSchema = z.object({
  type: z.literal('tool.call.started'),
  turnId: z.number(),
  toolCallId: z.string(),
  name: z.string(),
  args: z.unknown(),
  description: z.string().optional(),
  display: ToolInputDisplaySchema.optional(),
}) satisfies z.ZodType<ToolCallStartedEvent>;

export const toolProgressEventSchema = z.object({
  type: z.literal('tool.progress'),
  turnId: z.number(),
  toolCallId: z.string(),
  update: toolUpdateSchema,
}) satisfies z.ZodType<ToolProgressEvent>;

export const shellOutputEventSchema = z.object({
  type: z.literal('shell.output'),
  commandId: z.string(),
  update: toolUpdateSchema,
}) satisfies z.ZodType<ShellOutputEvent>;

export const shellStartedEventSchema = z.object({
  type: z.literal('shell.started'),
  commandId: z.string(),
  taskId: z.string(),
}) satisfies z.ZodType<ShellStartedEvent>;

export const toolResultEventSchema = z.object({
  type: z.literal('tool.result'),
  turnId: z.number(),
  toolCallId: z.string(),
  output: z.unknown(),
  isError: z.boolean().optional(),
  synthetic: z.boolean().optional(),
}) satisfies z.ZodType<ToolResultEvent>;

export const toolsUpdateStoreEventSchema = z.object({
  type: z.literal('tools.update_store'),
  key: z.string(),
  value: z.unknown(),
}) satisfies z.ZodType<ToolsUpdateStoreEvent>;

export const toolListUpdatedReasonSchema = z.enum([
  'mcp.connected',
  'mcp.disconnected',
  'mcp.failed',
]) satisfies z.ZodType<ToolListUpdatedReason>;

export const toolListUpdatedEventSchema = z.object({
  type: z.literal('tool.list.updated'),
  reason: toolListUpdatedReasonSchema,
  serverName: z.string(),
}) satisfies z.ZodType<ToolListUpdatedEvent>;

export const mcpServerStatusPayloadSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http']),
  status: z.enum(['pending', 'connected', 'failed', 'disabled', 'needs-auth']),
  toolCount: z.number(),
  error: z.string().optional(),
}) satisfies z.ZodType<McpServerStatusPayload>;

export const mcpServerStatusEventSchema = z.object({
  type: z.literal('mcp.server.status'),
  server: mcpServerStatusPayloadSchema,
}) satisfies z.ZodType<McpServerStatusEvent>;
