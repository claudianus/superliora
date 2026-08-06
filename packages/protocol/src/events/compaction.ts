import { z } from 'zod';

import { tokenUsageSchema, type TokenUsage } from './common';

export interface CompactionResult {
  readonly summary: string;
  readonly compactedCount: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface CompactionStartedEvent {
  readonly type: 'compaction.started';
  /**
   * `overflow` = reactive recovery after CONTEXT_OVERFLOW (Loop25b).
   * `agent` = the model's own Compact tool call.
   */
  readonly trigger: 'manual' | 'auto' | 'overflow' | 'agent';
  readonly instruction?: string;
  /**
   * `background` means full compaction is summarizing while the turn continues
   * (async pre-rot). Omitted / `blocking` means the UI should treat the session
   * as busy until completion.
   */
  readonly mode?: 'blocking' | 'background';
  /** Effective summarizer model alias after cheap-model resolve (may equal main). */
  readonly modelAlias?: string;
}

export interface CompactionBlockedEvent {
  readonly type: 'compaction.blocked';
  readonly turnId?: number;
}

export interface CompactionCancelledEvent {
  readonly type: 'compaction.cancelled';
}

export interface CompactionCompletedEvent {
  readonly type: 'compaction.completed';
  readonly result: CompactionResult;
}

/**
 * Coarse in-flight phase of a full compaction round. Emitted via the volatile
 * `compaction.progress` event so live clients can render phase-aware progress
 * without journaling intermediate state.
 */
export type CompactionPhase = 'summarizing' | 'repairing' | 'finalizing';

/**
 * Which LLM sub-stream produced this progress tick. Optional so older clients
 * can ignore it; TUI uses it for live transparency (block / merge / repair).
 */
export type CompactionStreamKind = 'summary' | 'block' | 'merge' | 'repair';

export interface CompactionProgressEvent {
  readonly type: 'compaction.progress';
  readonly phase: CompactionPhase;
  /** Incremental summary text streamed from the active compaction LLM call. */
  readonly delta?: string;
  /** Logical stream source within the compaction round. */
  readonly streamKind?: CompactionStreamKind;
  /** 1-based block index when `streamKind` is `block`. */
  readonly blockIndex?: number;
  /** Total parallel blocks when `streamKind` is `block`. */
  readonly blockCount?: number;
  /**
   * Number of parallel summarize blocks that have finished successfully.
   * Optional for older engines; TUI prefers this over time-creep for bar %.
   */
  readonly blocksCompleted?: number;
  /**
   * Engine-computed overall progress in [0, 1). Optional — clients fall back
   * to phase bases when absent. Monotonic within a compaction session.
   */
  readonly fraction?: number;
  /**
   * Wall-clock milliseconds the completed block's summarize LLM call took.
   * Only present on block-completion ticks (`streamKind: 'block'` ticks that
   * carry `blocksCompleted` and no `delta`); absent on streaming deltas and
   * on summary/merge/repair ticks. Optional so older consumers are unaffected.
   */
  readonly blockDurationMs?: number;
  /**
   * Token usage reported by the completed block's summarize call, when the
   * provider returned usage. Emitted alongside `blockDurationMs` so clients
   * can attribute latency and cost per parallel block.
   */
  readonly blockTokens?: TokenUsage;
}

export const compactionResultSchema = z.object({
  summary: z.string(),
  compactedCount: z.number(),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
}) satisfies z.ZodType<CompactionResult>;

export const compactionStartedEventSchema = z.object({
  type: z.literal('compaction.started'),
  // Loop25b: overflow recovery is distinct from threshold pre-rot auto.
  // `agent` covers the model-initiated Compact tool.
  trigger: z.enum(['manual', 'auto', 'overflow', 'agent']),
  instruction: z.string().optional(),
  mode: z.enum(['blocking', 'background']).optional(),
  modelAlias: z.string().optional(),
}) satisfies z.ZodType<CompactionStartedEvent>;

export const compactionBlockedEventSchema = z.object({
  type: z.literal('compaction.blocked'),
  turnId: z.number().optional(),
}) satisfies z.ZodType<CompactionBlockedEvent>;

export const compactionCancelledEventSchema = z.object({
  type: z.literal('compaction.cancelled'),
}) satisfies z.ZodType<CompactionCancelledEvent>;

export const compactionCompletedEventSchema = z.object({
  type: z.literal('compaction.completed'),
  result: compactionResultSchema,
}) satisfies z.ZodType<CompactionCompletedEvent>;

export const compactionPhaseSchema = z.enum([
  'summarizing',
  'repairing',
  'finalizing',
]) satisfies z.ZodType<CompactionPhase>;

export const compactionStreamKindSchema = z.enum([
  'summary',
  'block',
  'merge',
  'repair',
]) satisfies z.ZodType<CompactionStreamKind>;

export const compactionProgressEventSchema = z.object({
  type: z.literal('compaction.progress'),
  phase: compactionPhaseSchema,
  delta: z.string().optional(),
  streamKind: compactionStreamKindSchema.optional(),
  blockIndex: z.number().int().positive().optional(),
  blockCount: z.number().int().positive().optional(),
  // Live TUI bar / "block n/N" — must not be stripped by the wire schema.
  blocksCompleted: z.number().int().nonnegative().optional(),
  fraction: z.number().min(0).max(1).optional(),
  blockDurationMs: z.number().nonnegative().optional(),
  blockTokens: tokenUsageSchema.optional(),
}) satisfies z.ZodType<CompactionProgressEvent>;
