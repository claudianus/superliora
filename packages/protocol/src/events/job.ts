/**
 * Conductor Job desk protocol events (`job.*`).
 * Journal readers that do not understand these types should ignore-unknown.
 * schemaVersion is on the event payload for forward-compatible migration.
 *
 * Snapshots report actual worker execution and operator-controlled Git delivery.
 */

import { z } from 'zod';
import { tokenUsageSchema, type TokenUsage } from './common';

export const JOB_EVENT_SCHEMA_VERSION = 4 as const;
/** v1 payloads stay parseable for journal dual-read (contract §10). */
export const JOB_EVENT_SCHEMA_VERSION_V1 = 1 as const;
/** v2 payloads stay parseable for journal dual-read. */
export const JOB_EVENT_SCHEMA_VERSION_V2 = 2 as const;
/** v3 payloads stay parseable for journal dual-read. */
export const JOB_EVENT_SCHEMA_VERSION_V3 = 3 as const;
export type JobEventSchemaVersion =
  | typeof JOB_EVENT_SCHEMA_VERSION_V1
  | typeof JOB_EVENT_SCHEMA_VERSION_V2
  | typeof JOB_EVENT_SCHEMA_VERSION_V3
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
  | 'research'
  | 'implement'
  | 'verify'
  | 'mission'
  | 'merge'
  | 'push'
  | 'desk';

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
  /** Completed steps when the worker reports a bounded operation. */
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

export interface JobBriefPreview {
  readonly successCriteria?: readonly string[];
  readonly mustNotTouch?: readonly string[];
  readonly verificationCommands?: readonly string[];
}

export interface JobLandReceiptSnapshot {
  readonly mergeSha?: string;
  readonly branch?: string;
  readonly merged?: boolean;
}

export type JobIsolationSnapshot = 'worktree' | 'checkout' | 'none';

/**
 * Operator-visible effect contract (schemaVersion 4).
 * Fields are facts; `chip` / `summary` are ready-to-render lines.
 */
export interface JobEffectPreview {
  readonly isolation: JobIsolationSnapshot;
  /** Job Deck chip, e.g. `checkout` or `worktree · web`. */
  readonly chip: string;
  /** ACK / inspect line, e.g. `general · this checkout · Conductor judged`. */
  readonly summary: string;
}

/** Operator land disposition after a coding session finishes (schemaVersion 4, optional). */
export type JobLandChoiceSnapshot = 'pending' | 'keep' | 'apply' | 'pr';

export interface JobSnapshot {
  readonly id: string;
  readonly title: string;
  readonly status: JobEventStatus;
  readonly kind: JobEventKind;
  readonly priority: number;
  readonly worktreePath?: string;
  /** Isolated branch name (`liora/…`) when a worktree is assigned. */
  readonly worktreeBranch?: string;
  /** Product git toplevel frozen at job create (schemaVersion 4). */
  readonly repoRoot?: string;
  /** Human resume handle, e.g. `auth-refactor`. */
  readonly sessionName?: string;
  /** Keep / Apply / PR after the worker finishes. */
  readonly landChoice?: JobLandChoiceSnapshot;
  /** Dev-server port offset (0 → 3000, 1 → 3001, …). */
  readonly portOffset?: number;
  readonly workerAgentId?: string;
  readonly resultSummary?: string;
  readonly filesChanged?: readonly string[];
  readonly usage?: TokenUsage;
  /** Worker progress (schemaVersion 2; absent on v1 snapshots). */
  readonly progress?: JobProgressSnapshot;
  /** ISO timestamp when the job entered the ledger (queue). */
  readonly createdAt?: string;
  /** ISO timestamp of the last ledger mutation for this job. */
  readonly updatedAt?: string;
  /** Structured brief excerpt for Inbox / Intent Composer (schemaVersion 3). */
  readonly briefPreview?: JobBriefPreview;
  /** Post-merge land receipt summary (schemaVersion 3). */
  readonly landReceipt?: JobLandReceiptSnapshot;
  /** Isolation / track / surface provenance (schemaVersion 4). */
  readonly effectPreview?: JobEffectPreview;
  readonly parentJobId?: string;
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
    | 'job.interrupted'
    | 'recovery.held'
    | 'recovery.reattach_failed';
  readonly jobId: string;
  readonly status: JobEventStatus;
  readonly title: string;
  readonly summary?: string;
  /** True when this event is a desk-digest escalation card (v2). */
  readonly digest?: boolean;
  /** Suggested host actions for Inbox drawer CTAs (schemaVersion 3). */
  readonly actionHints?: readonly string[];
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
  'research',
  'implement',
  'verify',
  'mission',
  'merge',
  'push',
  'desk',
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

export const jobBriefPreviewSchema = z.object({
  successCriteria: z.array(z.string()).readonly().optional(),
  mustNotTouch: z.array(z.string()).readonly().optional(),
  verificationCommands: z.array(z.string()).readonly().optional(),
}) satisfies z.ZodType<JobBriefPreview>;

export const jobLandReceiptSnapshotSchema = z.object({
  mergeSha: z.string().optional(),
  branch: z.string().optional(),
  merged: z.boolean().optional(),
}) satisfies z.ZodType<JobLandReceiptSnapshot>;

export const jobIsolationSnapshotSchema = z.enum(['worktree', 'checkout', 'none']);

export const jobEffectPreviewSchema = z.object({
  isolation: jobIsolationSnapshotSchema,
  chip: z.string(),
  summary: z.string(),
}) satisfies z.ZodType<JobEffectPreview>;

/** Dual-read: accept v1–v4 payloads on the same schemas. */
export const jobEventSchemaVersionSchema = z.union([
  z.literal(JOB_EVENT_SCHEMA_VERSION_V1),
  z.literal(JOB_EVENT_SCHEMA_VERSION_V2),
  z.literal(JOB_EVENT_SCHEMA_VERSION_V3),
  z.literal(JOB_EVENT_SCHEMA_VERSION),
]) satisfies z.ZodType<JobEventSchemaVersion>;

export const jobLandChoiceSnapshotSchema = z.enum(['pending', 'keep', 'apply', 'pr']);

export const jobSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: jobEventStatusSchema,
  kind: jobEventKindSchema,
  priority: z.number(),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
  repoRoot: z.string().optional(),
  sessionName: z.string().optional(),
  landChoice: jobLandChoiceSnapshotSchema.optional(),
  portOffset: z.number().int().nonnegative().optional(),
  workerAgentId: z.string().optional(),
  resultSummary: z.string().optional(),
  filesChanged: z.array(z.string()).readonly().optional(),
  usage: tokenUsageSchema.optional(),
  progress: jobProgressSnapshotSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  briefPreview: jobBriefPreviewSchema.optional(),
  landReceipt: jobLandReceiptSnapshotSchema.optional(),
  effectPreview: jobEffectPreviewSchema.optional(),
  parentJobId: z.string().optional(),
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
    'recovery.held',
    'recovery.reattach_failed',
  ]),
  jobId: z.string(),
  status: jobEventStatusSchema,
  title: z.string(),
  summary: z.string().optional(),
  digest: z.boolean().optional(),
  actionHints: z.array(z.string()).readonly().optional(),
}) satisfies z.ZodType<JobInboxEvent>;
