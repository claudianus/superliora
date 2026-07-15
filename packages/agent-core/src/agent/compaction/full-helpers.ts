/**
 * Pure helpers shared by FullCompaction (summary/token utilities).
 */

import {
  APIEmptyResponseError,
  inputTotal,
  type ChatProvider,
  type GenerateResult,
  type Message,
  type TokenUsage,
} from '@superliora/kosong';

export function extractCompactionSummary(response: GenerateResult): string {
  const summary =
    typeof response.message.content === 'string'
      ? response.message.content
      : response.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

  if (summary.trim().length === 0) {
    throw new APIEmptyResponseError(
      'The compaction response did not contain a non-empty summary.',
    );
  }
  return summary;
}

export function mergeTokenUsage(current: TokenUsage | null, next: TokenUsage): TokenUsage {
  if (current === null) return next;
  return {
    inputOther: current.inputOther + next.inputOther,
    output: current.output + next.output,
    inputCacheRead: current.inputCacheRead + next.inputCacheRead,
    inputCacheCreation: current.inputCacheCreation + next.inputCacheCreation,
  };
}

export function mergeTokenUsageOrNull(
  current: TokenUsage | null,
  next: TokenUsage | null,
): TokenUsage | null {
  if (next === null) return current;
  return mergeTokenUsage(current, next);
}

export function compactionSummaryMessage(summary: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: summary }],
    toolCalls: [],
  };
}

export function usageTelemetryProperties(
  usage: TokenUsage | null,
): { input_tokens?: number; output_tokens?: number } {
  if (usage === null) return {};
  return {
    input_tokens: inputTotal(usage),
    output_tokens: usage.output,
  };
}

export function formatContextManagementCapability(provider: ChatProvider): string {
  const capability = provider.contextManagementCapability;
  if (capability === undefined) return 'none';
  const names = [
    capability.serverSideCompaction === true ? 'server_side_compaction' : undefined,
    capability.toolResultClearing === true ? 'tool_result_clearing' : undefined,
    capability.thinkingBlockClearing === true ? 'thinking_block_clearing' : undefined,
  ].filter((name): name is string => name !== undefined);
  return names.length === 0 ? 'none' : names.join(',');
}

export type CompactionFinishedTelemetryInput = {
  readonly source: string;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly summaryTokens?: number;
  readonly retainedTokens?: number;
  readonly compactedTokens?: number;
  readonly durationMs: number;
  readonly compactedCount: number;
  readonly retryCount: number;
  readonly parallelBlockCount: number;
  readonly qualityWarningCount: number;
  readonly qualityWarningCategories: readonly string[];
  readonly repairAttempted: boolean;
  readonly emergencyBackstopUsed: boolean;
  readonly mergeInputTokens: number;
  readonly providerContextManagement: string;
  readonly contextPackVersion: string;
  readonly contextPackRawRefCount: number;
  readonly contextPackActionCount: number;
  readonly contextPackRetainedMessageCount: number;
  readonly contextOsStatus: string;
  readonly contextOsScore: number;
  readonly contextOsTierCount: number;
  readonly contextOsRehydrationKindCount: number;
  readonly recallEvalScore?: number;
  readonly evidenceIdRecallScore?: number;
  readonly criticalFactCount?: number;
  readonly placeholderItemCount?: number;
  readonly tokensSavedRatio?: number;
  readonly failureSignature?: string;
  readonly recallMemorySavedCount: number;
  readonly round: number;
  readonly thinkingLevel: string;
  readonly usage: TokenUsage | null;
  readonly actionTypes?: string;
  readonly qualityWarnings?: string;
};

function baseCompactionFinishedProperties(
  input: CompactionFinishedTelemetryInput,
): Record<string, string | number | boolean | undefined> {
  return {
    source: input.source,
    tokens_before: input.tokensBefore,
    tokens_after: input.tokensAfter,
    duration_ms: input.durationMs,
    compacted_count: input.compactedCount,
    retry_count: input.retryCount,
    parallel_block_count: input.parallelBlockCount,
    quality_warning_count: input.qualityWarningCount,
    quality_warning_categories: input.qualityWarningCategories.join(','),
    repair_attempted: input.repairAttempted,
    emergency_backstop_used: input.emergencyBackstopUsed,
    merge_input_tokens: input.mergeInputTokens,
    provider_context_management: input.providerContextManagement,
    context_pack_version: input.contextPackVersion,
    context_pack_raw_ref_count: input.contextPackRawRefCount,
    context_pack_action_count: input.contextPackActionCount,
    context_pack_retained_message_count: input.contextPackRetainedMessageCount,
    context_os_status: input.contextOsStatus,
    context_os_score: input.contextOsScore,
    context_os_tier_count: input.contextOsTierCount,
    context_os_rehydration_kind_count: input.contextOsRehydrationKindCount,
    recall_eval_score: input.recallEvalScore,
    evidence_id_recall_score: input.evidenceIdRecallScore,
    critical_fact_count: input.criticalFactCount,
    placeholder_item_count: input.placeholderItemCount,
    tokens_saved_ratio: input.tokensSavedRatio,
    failure_signature: input.failureSignature,
    recall_memory_saved_count: input.recallMemorySavedCount,
    round: input.round,
    thinking_level: input.thinkingLevel,
    ...usageTelemetryProperties(input.usage),
  };
}

