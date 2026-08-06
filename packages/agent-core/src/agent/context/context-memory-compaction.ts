import { estimateTokens, estimateTokensForMessages } from '../../utils/tokens';
import {
  COMPACTION_ELISION_VARIANT,
  buildCompactionElisionText,
  collectCompactableUserMessages,
  resolveCompactionUserMessageBudget,
  selectCompactionUserMessages,
  selectRecentUserMessages,
  type CompactionInput,
  type CompactionResult,
} from '../compaction';
import type { ContextMemoryHost } from './context-memory-host';
import type { ContextMessage } from './types';

/** Token budget for the leading user messages kept verbatim across compaction. */
export const FROZEN_HEAD_MAX_TOKENS = 2000;

export function applyContextCompaction(
  host: ContextMemoryHost,
  input: CompactionInput,
): CompactionResult {
  const retainedSuffix = host.history.slice(input.compactedCount);
  const hasRetainedLiveContext = retainedSuffix.some(
    (message) => message.origin?.kind !== 'injection',
  );
  const compactableUserMessages = collectCompactableUserMessages(
    host.history.slice(0, input.compactedCount),
  );
  const restoreTailOnly =
    host.agent.records.restoring !== null && input.keptHeadUserMessageCount === undefined;
  const maxContextTokens = host.agent.config.modelCapabilities.max_context_tokens;
  const userMessageBudget = resolveCompactionUserMessageBudget(maxContextTokens);
  // Frozen zone: the configured leading history slots include one slot for
  // the provider's system prefix, so the default of 2 preserves the first
  // real user message. Keep the selected user messages verbatim so intent
  // survives summarization losslessly and the history prefix stays stable.
  const frozenUserMessageLimit = Math.max(
    0,
    Math.floor(host.agent.fullCompaction.strategy.frozenZoneSize) - 1,
  );
  const frozenHead: ContextMessage[] = [];
  let frozenHeadTokens = 0;
  if (hasRetainedLiveContext) {
    for (const candidate of compactableUserMessages.slice(0, frozenUserMessageLimit)) {
      const candidateTokens = estimateTokensForMessages([candidate]);
      if (
        candidateTokens > FROZEN_HEAD_MAX_TOKENS ||
        frozenHeadTokens + candidateTokens > FROZEN_HEAD_MAX_TOKENS
      ) {
        break;
      }
      frozenHead.push(candidate);
      frozenHeadTokens += candidateTokens;
    }
  }
  const selection = hasRetainedLiveContext
    ? { head: frozenHead, tail: [], elided: false, omittedTokens: 0 }
    : restoreTailOnly
      ? {
          head: [],
          tail: selectRecentUserMessages(compactableUserMessages, userMessageBudget),
          elided: false,
          omittedTokens: 0,
        }
      : selectCompactionUserMessages(compactableUserMessages, userMessageBudget);
  const elisionMessage: ContextMessage | null = selection.elided
    ? {
        role: 'user',
        content: [{ type: 'text', text: buildCompactionElisionText(selection.omittedTokens) }],
        toolCalls: [],
        origin: { kind: 'injection', variant: COMPACTION_ELISION_VARIANT },
      }
    : null;
  const keptMessages: ContextMessage[] =
    elisionMessage === null
      ? [...selection.head, ...selection.tail]
      : [...selection.head, elisionMessage, ...selection.tail];
  const contextSummary = input.contextSummary ?? input.summary;
  const tokensAfter =
    input.tokensAfter ??
    estimateTokens(contextSummary) +
      estimateTokensForMessages([...keptMessages, ...retainedSuffix]);
  const keptUserMessageCount =
    input.keptUserMessageCount ?? selection.head.length + selection.tail.length;
  const keptHeadUserMessageCount =
    input.keptHeadUserMessageCount ?? (selection.elided ? selection.head.length : undefined);
  const result: CompactionResult = {
    summary: input.summary,
    contextSummary,
    compactedCount: input.compactedCount,
    tokensBefore: input.tokensBefore,
    tokensAfter,
    keptUserMessageCount,
    keptHeadUserMessageCount,
    droppedCount: input.droppedCount,
    algorithmVersion: input.algorithmVersion,
    actions: input.actions,
    rawRefs: input.rawRefs,
    summaryTokens: input.summaryTokens,
    retainedTokens: input.retainedTokens,
    compactedTokens: input.compactedTokens,
    qualityWarnings: input.qualityWarnings,
    qualityWarningCategories: input.qualityWarningCategories,
    parallelBlockCount: input.parallelBlockCount,
    mergeInputTokens: input.mergeInputTokens,
    repairAttempted: input.repairAttempted,
    contextPack: input.contextPack,
  };
  host.agent.records.logRecord({
    type: 'context.apply_compaction',
    ...result,
  });
  host.agent.replayBuilder.patchLast('compaction', {
    result: {
      summary: result.summary,
      contextSummary: result.contextSummary,
      compactedCount: result.compactedCount,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      keptUserMessageCount: result.keptUserMessageCount,
      keptHeadUserMessageCount: result.keptHeadUserMessageCount,
      droppedCount: result.droppedCount,
    },
  });
  const summaryMessage: ContextMessage = {
    role: 'user',
    content: [{ type: 'text', text: contextSummary }],
    toolCalls: [],
    origin: { kind: 'compaction_summary' },
  };
  const isLegacyRestore =
    host.agent.records.restoring !== null &&
    input.keptUserMessageCount === undefined &&
    input.compactedCount < host.history.length;
  host.history = isLegacyRestore
    ? [summaryMessage, ...retainedSuffix]
    : [...keptMessages, summaryMessage, ...retainedSuffix];
  host.openSteps.clear();
  const previouslyPending = new Set(host.pendingToolResultIds);
  const compactionHistoryLength = host.history.length;
  host.resyncPendingToolResultIdsFromHistory();
  // Any tool call awaiting a result before compaction must remain acceptable
  // afterwards, whether its owning assistant survived in the retained tail
  // (still pending) or was summarized away and is now gone from history. The
  // latter case happens when a manual compaction compacts the whole prefix
  // including an open tool exchange (PROBE #4) — without this, a result
  // arriving afterwards is treated as an orphan and silently dropped.
  for (const toolCallId of previouslyPending) {
    host.lateAcceptedToolCallIds.set(toolCallId, compactionHistoryLength);
  }
  // Expire late-accept ids registered before the prefix this compaction
  // just summarized. A result for one of those ids can no longer attach to
  // a visible tool-call message, so keeping it only risks accepting a
  // genuinely stale result later. The newly-registered ids above are
  // preserved because they were just re-registered at the current length.
  const stillPending = host.pendingToolResultIds;
  for (const [id, registeredAt] of host.lateAcceptedToolCallIds) {
    if (registeredAt < compactionHistoryLength && !stillPending.has(id) && !previouslyPending.has(id)) {
      host.lateAcceptedToolCallIds.delete(id);
    }
  }
  host.tokenCount = estimateTokensForMessages(host.history);
  host.tokenCountCoveredMessageCount = host.history.length;
  // Full summarize replaces the cleared prefix; reset micro cutoff so projection
  // does not keep masking a now-rewritten history.
  host.agent.microCompaction.reset();
  host.agent.contextOS.recordCompaction(result);
  // The post-compaction history is
  //   [...keptMessages, summaryMessage, ...retainedSuffix]
  // (or `[summaryMessage, ...retainedSuffix]` for the legacy restore path).
  // A retained-tail message at original index N (N >= compactedCount) lands
  // at `keptHeadCount + 1 + (N - compactedCount)`. The `+1` accounts for the
  // new summary message; `keptHeadCount` is the count of messages kept in
  // front of it, excluding the summary itself. Without this, every
  // DynamicInjector would believe its prior injection lived at a position
  // that has shifted upward by `keptHeadCount`, causing shouldRefresh to
  // fire on turns that did not actually advance past the injection.
  const keptHeadCount = isLegacyRestore ? 0 : selection.head.length;
  host.agent.injection.onContextCompacted(result.compactedCount, keptHeadCount);
  host.agent.emitStatusUpdated();
  return result;
}
