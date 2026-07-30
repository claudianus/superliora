import { z } from 'zod';

import { skillSourceSchema, type SkillSource } from './common';
import { agentCoreBackgroundTaskStatusSchema, type AgentCoreBackgroundTaskStatus } from './background';

export interface UserPromptOrigin {
  readonly kind: 'user';
}

export interface SkillActivationOrigin {
  readonly kind: 'skill_activation';
  readonly activationId: string;
  readonly skillName: string;
  readonly skillArgs?: string;
  readonly trigger: 'user-slash' | 'model-tool' | 'nested-skill';
  readonly skillType?: string;
  readonly skillPath?: string;
  readonly skillSource?: SkillSource;
}

export interface PluginCommandOrigin {
  readonly kind: 'plugin_command';
  readonly activationId: string;
  readonly pluginId: string;
  readonly commandName: string;
  readonly commandArgs?: string;
  readonly trigger: 'user-slash';
}

export interface InjectionOrigin {
  readonly kind: 'injection';
  readonly variant: string;
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

export interface CronJobOrigin {
  readonly kind: 'cron_job';
  readonly jobId: string;
  readonly cron: string;
  readonly recurring: boolean;
  readonly coalescedCount: number;
  readonly stale: boolean;
}

export interface CronMissedOrigin {
  readonly kind: 'cron_missed';
  readonly count: number;
}

export interface HookResultOrigin {
  readonly kind: 'hook_result';
  readonly event: string;
  readonly blocked?: boolean;
}

export interface RetryOrigin {
  readonly kind: 'retry';
  readonly trigger?: string;
}

export type PromptOrigin =
  | UserPromptOrigin
  | SkillActivationOrigin
  | PluginCommandOrigin
  | InjectionOrigin
  | ShellCommandOrigin
  | CompactionSummaryOrigin
  | SystemTriggerOrigin
  | BackgroundTaskOrigin
  | CronJobOrigin
  | CronMissedOrigin
  | HookResultOrigin
  | RetryOrigin;

export interface SkillActivatedEvent {
  readonly type: 'skill.activated';
  readonly activationId: string;
  readonly skillName: string;
  readonly skillArgs?: string;
  readonly trigger: 'user-slash' | 'model-tool' | 'nested-skill';
  readonly skillPath?: string;
  readonly skillSource?: SkillSource;
}

export interface PluginCommandActivatedEvent {
  readonly type: 'plugin_command.activated';
  readonly activationId: string;
  readonly pluginId: string;
  readonly commandName: string;
  readonly commandArgs?: string;
  readonly trigger: 'user-slash';
}

export interface CronFiredEvent {
  readonly type: 'cron.fired';
  readonly origin: CronJobOrigin;
  readonly prompt: string;
}

export const userPromptOriginSchema = z.object({
  kind: z.literal('user'),
}) satisfies z.ZodType<UserPromptOrigin>;

export const skillActivationOriginSchema = z.object({
  kind: z.literal('skill_activation'),
  activationId: z.string(),
  skillName: z.string(),
  skillArgs: z.string().optional(),
  trigger: z.enum(['user-slash', 'model-tool', 'nested-skill']),
  skillType: z.string().optional(),
  skillPath: z.string().optional(),
  skillSource: skillSourceSchema.optional(),
}) satisfies z.ZodType<SkillActivationOrigin>;

export const pluginCommandOriginSchema = z.object({
  kind: z.literal('plugin_command'),
  activationId: z.string(),
  pluginId: z.string(),
  commandName: z.string(),
  commandArgs: z.string().optional(),
  trigger: z.literal('user-slash'),
}) satisfies z.ZodType<PluginCommandOrigin>;

export const injectionOriginSchema = z.object({
  kind: z.literal('injection'),
  variant: z.string(),
}) satisfies z.ZodType<InjectionOrigin>;

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

export const cronJobOriginSchema = z.object({
  kind: z.literal('cron_job'),
  jobId: z.string(),
  cron: z.string(),
  recurring: z.boolean(),
  coalescedCount: z.number(),
  stale: z.boolean(),
}) satisfies z.ZodType<CronJobOrigin>;

export const cronMissedOriginSchema = z.object({
  kind: z.literal('cron_missed'),
  count: z.number(),
}) satisfies z.ZodType<CronMissedOrigin>;

export const hookResultOriginSchema = z.object({
  kind: z.literal('hook_result'),
  event: z.string(),
  blocked: z.boolean().optional(),
}) satisfies z.ZodType<HookResultOrigin>;

export const retryOriginSchema = z.object({
  kind: z.literal('retry'),
  trigger: z.string().optional(),
}) satisfies z.ZodType<RetryOrigin>;

export const promptOriginSchema = z.discriminatedUnion('kind', [
  userPromptOriginSchema,
  skillActivationOriginSchema,
  pluginCommandOriginSchema,
  injectionOriginSchema,
  shellCommandOriginSchema,
  compactionSummaryOriginSchema,
  systemTriggerOriginSchema,
  backgroundTaskOriginSchema,
  cronJobOriginSchema,
  cronMissedOriginSchema,
  hookResultOriginSchema,
  retryOriginSchema,
]) satisfies z.ZodType<PromptOrigin>;

export const skillActivatedEventSchema = z.object({
  type: z.literal('skill.activated'),
  activationId: z.string(),
  skillName: z.string(),
  skillArgs: z.string().optional(),
  trigger: z.enum(['user-slash', 'model-tool', 'nested-skill']),
  skillPath: z.string().optional(),
  skillSource: skillSourceSchema.optional(),
}) satisfies z.ZodType<SkillActivatedEvent>;

export const pluginCommandActivatedEventSchema = z.object({
  type: z.literal('plugin_command.activated'),
  activationId: z.string(),
  pluginId: z.string(),
  commandName: z.string(),
  commandArgs: z.string().optional(),
  trigger: z.literal('user-slash'),
}) satisfies z.ZodType<PluginCommandActivatedEvent>;

export const cronFiredEventSchema = z.object({
  type: z.literal('cron.fired'),
  origin: cronJobOriginSchema,
  prompt: z.string(),
}) satisfies z.ZodType<CronFiredEvent>;
