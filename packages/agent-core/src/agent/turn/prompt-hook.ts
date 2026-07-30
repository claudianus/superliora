/**
 * UserPromptSubmit hook handling — extracted from TurnFlow.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import type { TurnEndedEvent } from '../../rpc/events';
import type { PromptOrigin } from '../context';
import { renderUserPromptHookBlockResult, renderUserPromptHookResult } from '../../session/hooks';

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
    // The terminal turn.ended is emitted by runOneTurn (synchronously with the
    // activeTurn clear), not here, so the session is idle the moment it fires.
    return {
      event: { type: 'turn.ended', turnId, reason: 'completed', durationMs: Date.now() - startedAt },
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
