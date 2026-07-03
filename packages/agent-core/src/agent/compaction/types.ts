export interface CompactionResult {
  summary: string;
  compactedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  algorithmVersion?: string;
  actions?: readonly CompactionResultAction[];
  rawRefs?: readonly CompactionResultRawRef[];
  summaryTokens?: number;
  retainedTokens?: number;
  compactedTokens?: number;
  qualityWarnings?: readonly string[];
  qualityWarningCategories?: readonly string[];
  parallelBlockCount?: number;
  mergeInputTokens?: number;
  repairAttempted?: boolean;
  contextPack?: CompactionContextPack;
}

export interface CompactionContextPack {
  readonly version: 'context_pack_v1';
  readonly source: CompactionSource;
  readonly algorithmVersion?: string;
  readonly messageCounts: {
    readonly summary: number;
    readonly compacted: number;
    readonly retained: number;
  };
  readonly tokenBudget: {
    readonly before: number;
    readonly after: number;
    readonly summary: number;
    readonly retained: number;
    readonly compacted: number;
  };
  readonly evidence: {
    readonly rawRefCount: number;
    readonly rawRefKinds: readonly string[];
    readonly actionTypes: readonly string[];
    readonly qualityWarningCount: number;
  };
  readonly controls: {
    readonly parallelBlockCount: number;
    readonly mergeInputTokens: number;
    readonly repairAttempted: boolean;
    readonly providerContextManagement: string;
  };
  readonly contextOS: CompactionContextOS;
}

export type CompactionContextMemoryTier =
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'procedural';

export type CompactionContinuityStatus = 'ready' | 'needs_rehydration' | 'at_risk';

export interface CompactionContextOS {
  readonly version: 'context_os_v0';
  readonly memoryTiers: readonly CompactionContextMemoryTier[];
  readonly retrievalQueries: readonly string[];
  readonly fileHints: readonly string[];
  readonly rehydrationRawRefKinds: readonly string[];
  readonly qualitySignals?: CompactionQualitySignals;
  readonly retrievalSignalCounts?: CompactionRetrievalSignalCounts;
  readonly continuity: {
    readonly status: CompactionContinuityStatus;
    readonly score: number;
    readonly reasons: readonly string[];
  };
}

export type CompactionQualityWarningCategory =
  | 'missing_next_actions'
  | 'missing_file_hints'
  | 'missing_failed_attempts'
  | 'placeholder_only_memory'
  | 'prompt_control_recalled'
  | 'token_growth';

export interface CompactionQualitySignals {
  readonly recallEvalScore: number;
  readonly criticalFactCount: number;
  readonly placeholderItemCount: number;
  readonly tokensSavedRatio: number;
  readonly fileHintRecallScore: number;
  readonly nextActionPreservationScore: number;
  readonly failedAttemptRecallScore: number;
  readonly promptInjectionResistanceScore: number;
  readonly failureSignature?: string;
}

export interface CompactionRetrievalSignalCounts {
  readonly retrievalQueryCount: number;
  readonly fileHintCount: number;
  readonly structuredItemCount: number;
  readonly rawRefKindCount: number;
}

export interface CompactionResultAction {
  readonly type: string;
  readonly reason: string;
  readonly messageStart: number;
  readonly messageEnd: number;
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly toolCallIds?: readonly string[];
  readonly toolNames?: readonly string[];
}

export interface CompactionResultRawRef {
  readonly kind: string;
  readonly messageStart: number;
  readonly messageEnd: number;
  readonly tokens: number;
  readonly toolCallIds?: readonly string[];
  readonly toolNames?: readonly string[];
}

export type CompactionSource = 'manual' | 'auto';

export interface CompactionBeginData {
  instruction?: string;
  source: CompactionSource;
}
