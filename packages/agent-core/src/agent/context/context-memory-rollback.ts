import { estimateTokensForMessages } from '../../utils/tokens';
import type { ContextMemoryHost } from './context-memory-host';
import type { ContextMessage } from './types';

/**
 * Roll back every context message appended by a failed turn attempt so the
 * provider-recovery retry starts from the pre-turn history instead of
 * duplicating the user prompt and per-attempt injections.
 *
 * Unlike {@link undoContextMessages} this removes injection-origin messages
 * too: the failed attempt's reminders are rebuildable ephemera that must not
 * accumulate one copy per retry.
 */
export function rollbackAttemptContextMessages(
  host: ContextMemoryHost,
  turnId: number,
  historyLength: number,
): boolean {
  const target = Math.max(0, historyLength);
  if (host.history.length <= target) return false;

  host.agent.records.logRecord({
    type: 'context.rollback_attempt',
    turnId,
    historyLength: target,
  });

  const removedMessages = new Set<ContextMessage>();
  for (let i = host.history.length - 1; i >= target; i--) {
    const message = host.history[i];
    if (message === undefined) continue;
    removedMessages.add(message);
    host.history.splice(i, 1);
    host.agent.injection.onContextMessageRemoved(i);
    if (i < host.tokenCountCoveredMessageCount) {
      host.tokenCountCoveredMessageCount--;
      host.tokenCount -= estimateTokensForMessages([message]);
    }
  }

  host.markContextChanged();
  host.agent.replayBuilder.removeLastMessages(removedMessages);
  host.openSteps.clear();
  host.pendingToolResultIds.clear();
  host.deferredMessages = [];
  host.agent.microCompaction.reset(host.history.length);
  host.agent.emitStatusUpdated();
  return true;
}
