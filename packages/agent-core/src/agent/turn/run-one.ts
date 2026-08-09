import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { isAbortError } from '../../loop/errors';
import type { LoopTurnStopReason } from '../../loop/index';
import type { AgentEvent, TurnEndedEvent, TurnEndReason } from '../../rpc/events';
import type { TelemetryPropertyValue } from '../../telemetry';
import { isUserCancellation } from '../../utils/abort';
import type { StreamingThinkScrubber } from '../../utils/think-scrubber';
import { buildTurnPrefixMaterial } from '../cache';
import type { PromptOrigin } from '../context';
import { applySessionSmartAutoForTurn } from '../routing';
import {
  TurnTelemetry,
  classifyApiError,
  currentTurnInputTokens,
} from './telemetry';
import { summarizeTurnError } from './error-recovery';
import { applyUserPromptHook } from './prompt-hook';
import { closeAbandonedToolExchangeAtTurnEnd, createTurnLoopDispatch } from './loop-dispatch';
import { runTurnStepLoop } from './step-loop';
import type { ActiveTurn, TurnEndResult } from './types';
import { recordTurnMemory } from './goal-loop';

export interface TurnRunOneDeps {
  readonly agent: Agent;
  readonly turnTelemetry: TurnTelemetry;
  readonly assistantThinkScrubber: StreamingThinkScrubber;
  readonly flushSteerBuffer: () => boolean;
  getActiveTurn(): 'resuming' | ActiveTurn | null;
  /**
   * Release the active-turn slot before `turn.ended` is emitted so a prompt
   * that races the end event starts the next turn instead of being rejected
   * with `turn.agent_busy`.
   */
  readonly releaseActiveTurn: (ended: TurnEndedEvent) => void;
}

export async function runOneTurnFlow(
  deps: TurnRunOneDeps,
  turnId: number,
  input: readonly ContentPart[],
  origin: PromptOrigin,
  signal: AbortSignal,
): Promise<TurnEndResult> {
  const { agent, turnTelemetry, assistantThinkScrubber } = deps;
  assistantThinkScrubber.reset();
  const telemetryMode = turnTelemetry.telemetryMode();
  turnTelemetry.resetForTurn(turnId, telemetryMode);
  agent.telemetry.track('turn_started', { mode: telemetryMode });
  agent.fullCompaction.resetForTurn();
  agent.cacheFreezeGuard.freeze(buildTurnPrefixMaterial(agent.tools.enabledTools));
  agent.usage.beginTurn();
  applySessionSmartAutoForTurn(agent, input);
  agent.emitEvent({ type: 'turn.started', turnId, origin });
  agent.context.appendUserMessage(input, origin);

  const startedAt = Date.now();
  let ended: TurnEndedEvent;
  let blockedByUserPromptHook = false;
  let completedStopReason: LoopTurnStopReason | undefined;
  let errorEvent: AgentEvent | undefined;
  try {
    await agent.fullCompaction.prepareForTurn(signal);
    const promptHookEnded = await applyUserPromptHook(
      agent,
      turnId,
      input,
      origin,
      signal,
      startedAt,
    );
    if (promptHookEnded !== undefined) {
      ended = promptHookEnded.event;
      blockedByUserPromptHook = promptHookEnded.blocked;
    } else {
      const stopReason = await runTurnStepLoop(
        {
          agent: deps.agent,
          turnTelemetry: deps.turnTelemetry,
          flushSteerBuffer: deps.flushSteerBuffer,
          buildDispatchEvent: () =>
            createTurnLoopDispatch(
              {
                agent: deps.agent,
                turnTelemetry: deps.turnTelemetry,
                assistantThinkScrubber: deps.assistantThinkScrubber,
                getActiveTurn: (...args) => deps.getActiveTurn(...args),
              },
              turnId,
            ),
        },
        turnId,
        signal,
      );
      completedStopReason = stopReason;
      const reason: TurnEndReason =
        stopReason === 'aborted' ? 'cancelled' : stopReason === 'filtered' ? 'filtered' : 'completed';
      ended = {
        type: 'turn.ended',
        turnId,
        reason,
        durationMs: Date.now() - startedAt,
        ...(reason === 'cancelled'
          ? { cancelledByUser: isUserCancellation(signal.reason) }
          : {}),
      };
    }
  } catch (error) {
    if (isAbortError(error)) {
      ended = {
        type: 'turn.ended',
        turnId,
        reason: 'cancelled',
        durationMs: Date.now() - startedAt,
        cancelledByUser: isUserCancellation(signal.reason),
      };
    } else {
      const summary = summarizeTurnError(error, turnId);
      void agent.hooks?.fireAndForgetTrigger('StopFailure', {
        matcherValue: summary.name,
        inputData: { errorType: summary.name, errorMessage: summary.message },
      });
      ended = { type: 'turn.ended', turnId, reason: 'failed', error: summary, durationMs: Date.now() - startedAt };
      errorEvent = { type: 'error', ...summary };
      if (turnTelemetry.shouldTrackApiError(turnId)) {
        const classification = classifyApiError(error, summary);
        const properties: Record<string, TelemetryPropertyValue> = {
          error_type: classification.errorType,
          model: agent.config.model,
          retryable: summary.retryable,
          duration_ms: Date.now() - startedAt,
        };
        if (classification.statusCode !== undefined) {
          properties['status_code'] = classification.statusCode;
        }
        const inputTokens = currentTurnInputTokens(agent.usage.data().currentTurn);
        if (inputTokens !== undefined) {
          properties['input_tokens'] = inputTokens;
        }
        agent.telemetry.track('api_error', properties);
      }
    }
  }
  closeAbandonedToolExchangeAtTurnEnd(agent, ended);
  if (agent.turn.currentId === turnId) {
    agent.usage.endTurn();
  }
  agent.fileSnapshots?.commitTurn(String(turnId));
  if (ended.reason === 'cancelled' && isUserCancellation(signal.reason)) {
    void agent.hooks?.fireAndForgetTrigger('Interrupt', {
      inputData: { turnId, reason: 'cancelled' },
    });
  }
  // Invariant: the session must be idle the moment turn.ended fires. Release
  // the slot synchronously before emitting — awaiting anything (e.g. turn
  // memory capture) in between lets a racing prompt hit `turn.agent_busy`.
  deps.releaseActiveTurn(ended);
  agent.emitEvent(ended);
  if (errorEvent !== undefined) {
    agent.emitEvent(errorEvent);
  }
  await recordTurnMemory(agent, turnId, input, ended.reason);
  agent.dream?.maybeSchedule();
  agent.refine?.maybeAutoRefine('turn');
  agent.skillify?.maybeSchedule();
  if (ended.reason !== 'completed') {
    turnTelemetry.trackTurnInterrupted(turnId, turnTelemetry.currentStepForTurn(turnId));
  }
  turnTelemetry.cleanupTurn(turnId);
  agent.cacheFreezeGuard.clear();
  agent.toolParallelStatus.clearTurn();
  return { event: ended, stopReason: completedStopReason, blockedByUserPromptHook };
}
