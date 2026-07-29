/**
 * Error recovery helpers — extracted from TurnFlow.
 *
 * Contains error summarization, goal failure pause-reason derivation,
 * cancelled-turn construction, and abandoned-tool-exchange messaging.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import {
  ErrorCodes,
  type LioraErrorPayload,
  toKimiErrorPayload,
} from '#/errors';
import type { TurnEndedEvent } from '../../rpc/events';
import { isUserCancellation } from '../../utils/abort';
import type { PromptOrigin } from '../context';
import type { TurnEndResult } from './index';
import {
  isRetryableProviderFailure,
  resolveProviderRecovery,
  type ProviderRecoveryState,
} from '../provider-failover';
import { isAbortError } from '../../loop/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LLM_NOT_SET_MESSAGE = 'LLM not set, run /login or /provider to connect a model';

const GOAL_RATE_LIMIT_PAUSE_REASON = 'Paused after provider rate limit';
const GOAL_PROVIDER_CONNECTION_PAUSE_PREFIX = 'Paused after provider connection error';
const GOAL_PROVIDER_AUTH_PAUSE_PREFIX = 'Paused after provider authentication error';
const GOAL_PROVIDER_API_PAUSE_PREFIX = 'Paused after provider API error';
const GOAL_MODEL_CONFIG_PAUSE_PREFIX = 'Paused after model configuration error';
const GOAL_RUNTIME_PAUSE_PREFIX = 'Paused after runtime error';
export const GOAL_PROVIDER_FILTERED_PAUSE_REASON = 'Paused after provider safety policy block';

// ---------------------------------------------------------------------------
// Error summarization
// ---------------------------------------------------------------------------

export function summarizeTurnError(error: unknown, turnId: number): LioraErrorPayload {
  const payload = toKimiErrorPayload(error);
  const details = { ...payload.details, turnId };

  // Substitute a friendlier TUI-aware message for model-not-configured.
  if (payload.code === 'model.not_configured') {
    return { ...payload, message: LLM_NOT_SET_MESSAGE, details };
  }

  return { ...payload, details };
}

// ---------------------------------------------------------------------------
// Goal failure pause reasons
// ---------------------------------------------------------------------------

export function goalFailurePauseReason(error: LioraErrorPayload | undefined): string {
  if (error?.code === ErrorCodes.PROVIDER_RATE_LIMIT) return GOAL_RATE_LIMIT_PAUSE_REASON;
  if (error?.code === ErrorCodes.PROVIDER_CONNECTION_ERROR) {
    return pauseReasonWithMessage(GOAL_PROVIDER_CONNECTION_PAUSE_PREFIX, error.message);
  }
  if (error?.code === ErrorCodes.PROVIDER_AUTH_ERROR) {
    return pauseReasonWithMessage(GOAL_PROVIDER_AUTH_PAUSE_PREFIX, error.message);
  }
  if (error?.code === ErrorCodes.PROVIDER_API_ERROR) {
    return pauseReasonWithMessage(GOAL_PROVIDER_API_PAUSE_PREFIX, error.message);
  }
  if (
    error?.code === ErrorCodes.MODEL_NOT_CONFIGURED ||
    error?.code === ErrorCodes.MODEL_CONFIG_INVALID
  ) {
    return pauseReasonWithMessage(GOAL_MODEL_CONFIG_PAUSE_PREFIX, error.message);
  }
  return pauseReasonWithMessage(GOAL_RUNTIME_PAUSE_PREFIX, error?.message);
}

function pauseReasonWithMessage(prefix: string, message: string | undefined): string {
  return message === undefined || message.length === 0 ? prefix : `${prefix}: ${message}`;
}

// ---------------------------------------------------------------------------
// Cancelled turn result
// ---------------------------------------------------------------------------

export function cancelledTurnEndResult(turnId: number, signal: AbortSignal): TurnEndResult {
  return {
    event: {
      type: 'turn.ended',
      turnId,
      reason: 'cancelled',
      durationMs: 0,
      cancelledByUser: isUserCancellation(signal.reason),
    },
  };
}

// ---------------------------------------------------------------------------
// Abandoned tool exchange
// ---------------------------------------------------------------------------

export function abandonedToolResultOutput(ended: TurnEndedEvent): string {
  const cause =
    ended.reason === 'cancelled'
      ? 'the turn was cancelled'
      : ended.reason === 'failed'
        ? `the turn failed${ended.error !== undefined ? ` (${ended.error.message})` : ''}`
        : 'the turn ended';
  return `Tool call did not complete: ${cause} before its result was recorded. Do not assume the tool completed successfully.`;
}

// ---------------------------------------------------------------------------
// Provider failure recovery loop
// ---------------------------------------------------------------------------

export interface RecoveryContext {
  readonly agent: Agent;
  readonly runOneTurn: (
    turnId: number,
    input: readonly ContentPart[],
    origin: PromptOrigin,
    signal: AbortSignal,
    standalone: boolean,
  ) => Promise<TurnEndResult>;
}

/**
 * Attempts recovery from a retryable provider failure via auto-retry,
 * model switch, or user prompt. Returns the final TurnEndResult after
 * recovery attempts (or the original if recovery is not possible).
 */
export async function recoverFromProviderFailure(
  ctx: RecoveryContext,
  turnId: number,
  turnInput: readonly ContentPart[],
  turnOrigin: PromptOrigin,
  signal: AbortSignal,
  initialEnd: TurnEndResult,
): Promise<TurnEndResult> {
  let end = initialEnd;
  let recoveryState: ProviderRecoveryState = { autoRetryCount: 0, userPrompted: false };

  while (end.event.reason === 'failed' && isRetryableProviderFailure(end.event.error)) {
    if (signal.aborted) {
      return cancelledTurnEndResult(turnId, signal);
    }

    let outcome;
    try {
      outcome = await resolveProviderRecovery(ctx.agent, {
        error: end.event.error!,
        turnId,
        signal,
        state: recoveryState,
      });
    } catch (error) {
      // Esc/Ctrl+C during sleepForRetry rejects with AbortError — surface as
      // a cancelled turn instead of leaving the UI stuck on a recovery wait.
      if (isAbortError(error) || signal.aborted) {
        return cancelledTurnEndResult(turnId, signal);
      }
      throw error;
    }

    if (outcome.type === 'pause') {
      return end;
    }

    if (outcome.type === 'switch') {
      ctx.agent.config.update({ modelAlias: outcome.modelAlias });
      recoveryState = { ...recoveryState, userPrompted: true };
    } else if (outcome.type === 'auto_retry') {
      recoveryState = {
        ...recoveryState,
        autoRetryCount: recoveryState.autoRetryCount + 1,
      };
    } else if (outcome.type === 'user_retry') {
      recoveryState = { ...recoveryState, userPrompted: true };
    }

    end = await ctx.runOneTurn(turnId, turnInput, turnOrigin, signal, false);

    if (
      recoveryState.userPrompted &&
      end.event.reason === 'failed' &&
      isRetryableProviderFailure(end.event.error)
    ) {
      return end;
    }
  }

  return end;
}
