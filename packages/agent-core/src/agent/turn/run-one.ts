import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { isAbortError } from '../../loop/errors';
import type { LoopTurnStopReason } from '../../loop/index';
import type { AgentEvent, TurnEndedEvent, TurnEndReason } from '../../rpc/events';
import type { TelemetryPropertyValue } from '../../telemetry';
import { isUserCancellation } from '../../utils/abort';
import { buildTurnToolBlockMaterial } from '../cache';
import type { PromptOrigin } from '../context';
import { TurnTelemetry, classifyApiError, currentTurnInputTokens } from './telemetry';
import { summarizeTurnError } from './error-recovery';
import { closeAbandonedToolExchangeAtTurnEnd, createTurnLoopDispatch } from './loop-dispatch';
import { runTurnStepLoop } from './step-loop';
import type { ActiveTurn, TurnEndResult } from './types';

export interface TurnRunOneDeps {
  readonly agent: Agent;
  readonly turnTelemetry: TurnTelemetry;
  readonly flushSteerBuffer: () => boolean;
  getActiveTurn(): 'resuming' | ActiveTurn | null;
  /** Release ownership before publishing the terminal event. */
  readonly releaseActiveTurn: (ended: TurnEndedEvent) => void;
}

export async function runOneTurnFlow(
  deps: TurnRunOneDeps,
  turnId: number,
  input: readonly ContentPart[],
  origin: PromptOrigin,
  signal: AbortSignal,
): Promise<TurnEndResult> {
  const { agent, turnTelemetry } = deps;
  const startedAt = Date.now();
  let ended: TurnEndedEvent;
  let completedStopReason: LoopTurnStopReason | undefined;
  let errorEvent: AgentEvent | undefined;
  turnTelemetry.resetForTurn(turnId);
  agent.telemetry.track('turn_started', { mode: 'agent' });
  agent.usage.beginTurn();
  agent.emitEvent({ type: 'turn.started', turnId, origin });

  try {
    agent.context.appendUserMessage(input, origin);
    agent.cacheFreezeGuard.freeze(buildTurnToolBlockMaterial(agent.tools.loopTools));
    const stopReason = await runTurnStepLoop({
      agent,
      flushSteerBuffer: deps.flushSteerBuffer,
      buildDispatchEvent: () => createTurnLoopDispatch({
        agent,
        turnTelemetry,
        getActiveTurn: () => deps.getActiveTurn(),
      }, turnId),
    }, turnId, signal);
    completedStopReason = stopReason;
    const reason: TurnEndReason = stopReason === 'aborted'
      ? 'cancelled'
      : stopReason === 'filtered' ? 'filtered' : 'completed';
    ended = {
      type: 'turn.ended',
      turnId,
      reason,
      durationMs: Date.now() - startedAt,
      ...(reason === 'cancelled' ? { cancelledByUser: isUserCancellation(signal.reason) } : {}),
      ...(stopReason === 'max_tokens' ? { stopReason } : {}),
    };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      ended = {
        type: 'turn.ended', turnId, reason: 'cancelled',
        durationMs: Date.now() - startedAt,
        cancelledByUser: isUserCancellation(signal.reason),
      };
    } else {
      const summary = summarizeTurnError(error, turnId);
      ended = {
        type: 'turn.ended', turnId, reason: 'failed', error: summary,
        durationMs: Date.now() - startedAt,
      };
      errorEvent = { type: 'error', ...summary };
      if (turnTelemetry.shouldTrackApiError(turnId)) {
        const classification = classifyApiError(error, summary);
        const properties: Record<string, TelemetryPropertyValue> = {
          error_type: classification.errorType,
          model: agent.config.model,
          retryable: summary.retryable,
          duration_ms: Date.now() - startedAt,
        };
        if (classification.statusCode !== undefined) properties['status_code'] = classification.statusCode;
        const inputTokens = currentTurnInputTokens(agent.usage.data().currentTurn);
        if (inputTokens !== undefined) properties['input_tokens'] = inputTokens;
        agent.telemetry.track('api_error', properties);
      }
    }
  }

  try {
    closeAbandonedToolExchangeAtTurnEnd(agent, ended);
  } catch (error) {
    const summary = summarizeTurnError(error, turnId);
    ended = {
      type: 'turn.ended', turnId, reason: 'failed', error: summary,
      durationMs: Date.now() - startedAt,
    };
    errorEvent = { type: 'error', ...summary };
  }
  agent.usage.endTurn();
  if (ended.reason !== 'completed') {
    turnTelemetry.trackTurnInterrupted(turnId, turnTelemetry.currentStepForTurn(turnId));
  }
  turnTelemetry.cleanupTurn(turnId);
  agent.cacheFreezeGuard.clear();
  agent.toolParallelStatus.clearTurn();
  deps.releaseActiveTurn(ended);
  agent.emitEvent(ended);
  if (errorEvent !== undefined) agent.emitEvent(errorEvent);
  return { event: ended, stopReason: completedStopReason };
}
