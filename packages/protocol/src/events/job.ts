/**
 * Conductor Job desk protocol events (`job.*`).
 * Journal readers that do not understand these types should ignore-unknown.
 * schemaVersion is on the event payload for forward-compatible migration.
 */

import { z } from 'zod';

export const JOB_EVENT_SCHEMA_VERSION = 1 as const;

export type JobEventStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_user'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type JobEventKind =
  | 'task'
  | 'explore'
  | 'implement'
  | 'mission'
  | 'merge';

export interface JobSnapshot {
  readonly id: string;
  readonly title: string;
  readonly status: JobEventStatus;
  readonly kind: JobEventKind;
  readonly priority: number;
  readonly worktreePath?: string;
  readonly workerAgentId?: string;
  readonly missionRunId?: string;
  readonly resultSummary?: string;
}

export interface JobUpdatedEvent {
  readonly type: 'job.updated';
  readonly schemaVersion: typeof JOB_EVENT_SCHEMA_VERSION;
  readonly job: JobSnapshot;
  readonly change?: {
    readonly reason?: string;
    readonly previousStatus?: JobEventStatus;
  };
}

export interface JobInboxEvent {
  readonly type: 'job.inbox';
  readonly schemaVersion: typeof JOB_EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly kind:
    | 'job.completed'
    | 'job.failed'
    | 'job.cancelled'
    | 'job.blocked'
    | 'job.needs_user'
    | 'job.interrupted';
  readonly jobId: string;
  readonly status: JobEventStatus;
  readonly title: string;
  readonly summary?: string;
}

export const jobEventStatusSchema = z.enum([
  'queued',
  'running',
  'blocked',
  'needs_user',
  'done',
  'failed',
  'cancelled',
  'interrupted',
]) satisfies z.ZodType<JobEventStatus>;

export const jobEventKindSchema = z.enum([
  'task',
  'explore',
  'implement',
  'mission',
  'merge',
]) satisfies z.ZodType<JobEventKind>;

export const jobSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: jobEventStatusSchema,
  kind: jobEventKindSchema,
  priority: z.number(),
  worktreePath: z.string().optional(),
  workerAgentId: z.string().optional(),
  missionRunId: z.string().optional(),
  resultSummary: z.string().optional(),
}) satisfies z.ZodType<JobSnapshot>;

export const jobUpdatedEventSchema = z.object({
  type: z.literal('job.updated'),
  schemaVersion: z.literal(JOB_EVENT_SCHEMA_VERSION),
  job: jobSnapshotSchema,
  change: z
    .object({
      reason: z.string().optional(),
      previousStatus: jobEventStatusSchema.optional(),
    })
    .optional(),
}) satisfies z.ZodType<JobUpdatedEvent>;

export const jobInboxEventSchema = z.object({
  type: z.literal('job.inbox'),
  schemaVersion: z.literal(JOB_EVENT_SCHEMA_VERSION),
  eventId: z.string(),
  kind: z.enum([
    'job.completed',
    'job.failed',
    'job.cancelled',
    'job.blocked',
    'job.needs_user',
    'job.interrupted',
  ]),
  jobId: z.string(),
  status: jobEventStatusSchema,
  title: z.string(),
  summary: z.string().optional(),
}) satisfies z.ZodType<JobInboxEvent>;
