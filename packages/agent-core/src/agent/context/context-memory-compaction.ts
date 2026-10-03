import { estimateTokensForMessages } from '../../utils/tokens';
import type { CompactionInput, CompactionResult } from '../compaction';
import type { ContextMemoryHost } from './context-memory-host';
import { isRealUserPromptOrigin, type ContextMessage } from './types';

export function applyContextCompaction(host: ContextMemoryHost, input: CompactionInput): CompactionResult {
  if (!Number.isInteger(input.compactedCount) || input.compactedCount < 1 || input.compactedCount > host.history.length) {
    throw new RangeError('Compaction prefix is outside the current conversation.');
  }
  const prefix = host.history.slice(0, input.compactedCount);
  const pending = new Set<string>();
  for (const message of prefix) {
    if (message.role === 'assistant') for (const call of message.toolCalls) pending.add(call.id);
    if (message.role === 'tool' && message.toolCallId !== undefined) pending.delete(message.toolCallId);
  }
  if (pending.size > 0) throw new Error('Compaction cannot discard an unresolved tool exchange.');
  const userPrompt = prefix.findLast((message) => message.role === 'user' && isRealUserPromptOrigin(message.origin));
  const contextSummary = input.contextSummary ?? `Conversation summary:\n${input.summary}`;
  const summary: ContextMessage = { role: 'user', content: [{ type: 'text', text: contextSummary }], toolCalls: [], origin: { kind: 'compaction_summary' } };
  const retained = host.history.slice(input.compactedCount);
  host.history = userPrompt === undefined ? [summary, ...retained] : [userPrompt, summary, ...retained];
  for (const id of host.openSteps.keys()) host.compactedOpenSteps.add(id);
  host.resyncPendingToolResultIdsFromHistory();
  host.tokenCount = estimateTokensForMessages(host.history);
  host.tokenCountCoveredMessageCount = host.history.length;
  const result: CompactionResult = { ...input, contextSummary, tokensAfter: host.tokenCount, keptUserMessageCount: userPrompt === undefined ? 0 : 1 };
  host.agent.records.logRecord({ type: 'context.apply_compaction', ...result });
  host.agent.replayBuilder.patchLast('compaction', { result });
  host.agent.emitStatusUpdated();
  return result;
}
