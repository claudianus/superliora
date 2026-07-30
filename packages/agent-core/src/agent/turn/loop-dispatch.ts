/**
 * Loop event dispatch — extracted from TurnFlow.
 *
 * Bridges internal loop events to external AgentEvents, resolves the
 * first-request gate, and closes abandoned tool exchanges at turn end.
 */

import type { Agent } from '..';
import type { AgentEvent, TurnEndedEvent } from '../../rpc/events';
import {
  createLoopEventDispatcher,
  type LoopEvent,
  type LoopRecordedEvent,
} from '../../loop/index';
import type { StreamingThinkScrubber } from '../../utils/think-scrubber';
import { mapLoopEvent } from './event-handler';
import { abandonedToolResultOutput } from './error-recovery';
import type { ActiveTurn } from './types';
import type { TurnTelemetry } from './telemetry';

export interface LoopDispatchDeps {
  readonly agent: Agent;
  readonly turnTelemetry: TurnTelemetry;
  readonly assistantThinkScrubber: StreamingThinkScrubber;
  readonly getActiveTurn: () => 'resuming' | ActiveTurn | null;
}

export function createTurnLoopDispatch(deps: LoopDispatchDeps, turnId: number) {
  return createLoopEventDispatcher({
    appendTranscriptRecord: async (event: LoopRecordedEvent) => {
      deps.agent.context.appendLoopEvent(event);
      // A tool intent record must be durable (fsync'd) BEFORE the tool runs,
      // so a crash mid-execution leaves proof that the side effect was
      // attempted. The loop awaits this dispatch before starting execution,
      // so flushing here establishes the durability boundary without
      // blocking read-only tool calls.
      if (event.type === 'tool.intend') {
        await deps.agent.records.flush();
      }
    },
    emitLiveEvent: (event: LoopEvent) => {
      noteFirstRequestEvent(deps.getActiveTurn, event);
      deps.turnTelemetry.trackLoopTelemetry(event, turnId);
      const mapped = mapLiveLoopEvent(deps.assistantThinkScrubber, event, turnId);
      if (mapped !== undefined) deps.agent.emitEvent(mapped);
    },
  });
}

export function mapLiveLoopEvent(
  assistantThinkScrubber: StreamingThinkScrubber,
  event: LoopEvent,
  turnId: number,
): AgentEvent | undefined {
  if (event.type === 'text.delta') {
    const scrubbed = assistantThinkScrubber.feed(event.delta);
    if (scrubbed.length === 0) return undefined;
    return {
      type: 'assistant.delta',
      turnId,
      delta: scrubbed,
    };
  }
  return mapLoopEvent(event, turnId);
}

export function noteFirstRequestEvent(
  getActiveTurn: () => 'resuming' | ActiveTurn | null,
  event: LoopEvent,
): void {
  switch (event.type) {
    case 'step.end':
    case 'content.part':
    case 'tool.call':
    case 'text.delta':
    case 'thinking.delta':
    case 'tool.call.delta': {
      const active = getActiveTurn();
      if (active === null || active === 'resuming') return;
      active.firstRequest.resolve();
      return;
    }
    default:
      return;
  }
}

export function closeAbandonedToolExchangeAtTurnEnd(agent: Agent, ended: TurnEndedEvent): void {
  try {
    const closed = agent.context.closeAbandonedToolExchange(abandonedToolResultOutput(ended));
    if (closed === 0) return;
    agent.log.warn('closed abandoned tool exchange at turn end', {
      turnId: ended.turnId,
      reason: ended.reason,
      closed,
    });
    agent.telemetry.track('tool_exchange_abandoned', {
      reason: ended.reason,
      closed,
    });
  } catch (error) {
    agent.log.warn('failed to close abandoned tool exchange', { error });
  }
}
