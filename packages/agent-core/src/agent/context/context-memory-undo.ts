import { ErrorCodes, LioraError } from '../../errors';
import { estimateTokensForMessages } from '../../utils/tokens';
import { formatUndoUnavailableMessage, isRealUserPrompt } from './message-helpers';
import type { ContextMemoryHost } from './context-memory-host';
import type { ContextMessage } from './types';

export function undoContextMessages(host: ContextMemoryHost, count: number): void {
  if (count <= 0) return;
  if (host.history.length === 0) return;

  host.agent.records.logRecord({ type: 'context.undo', count });

  let removedUserCount = 0;
  const removedMessages = new Set<ContextMessage>();
  const hadOpenSteps = host.openSteps.size > 0;
  const hadDeferredMessages = host.deferredMessages.length > 0;
  let stoppedAtBoundary = false;
  for (let i = host.history.length - 1; i >= 0; i--) {
    const message = host.history[i];
    if (message === undefined) continue;
    if (message.origin?.kind === 'compaction_summary') {
      stoppedAtBoundary = true;
      break;
    }

    removedMessages.add(message);
    host.history.splice(i, 1);

    if (i < host.tokenCountCoveredMessageCount) {
      host.tokenCountCoveredMessageCount--;
      host.tokenCount -= estimateTokensForMessages([message]);
    }

    if (isRealUserPrompt(message)) {
      removedUserCount++;
      if (removedUserCount >= count) break;
    }
  }

  if (removedMessages.size > 0 || hadOpenSteps || hadDeferredMessages) {
    host.markContextChanged();
  }
  host.agent.replayBuilder.removeLastMessages(removedMessages);

  host.openSteps.clear();
  host.pendingToolResultIds.clear();
  host.deferredMessages = [];
  host.compactedOpenSteps.clear();
  host.intendedToolCalls.clear();
  host.agent.emitStatusUpdated();

  if (
    !host.agent.records.restoring &&
    (stoppedAtBoundary || removedUserCount < count)
  ) {
    throw new LioraError(
      ErrorCodes.REQUEST_INVALID,
      formatUndoUnavailableMessage(count, removedUserCount, stoppedAtBoundary),
      {
        details: {
          reason: 'undo_limit',
          requestedCount: count,
          undoableCount: removedUserCount,
          stoppedAtCompaction: stoppedAtBoundary,
        },
      },
    );
  }
}

