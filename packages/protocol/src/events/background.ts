import { z } from 'zod';

export type AgentCoreBackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'killed'
  | 'lost';

export interface BackgroundTaskInfoBase {
  readonly taskId: string;
  readonly description: string;
  readonly status: AgentCoreBackgroundTaskStatus;
  readonly detached?: boolean;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly stopReason?: string;
  readonly timeoutMs?: number;
  readonly resourcesSettled?: boolean;
}

export interface ProcessBackgroundTaskInfo extends BackgroundTaskInfoBase {
  readonly kind: 'process';
  readonly command: string;
  readonly cwd?: string;
  /** Absent when the native terminal provider does not expose an OS process id. */
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly outputTruncated?: boolean;
}

export interface AgentBackgroundTaskInfo extends BackgroundTaskInfoBase {
  readonly kind: 'agent';
  readonly agentId?: string;
  readonly subagentType?: string;
}


export type BackgroundTaskInfo = ProcessBackgroundTaskInfo | AgentBackgroundTaskInfo;

export interface BackgroundTaskStartedEvent {
  readonly type: 'background.task.started';
  readonly info: BackgroundTaskInfo;
}

export interface BackgroundTaskTerminatedEvent {
  readonly type: 'background.task.terminated';
  readonly info: BackgroundTaskInfo;
}

export const agentCoreBackgroundTaskStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'timed_out',
  'killed',
  'lost',
]) satisfies z.ZodType<AgentCoreBackgroundTaskStatus>;

export const backgroundTaskInfoBaseSchema = z.object({
  taskId: z.string(),
  description: z.string(),
  status: agentCoreBackgroundTaskStatusSchema,
  detached: z.boolean().optional(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  stopReason: z.string().optional(),
  timeoutMs: z.number().optional(),
  resourcesSettled: z.boolean().optional(),
}) satisfies z.ZodType<BackgroundTaskInfoBase>;

export const processBackgroundTaskInfoSchema = backgroundTaskInfoBaseSchema.extend({
  kind: z.literal('process'),
  command: z.string(),
  cwd: z.string().optional(),
  pid: z.number().optional(),
  exitCode: z.number().nullable(),
  outputTruncated: z.boolean().optional(),
}) satisfies z.ZodType<ProcessBackgroundTaskInfo>;

export const agentBackgroundTaskInfoSchema = backgroundTaskInfoBaseSchema.extend({
  kind: z.literal('agent'),
  agentId: z.string().optional(),
  subagentType: z.string().optional(),
}) satisfies z.ZodType<AgentBackgroundTaskInfo>;


export const backgroundTaskInfoSchema = z.discriminatedUnion('kind', [
  processBackgroundTaskInfoSchema,
  agentBackgroundTaskInfoSchema,
]) satisfies z.ZodType<BackgroundTaskInfo>;

export const backgroundTaskStartedEventSchema = z.object({
  type: z.literal('background.task.started'),
  info: backgroundTaskInfoSchema,
}) satisfies z.ZodType<BackgroundTaskStartedEvent>;

export const backgroundTaskTerminatedEventSchema = z.object({
  type: z.literal('background.task.terminated'),
  info: backgroundTaskInfoSchema,
}) satisfies z.ZodType<BackgroundTaskTerminatedEvent>;
