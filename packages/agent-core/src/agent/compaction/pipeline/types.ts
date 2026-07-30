/**
 * Shared context interface for compaction pipeline stages.
 *
 * `FullCompaction` satisfies this interface; pipeline stage functions receive
 * it so they can access agent services without importing the full class.
 */

import type { ChatProvider, Message, TokenUsage } from '@superliora/kosong';

import type { Agent } from '../..';
import type { CompactionStrategy } from '../strategy';
import { type CompactionPlanner, type CompactionPlan } from '../plan/planner';
import type { ExtractedFact } from '../memory';
import type { AnchorDocument } from '../full/anchor';
import type { CompactionQualityResult } from '../plan/quality';
import type { CompactionBeginData, CompactionResult } from '../types';

/**
 * Minimal surface the pipeline stages need from the owning FullCompaction.
 */
export interface CompactionPipelineContext {
  readonly agent: Agent;
  readonly strategy: CompactionStrategy;
  extractedFacts: ExtractedFact[];
  anchor: AnchorDocument | null;
  compactionModelAlias: string | undefined;
}

/** Host surface for one compaction round (summarize → repair → assemble). */
export interface FullCompactionRoundHost extends CompactionPipelineContext {
  readonly planner: CompactionPlanner;
  createCompactionProvider(usedContextTokens: number): ChatProvider;
  triggerPreCompactHook(
    data: Readonly<CompactionBeginData>,
    tokenCount: number,
    signal: AbortSignal,
  ): Promise<void>;
  recordCompactionQuality(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
    readonly evidenceRepairAttempted?: boolean;
    readonly evidenceRepairSucceeded?: boolean;
  }): void;
  cancel(): void;
  lastCompactedTokenCount: number | null;
}

/** Host surface for the multi-round compaction worker loop. */
export interface FullCompactionWorkerHost extends FullCompactionRoundHost {
  readonly compacting: {
    abortController: AbortController;
    promise: Promise<void>;
    blockedByTurn: boolean;
  } | null;
  markCompleted(): void;
  syncCompactionBaseline(): void;
  triggerPostCompactHook(
    data: Readonly<CompactionBeginData>,
    result: CompactionResult,
  ): void;
  releaseLockIfOwned(): void;
}

/** Progress weights within one compaction round (sum ≈ 1). */
export const PROGRESS_WEIGHT_PLAN = 0.05;
export const PROGRESS_WEIGHT_BLOCKS = 0.55;
export const PROGRESS_WEIGHT_MERGE = 0.15;
export const PROGRESS_WEIGHT_REPAIR = 0.15;
export const PROGRESS_WEIGHT_FINALIZE = 0.1;

export interface CompactionStreamMeta {
  readonly phase: 'summarizing' | 'repairing' | 'finalizing';
  readonly streamKind: 'summary' | 'block' | 'merge' | 'repair';
  readonly blockIndex?: number;
  readonly blockCount?: number;
  readonly blocksCompleted?: number | (() => number);
  readonly fraction?: number | (() => number);
}

export interface CompactionProgressMeta {
  readonly phase: 'summarizing' | 'repairing' | 'finalizing';
  readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
  readonly blockIndex?: number;
  readonly blockCount?: number;
  readonly blocksCompleted?: number;
  readonly fraction?: number;
  readonly blockDurationMs?: number;
  readonly blockTokens?: TokenUsage;
}

export interface SummarizeInput {
  readonly signal: AbortSignal;
  readonly provider: ChatProvider;
  readonly messagesToCompact: readonly Message[];
  readonly plan: CompactionPlan;
  readonly instruction: string | undefined;
  readonly retryCount: { value: number };
  readonly originalHistory: readonly Message[];
  readonly compactedCount: number;
}

export interface SummarizeOutput {
  summary: string;
  usage: TokenUsage | null;
  parallelBlockCount: number;
  mergeInputTokens: number | undefined;
  compactedCount: number;
  messagesToCompact: readonly Message[];
  usedEmergencyBackstop: boolean;
}

export interface RepairInput {
  readonly signal: AbortSignal;
  readonly provider: ChatProvider;
  readonly messagesToCompact: readonly Message[];
  readonly plan: CompactionPlan;
  readonly instruction: string | undefined;
  readonly quality: CompactionQualityResult;
  readonly summary: string;
  readonly usage: TokenUsage | null;
  readonly archiveGuidance: string;
  readonly compactedCount: number;
  readonly ultraworkSnapshot: unknown;
  readonly usedEmergencyBackstop: boolean;
  readonly contextSummary: string;
  readonly summaryTokens: number;
  readonly retained: readonly Message[];
  readonly retainedTokens: number;
  readonly tokensAfter: number;
}

export interface RepairOutput {
  summary: string;
  usage: TokenUsage | null;
  quality: CompactionQualityResult;
  repairAttempted: boolean;
  contextSummary: string;
  summaryTokens: number;
  retained: readonly Message[];
  retainedTokens: number;
  tokensAfter: number;
}
