/**
 * UserPromptSubmit hook handling — extracted from TurnFlow.
 */

import type { ContentPart } from '@superliora/kosong';
import type { TurnEndedEvent } from '@superliora/protocol';

import type { HooksService } from '../../services/hooks';
import { isAbortError } from '../../loop/errors';
import type { Agent } from '../agent';
import { createCancelledTurnEnded, createFailedTurnEnded } from './error-recovery';

/** Loop41a — wire `warning.code` when UserPromptSubmit blocks the turn. */
export const USER_PROMPT_SUBMIT_BLOCK_CODE = 'user-prompt-submit-block' as const;

export function formatUserPromptSubmitBlockTip(reason?: string): string {
  const detail =
    reason !== undefined && reason.trim().length > 0
      ? reason.trim()
      : 'Blocked by UserPromptSubmit hook';
  if (detail.startsWith('USER_PROMPT_SUBMIT_BLOCK:')) return detail;
  return (
    `USER_PROMPT_SUBMIT_BLOCK: ${detail}. ` +
    `Turn will not start until the hook allows the prompt. ` +
    `code=${USER_PROMPT_SUBMIT_BLOCK_CODE}.`
  );
}

export async function runUserPromptSubmitHooks(input: {
  agent: Agent;
  hooks: HooksService | undefined;
  turnId: number;
  message: ContentPart[];
  signal: AbortSignal;
}): Promise<{ blocked: true; ended: TurnEndedEvent } | { blocked: false }> {
  const { agent, hooks, turnId, message, signal } = input;
  if (hooks === undefined) {
    return { blocked: false };
  }

  try {
    const hookResult = await hooks.runUserPromptSubmit({
      message,
      signal,
    });
    agent.emitEvent({
      type: 'hook.result',
      turnId,
      hookEvent: 'UserPromptSubmit',
      decision: hookResult.blocked ? 'block' : 'allow',
      reason: hookResult.reason,
    });
    if (hookResult.blocked) {
      agent.log.warn('UserPromptSubmit hook blocked turn', {
        turnId,
        reason: hookResult.reason,
      });
      // Loop41a: operator-visible — hook.result alone is easy to miss mid-stream.
      const tip = formatUserPromptSubmitBlockTip(hookResult.reason);
      agent.emitEvent({
        type: 'warning',
        message: tip,
        code: USER_PROMPT_SUBMIT_BLOCK_CODE,
      });
      return {
        blocked: true,
        ended: createFailedTurnEnded(turnId, {
          message: tip,
          code: 'UserPromptSubmitBlocked',
        }),
      };
    }
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      return {
        blocked: true,
        ended: createCancelledTurnEnded(turnId, signal),
      };
    }
    throw error;
  }

  return { blocked: false };
}
