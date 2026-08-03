import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { isAbortError } from '../../loop/errors';
import type { LoopTurnStopReason } from '../../loop/index';
import type { AgentEvent, TurnEndedEvent, TurnEndReason } from '../../rpc/events';
import type { TelemetryPropertyValue } from '../../telemetry';
import { isUserCancellation } from '../../utils/abort';
import { isRetryableProviderFailure } from '../provider-failover';
import {
  GOAL_NO_PROGRESS_SENSOR_ORIGIN,
  GOAL_NO_PROGRESS_STREAK_K,
  formatGoalNoProgressTip,
} from '../goal';
import type { PromptOrigin } from '../context';
import {
  GOAL_PROVIDER_FILTERED_PAUSE_REASON,
  goalFailurePauseReason,
  recoverFromProviderFailure,
  summarizeTurnError,
} from './error-recovery';
import {
  GOAL_CONTINUATION_ORIGIN,
  GOAL_CONTINUATION_PROMPT,
  buildGoalProgressSignature,
} from './goal-driver';
import type { TurnEndResult } from './types';

export interface TurnGoalLoopDeps {
  readonly agent: Agent;
  runOneTurn(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
    standalone: boolean,
  ): Promise<TurnEndResult>;
  allocateTurnId(): number;
  endGoalTurnWithoutModel(
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
  ): Promise<TurnEndedEvent>;
}

/**
 * Drives an active goal as a sequence of ordinary turns — the autonomous
 * equivalent of the user repeatedly typing "continue".
 */
export async function driveGoalTurnLoop(
  deps: TurnGoalLoopDeps,
  firstTurnId: number,
  input: readonly ContentPart[],
  origin: PromptOrigin,
  signal: AbortSignal,
): Promise<TurnEndResult> {
  let turnId = firstTurnId;
  let turnInput = input;
  let turnOrigin = origin;
  while (true) {
    const goalBeforeTurn = deps.agent.goal.getGoal().goal;
    if (goalBeforeTurn?.status === 'active' && goalBeforeTurn.budget.overBudget) {
      await deps.agent.goal.markBlocked({ reason: 'A configured budget was reached' });
      const ended = await deps.endGoalTurnWithoutModel(turnId, turnInput, turnOrigin);
      return { event: ended };
    }

    await deps.agent.goal.incrementTurn();
    let end = await deps.runOneTurn(turnId, turnInput, turnOrigin, signal, false);
    if (end.event.reason === 'failed' && isRetryableProviderFailure(end.event.error)) {
      end = await recoverFromProviderFailure(
        { agent: deps.agent, runOneTurn: (...args) => deps.runOneTurn(...args) },
        turnId,
        turnInput,
        turnOrigin,
        signal,
        end,
      );
    }

    if (end.event.reason === 'cancelled') {
      await deps.agent.goal.pauseOnInterrupt({ reason: 'Paused after interruption' });
      await deps.agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });
      return end;
    }
    if (end.event.reason === 'failed') {
      const reason = goalFailurePauseReason(end.event.error);
      await deps.agent.goal.pauseActiveGoal({ reason });
      await deps.agent.ultrawork.markInterrupted({ reason });
      return end;
    }
    if (end.event.reason === 'filtered') {
      await deps.agent.goal.pauseActiveGoal({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
      await deps.agent.ultrawork.markInterrupted({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
      return end;
    }
    if (end.blockedByUserPromptHook === true) {
      await deps.agent.goal.markBlocked({ reason: 'Blocked by UserPromptSubmit hook' });
      return end;
    }

    const goal = deps.agent.goal.getGoal().goal;
    if (goal === null || goal.status !== 'active') {
      return end;
    }
    if (goal.budget.overBudget) {
      await deps.agent.goal.markBlocked({ reason: 'A configured budget was reached' });
      return end;
    }

    const progressSignature = buildGoalProgressSignature(deps.agent);
    const streak = deps.agent.goal.noteGoalTurnProgress(progressSignature);
    if (streak >= GOAL_NO_PROGRESS_STREAK_K) {
      const tip = formatGoalNoProgressTip(
        streak,
        GOAL_NO_PROGRESS_STREAK_K,
        progressSignature,
      );
      deps.agent.context.appendSystemReminder(
        [
          '<goal_no_progress>',
          `No material progress for ${streak} consecutive goal turns (threshold K=${GOAL_NO_PROGRESS_STREAK_K}).`,
          `Progress signature: ${progressSignature}`,
          'Change approach: re-read open WorkGraph nodes, run real verification, avoid repeating the same failing tool path.',
          'If truly blocked on external input, call UpdateGoal with `blocked`.',
          tip,
          '</goal_no_progress>',
        ].join('\n'),
        { kind: 'injection', variant: GOAL_NO_PROGRESS_SENSOR_ORIGIN },
      );
      // Loop31a: wire warning so TUI can surface stalled named terminal (injection is model-only).
      deps.agent.emitEvent({
        type: 'warning',
        message: tip,
        code: GOAL_NO_PROGRESS_SENSOR_ORIGIN,
      });
      deps.agent.telemetry.track('goal_no_progress', {
        streak,
        threshold: GOAL_NO_PROGRESS_STREAK_K,
      });
    }

    turnId = deps.allocateTurnId();
    turnInput = [{ type: 'text', text: GOAL_CONTINUATION_PROMPT }];
    turnOrigin = GOAL_CONTINUATION_ORIGIN;
  }
}

export async function markUltraworkInterruptedForTurnEnd(
  agent: Agent,
  end: TurnEndResult,
): Promise<void> {
  if (end.event.reason === 'cancelled') {
    await agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });
    return;
  }
  if (end.event.reason === 'failed') {
    await agent.ultrawork.markInterrupted({ reason: goalFailurePauseReason(end.event.error) });
    return;
  }
  if (end.event.reason === 'filtered') {
    await agent.ultrawork.markInterrupted({ reason: GOAL_PROVIDER_FILTERED_PAUSE_REASON });
  }
}

export async function endGoalTurnWithoutModel(
  agent: Agent,
  turnId: number,
  input: readonly ContentPart[],
  origin: PromptOrigin,
  releaseActiveTurn?: () => void,
): Promise<TurnEndedEvent> {
  agent.usage.beginTurn();
  const startedAt = Date.now();
  agent.emitEvent({ type: 'turn.started', turnId, origin });
  agent.context.appendUserMessage(input, origin);
  const ended: TurnEndedEvent = {
    type: 'turn.ended',
    turnId,
    reason: 'completed',
    durationMs: Date.now() - startedAt,
  };
  agent.usage.endTurn();
  agent.fileSnapshots?.commitTurn(String(turnId));
  // Release the turn slot before emitting so a racing prompt is not
  // rejected with `turn.agent_busy` (the goal was just marked blocked, so
  // the worker is done after this event).
  releaseActiveTurn?.();
  agent.emitEvent(ended);
  return ended;
}

export async function recordTurnMemory(
  agent: Agent,
  turnId: number,
  input: readonly ContentPart[],
  reason: TurnEndReason,
): Promise<void> {
  try {
    await agent.memory?.recordTurn({ turnId, input, reason });
  } catch (error) {
    agent.log.warn('liora recall turn capture failed', error);
  }
}

export function isUltraworkSwarmSession(agent: Agent): boolean {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return false;
  const run = ultrawork.getRun();
  return ultrawork.isModeEnabled() && run !== null && run.status === 'running';
}