export function compactionFinishedTelemetryProperties(
  input: CompactionFinishedTelemetryInput,
): Record<string, string | number | boolean | undefined> {
  return baseCompactionFinishedProperties(input);
}

export function compactionV2FinishedTelemetryProperties(
  input: CompactionFinishedTelemetryInput,
): Record<string, string | number | boolean | undefined> {
  return {
    ...baseCompactionFinishedProperties(input),
    summary_tokens: input.summaryTokens,
    retained_tokens: input.retainedTokens,
    compacted_tokens: input.compactedTokens,
    quality_warning_category_count: input.qualityWarningCategories.length,
    action_types: input.actionTypes ?? '',
    quality_warnings: input.qualityWarnings ?? '',
  };
}

export function isMissingEvidenceQualityFailure(quality: {
  readonly critical: readonly string[];
  readonly warningCategories: readonly string[];
}): boolean {
  return (
    quality.warningCategories.includes('missing_evidence_ids') ||
    quality.critical.some((item) => item.includes('durable evidence'))
  );
}

export type CompactionResultShellInput = {
  readonly summary: string;
  readonly contextSummary: string;
  readonly compactedCount: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly algorithmVersion?: string;
  readonly actions: readonly { readonly type: string; readonly reason: string; readonly messageStart: number; readonly messageEnd: number }[];
  readonly rawRefs: readonly unknown[] | undefined;
  readonly summaryTokens: number;
  readonly retainedTokens: number;
  readonly compactedTokens: number;
  readonly planQualityWarnings: readonly string[];
  readonly qualityWarnings: readonly string[];
  readonly qualityWarningCategories: readonly string[];
  readonly backstopWarnings: readonly string[];
  readonly parallelBlockCount: number;
  readonly mergeInputTokens: number | undefined;
  readonly repairAttempted: boolean;
};

export function mergeQualityWarningLists(
  planWarnings: readonly string[],
  qualityWarnings: readonly string[],
  backstopWarnings: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...planWarnings, ...qualityWarnings, ...backstopWarnings]) {
    const key = item.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function shouldIncludeCompactionQualitySignals(input: {
  readonly warningCategories: readonly string[];
  readonly failureSignature?: string;
}): boolean {
  return input.warningCategories.length > 0 || input.failureSignature !== undefined;
}

export function evidenceRepairSucceeded(input: {
  readonly repairAttempted: boolean;
  readonly evidenceIdRecallScore?: number;
  readonly qualityWarningCategories: readonly string[];
}): boolean {
  if (!input.repairAttempted) return false;
  if (input.qualityWarningCategories.includes('missing_evidence_ids')) return false;
  return input.evidenceIdRecallScore === undefined || input.evidenceIdRecallScore >= 1;
}

export function buildEmergencyBackstopActions<T extends { readonly type: string }>(
  planActions: readonly T[],
  compactedCount: number,
  usedEmergencyBackstop: boolean,
): readonly (T | {
  readonly type: 'emergency_backstop';
  readonly reason: string;
  readonly messageStart: number;
  readonly messageEnd: number;
})[] {
  if (!usedEmergencyBackstop) return planActions;
  return [
    ...planActions,
    {
      type: 'emergency_backstop' as const,
      reason: 'LLM summarizer failed after retries; applied deterministic extractive snapshot',
      messageStart: 0,
      messageEnd: Math.max(0, compactedCount - 1),
    },
  ];
}

export function emergencyBackstopWarnings(usedEmergencyBackstop: boolean): readonly string[] {
  return usedEmergencyBackstop
    ? ['emergency extractive backstop used after LLM summarizer failure']
    : [];
}
