import { z } from 'zod';

import { agentCoreBackgroundTaskStatusSchema, type AgentCoreBackgroundTaskStatus } from './background';

export interface UserPromptOrigin {
  readonly kind: 'user';
}

export interface ShellCommandOrigin {
  readonly kind: 'shell_command';
  readonly phase: 'input' | 'output';
  /** Only present on `phase: 'output'` — whether the command failed, so replay
   *  can colour stderr red only for actual failures (not warnings). */
  readonly isError?: boolean;
}

export interface CompactionSummaryOrigin {
  readonly kind: 'compaction_summary';
}

export interface SystemTriggerOrigin {
  readonly kind: 'system_trigger';
  readonly name: string;
}

export interface BackgroundTaskOrigin {
  readonly kind: 'background_task';
  readonly taskId: string;
  readonly status: AgentCoreBackgroundTaskStatus;
  readonly notificationId: string;
}

export interface RetryOrigin {
  readonly kind: 'retry';
  readonly trigger?: string;
}

export type PromptOrigin =
  | UserPromptOrigin
  | ShellCommandOrigin
  | CompactionSummaryOrigin
  | SystemTriggerOrigin
  | BackgroundTaskOrigin
  | RetryOrigin;

export const userPromptOriginSchema = z.object({
  kind: z.literal('user'),
}) satisfies z.ZodType<UserPromptOrigin>;

export const shellCommandOriginSchema = z.object({
  kind: z.literal('shell_command'),
  phase: z.enum(['input', 'output']),
  isError: z.boolean().optional(),
}) satisfies z.ZodType<ShellCommandOrigin>;

export const compactionSummaryOriginSchema = z.object({
  kind: z.literal('compaction_summary'),
}) satisfies z.ZodType<CompactionSummaryOrigin>;

export const systemTriggerOriginSchema = z.object({
  kind: z.literal('system_trigger'),
  name: z.string(),
}) satisfies z.ZodType<SystemTriggerOrigin>;

export const backgroundTaskOriginSchema = z.object({
  kind: z.literal('background_task'),
  taskId: z.string(),
  status: agentCoreBackgroundTaskStatusSchema,
  notificationId: z.string(),
}) satisfies z.ZodType<BackgroundTaskOrigin>;

export const retryOriginSchema = z.object({
  kind: z.literal('retry'),
  trigger: z.string().optional(),
}) satisfies z.ZodType<RetryOrigin>;

export const promptOriginSchema = z.discriminatedUnion('kind', [
  userPromptOriginSchema,
  shellCommandOriginSchema,
  compactionSummaryOriginSchema,
  systemTriggerOriginSchema,
  backgroundTaskOriginSchema,
  retryOriginSchema,
]) satisfies z.ZodType<PromptOrigin>;

