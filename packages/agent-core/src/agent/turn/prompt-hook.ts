/**
 * UserPromptSubmit hook handling — extracted from TurnFlow.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import type { TurnEndedEvent } from '../../rpc/events';
import type { PromptOrigin } from '../context';
import { renderUserPromptHookBlockResult, renderUserPromptHookResult } from '../../session/hooks';

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

export interface PromptHookEndResult {
  readonly event: TurnEndedEvent;
  readonly blocked: boolean;
}

export async function applyUserPromptHook(
  agent: Agent,
  turnId: number,
  input: readonly ContentPart[],
  origin: PromptOrigin,
  signal: AbortSignal,
  startedAt: number,
): Promise<PromptHookEndResult | undefined> {
  if (origin.kind !== 'user') return undefined;
  signal.throwIfAborted();
  const promptHookResults = await agent.hooks?.trigger('UserPromptSubmit', {
    matcherValue: input,
    signal,
    inputData: { prompt: input },
  });
  signal.throwIfAborted();
  const blockResult = renderUserPromptHookBlockResult(promptHookResults);
  if (blockResult !== undefined) {
    agent.context.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: blockResult.text }],
      toolCalls: [],
      origin: { kind: 'hook_result', event: 'UserPromptSubmit', blocked: true },
    });
    agent.emitEvent({
      type: 'hook.result',
      turnId,
      hookEvent: blockResult.event,
      content: blockResult.message,
      blocked: true,
    });
    // Loop41a: operator-visible — hook.result alone is easy to miss mid-stream.
    const tip = formatUserPromptSubmitBlockTip(blockResult.message);
    agent.emitEvent({
      type: 'warning',
      message: tip,
      code: USER_PROMPT_SUBMIT_BLOCK_CODE,
    });
    // The terminal turn.ended is emitted by runOneTurn (synchronously with the
    // activeTurn clear), not here, so the session is idle the moment it fires.
    return {
      event: {
        type: 'turn.ended',
        turnId,
        reason: 'completed',
        durationMs: Date.now() - startedAt,
      },
      blocked: true,
    };
  }

  const hookResult = renderUserPromptHookResult(promptHookResults);
  if (hookResult === undefined) return undefined;

  agent.context.appendUserMessage([{ type: 'text', text: hookResult.text }], {
    kind: 'hook_result',
    event: 'UserPromptSubmit',
  });
  agent.emitEvent({
    type: 'hook.result',
    turnId,
    hookEvent: hookResult.event,
    content: hookResult.message,
  });
  return undefined;
}
