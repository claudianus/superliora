import { createToolMessage } from '@superliora/kosong';

import type { LoopRecordedEvent } from '../../loop';
import { estimateTokensForMessages } from '../../utils/tokens';
import {
  isSwarmToolName,
  maskStaleSwarmToolResults,
} from '../compaction/micro/micro-helpers';
import type { ContextMemoryHost } from './context-memory-host';
import {
  TOOL_INTERRUPTED_ON_RESUME_OUTPUT,
  interruptedWithIntentMessage,
  toolResultOutputForModel,
} from './tool-result-output';
import type { ContextMessage } from './types';

// Synthesize interrupted tool results for any still-open tool calls, closing
// the exchange in place. Called at every replayed step boundary (see the
// `step.begin` case) so a tool call left unresolved mid-history is closed
// exactly where it occurred — otherwise it would keep `hasOpenToolExchange`
// true and strand every later message in `deferredMessages`, so only the
// trailing exchange ends up aligned. `finishResume` runs the same routine once
// more to close a genuine trailing interruption at end of resume, and
// `closeAbandonedToolExchange` reuses it (with a live-turn message) as the
// turn-end teardown. Returns the ids it closed; callers own the logging.
export function closePendingToolResults(
  host: ContextMemoryHost,
  output: string = TOOL_INTERRUPTED_ON_RESUME_OUTPUT,
): string[] {
  if (host.pendingToolResultIds.size === 0) return [];
  const interruptedToolCallIds = [...host.pendingToolResultIds];
  for (const toolCallId of interruptedToolCallIds) {
    // If the call logged a `tool.intend`, execution was at least attempted
    // before the crash — the side effect may have partially or fully applied.
    // Use a sharper message so the model re-reads before redoing the write,
    // rather than assuming the call never ran.
    const intend = host.intendedToolCalls.get(toolCallId);
    const message = intend === undefined ? output : interruptedWithIntentMessage(intend);
    host.appendLoopEvent({
      type: 'tool.result',
      parentUuid: toolCallId,
      toolCallId,
      result: {
        output: message,
        isError: true,
      },
    });
  }
  return interruptedToolCallIds;
}

export function handleContextLoopEvent(host: ContextMemoryHost, event: LoopRecordedEvent): void {
  host.agent.records.logRecord({
    type: 'context.append_loop_event',
    event,
  });
  switch (event.type) {
    case 'step.begin': {
      // A new assistant step means any tool calls still pending from an
      // earlier step were interrupted (the invariant guarantees this never
      // happens live, so this is a no-op outside replay). Close them in place
      // before opening the new step so mid-history gaps stay aligned.
      const closed = closePendingToolResults(host);
      if (closed.length > 0) {
        host.agent.log.warn('closed unresolved tool calls at a step boundary', {
          closed: closed.length,
          toolCallIds: closed.slice(0, 5),
        });
      }
      const message: ContextMessage = {
        role: 'assistant',
        content: [],
        toolCalls: [],
      };
      host.pushHistory(message);
      host.openSteps.set(event.uuid, message);
      return;
    }
    case 'step.end': {
      const openStep = host.openSteps.get(event.uuid);
      host.openSteps.delete(event.uuid);
      if (event.usage !== undefined) {
        const openStepIndex = openStep === undefined ? -1 : host.history.indexOf(openStep);
        const coveredCount =
          openStepIndex === -1 ? host.history.length : openStepIndex + 1;
        const totalUsage =
          event.usage.inputCacheRead +
          event.usage.inputCacheCreation +
          event.usage.inputOther +
          event.usage.output;
        if (totalUsage > 0) {
          host.tokenCount = totalUsage;
        } else {
          // The provider reported zero usage (e.g. content filter). Do not
          // overwrite the accumulated context token count with 0; add an
          // estimate for the newly covered messages so the invariant between
          // tokenCount and tokenCountCoveredMessageCount stays intact.
          const previousCoveredCount = host.tokenCountCoveredMessageCount;
          host.tokenCount += estimateTokensForMessages(
            host.history.slice(previousCoveredCount, coveredCount),
          );
        }
        host.tokenCountCoveredMessageCount = coveredCount;
      }
      host.flushDeferredMessagesIfToolExchangeClosed();
      return;
    }
    case 'content.part': {
      const openStep = host.openSteps.get(event.stepUuid);
      if (openStep === undefined) {
        dropLoopEventWithUnknownStep(host, event);
        return;
      }
      openStep.content.push(event.part);
      return;
    }
    case 'tool.call': {
      const openStep = host.openSteps.get(event.stepUuid);
      if (openStep === undefined) {
        dropLoopEventWithUnknownStep(host, event);
        return;
      }
      openStep.toolCalls.push({
        type: 'function',
        id: event.toolCallId,
        name: event.name,
        arguments: event.args === undefined ? null : JSON.stringify(event.args),
        extras: event.extras,
      });
      host.pendingToolResultIds.add(event.toolCallId);
      host.toolCallNames.set(event.toolCallId, event.name);
      return;
    }
    case 'tool.intend': {
      // Track the intent so resume can reconcile a crash that left the tool
      // call without an ack/result. The intend itself does not add to the
      // message history — it is a durability marker only.
      host.intendedToolCalls.set(event.toolCallId, event);
      return;
    }
    case 'tool.ack': {
      // Execution settled; the side effect completed. Remove the intent so
      // the close-pending path no longer treats it as ambiguous.
      host.intendedToolCalls.delete(event.toolCallId);
      return;
    }
    case 'tool.result': {
      const acceptsLateResult = host.lateAcceptedToolCallIds.has(event.toolCallId);
      if (!host.pendingToolResultIds.has(event.toolCallId) && !acceptsLateResult) return;
      const toolName = host.toolCallNames.get(event.toolCallId);
      host.toolCallNames.delete(event.toolCallId);
      const message = createToolMessage(event.toolCallId, toolResultOutputForModel(event.result));
      host.pushHistory({
        ...message,
        role: 'tool',
        isError: event.result.isError,
      });
      host.pendingToolResultIds.delete(event.toolCallId);
      host.lateAcceptedToolCallIds.delete(event.toolCallId);
      // A result also settles the intend window — clear it so the resume
      // path does not treat a result-bearing call as still ambiguous.
      host.intendedToolCalls.delete(event.toolCallId);
      // Swarm results mask at append time: once a fresh swarm result lands, the
      // earlier swarm results collapse in the stored history exactly once.
      // Projection then stays a pure function of history, so the prompt-cache
      // prefix is never rewritten mid-history by a later projection pass.
      if (isSwarmToolName(toolName)) {
        const masked = maskStaleSwarmToolResults([host.history, host.deferredMessages]);
        if (masked > 0) {
          host.agent.log.debug('masked stale swarm tool results at append', { masked });
        }
      }
      host.flushDeferredMessagesIfToolExchangeClosed();
      return;
    }
  }
}

function dropLoopEventWithUnknownStep(
  host: ContextMemoryHost,
  event: Extract<LoopRecordedEvent, { type: 'content.part' | 'tool.call' }>,
): void {
  host.agent.log.warn('dropped loop event for unknown context step', {
    eventType: event.type,
    stepUuid: event.stepUuid,
    turnId: event.turnId,
    step: event.step,
    openStepCount: host.openSteps.size,
  });
  host.agent.telemetry.track('context_unknown_step_event_dropped', {
    event_type: event.type,
    step: event.step,
    open_step_count: host.openSteps.size,
  });
}
