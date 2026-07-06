export interface CompactionResult {
  /** Human-facing summary text produced by the compaction model. */
  summary: string;
  /**
   * Exact summary message stored in the live model context. It includes the
   * compaction prefix that tells the next model this is handoff context rather
   * than a real user prompt. Optional for backward compatibility with older
   * wire records, where `summary` was also the model-context text.
   */
  contextSummary?: string;
  compactedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  /**
   * Number of real user messages kept verbatim ahead of the summary in the
   * post-compaction live context.
   */
  keptUserMessageCount?: number;
  /**
   * Of `keptUserMessageCount`, how many messages form the HEAD segment when
   * the selection split into head + tail.
   */
  keptHeadUserMessageCount?: number;
  /**
   * Number of oldest messages trimmed from the summarizer input when the
   * compaction request overflowed the model window.
   */
  droppedCount?: number;
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
  readonly swarmRecallScore?: number;
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

/**
 * Inputs `ContextMemory.applyCompaction` needs to derive a `CompactionResult`.
 */
export type CompactionInput = Pick<CompactionResult, 'summary' | 'compactedCount' | 'tokensBefore'> &
  Partial<Omit<CompactionResult, 'summary' | 'compactedCount' | 'tokensBefore'>>;

export interface CompactionBeginData {
  instruction?: string;
  source: CompactionSource;
}
