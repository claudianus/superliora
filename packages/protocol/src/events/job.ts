/**
 * Conductor Job desk protocol events (`job.*`).
 * Journal readers that do not understand these types should ignore-unknown.
 * schemaVersion is on the event payload for forward-compatible migration.
 *
 * v2 (meta-orchestrator contract §8 S4): adds worker progress fields
 * (phase/recent tools/heartbeat), the `desk` worker kind, and the inbox
 * `digest` escalation marker. All v2 fields are optional so v1 events keep
 * parsing (journal dual-read), and old readers ignore unknown fields.
 */

import { z } from 'zod';

export const JOB_EVENT_SCHEMA_VERSION = 2 as const;
/** v1 payloads stay parseable for journal dual-read (contract §10). */
export const JOB_EVENT_SCHEMA_VERSION_V1 = 1 as const;
export type JobEventSchemaVersion =
  | typeof JOB_EVENT_SCHEMA_VERSION_V1
  | typeof JOB_EVENT_SCHEMA_VERSION;

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
  | 'merge'
  | 'desk'
  | 'goal-desk'
  | 'goal-driver';

/**
 * Worker progress reported with `job.updated` (schemaVersion 2).
 * Streams to the TUI board directly; never wakes the main conductor turn.
 */
export interface JobProgressSnapshot {
  /** Current phase label, e.g. `running tests`, `digesting inbox`. */
  readonly phase?: string;
  /** Most recent tool names (newest last), capped by the emitter. */
  readonly recentTools?: readonly string[];
  /** ISO timestamp of the last worker heartbeat. */
  readonly lastHeartbeatAt?: string;
  /** Completed steps when the worker reports a bounded plan. */
  readonly stepsCompleted?: number;
  /** Total steps when known. */
  readonly stepsTotal?: number;
  /** Cumulative worker input tokens (non-cache), when the emitter reports usage. */
  readonly tokensIn?: number;
  /** Cumulative worker output tokens, when known. */
  readonly tokensOut?: number;
  /** Cumulative cache-read tokens, when known. */
  readonly cacheRead?: number;
}

export interface JobSnapshot {
  readonly id: string;
  readonly title: string;
  readonly status: JobEventStatus;
  readonly kind: JobEventKind;
  readonly priority: number;
  readonly worktreePath?: string;
  readonly workerAgentId?: string;
  readonly resultSummary?: string;
  /** Worker progress (schemaVersion 2; absent on v1 snapshots). */
  readonly progress?: JobProgressSnapshot;
  /** ISO timestamp when the job entered the ledger (queue). */
  readonly createdAt?: string;
  /** ISO timestamp of the last ledger mutation for this job. */
  readonly updatedAt?: string;
}

export interface JobUpdatedEvent {
  readonly type: 'job.updated';
  readonly schemaVersion: JobEventSchemaVersion;
  readonly job: JobSnapshot;
  readonly change?: {
    readonly reason?: string;
    readonly previousStatus?: JobEventStatus;
  };
}

export interface JobInboxEvent {
  readonly type: 'job.inbox';
  readonly schemaVersion: JobEventSchemaVersion;
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
  /** True when this event is a desk-digest escalation card (v2). */
  readonly digest?: boolean;
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
  'desk',
  'goal-desk',
  'goal-driver',
]) satisfies z.ZodType<JobEventKind>;

export const jobProgressSnapshotSchema = z.object({
  phase: z.string().optional(),
  recentTools: z.array(z.string()).readonly().optional(),
  lastHeartbeatAt: z.string().optional(),
  stepsCompleted: z.number().int().optional(),
  stepsTotal: z.number().int().optional(),
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
  cacheRead: z.number().nonnegative().optional(),
}) satisfies z.ZodType<JobProgressSnapshot>;

/** Dual-read: accept v1 and v2 payloads on the same schemas. */
export const jobEventSchemaVersionSchema = z.union([
  z.literal(JOB_EVENT_SCHEMA_VERSION_V1),
  z.literal(JOB_EVENT_SCHEMA_VERSION),
]) satisfies z.ZodType<JobEventSchemaVersion>;

export const jobSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: jobEventStatusSchema,
  kind: jobEventKindSchema,
  priority: z.number(),
  worktreePath: z.string().optional(),
  workerAgentId: z.string().optional(),
  resultSummary: z.string().optional(),
  progress: jobProgressSnapshotSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}) satisfies z.ZodType<JobSnapshot>;

export const jobUpdatedEventSchema = z.object({
  type: z.literal('job.updated'),
  schemaVersion: jobEventSchemaVersionSchema,
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
  schemaVersion: jobEventSchemaVersionSchema,
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
  digest: z.boolean().optional(),
}) satisfies z.ZodType<JobInboxEvent>;
