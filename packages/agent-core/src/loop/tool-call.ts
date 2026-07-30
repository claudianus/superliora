/**
 * Tool-call lifecycle for one completed provider response.
 *
 * This module keeps the provider-order invariant in one place:
 *   - validate every provider tool call before hooks or events
 *   - run preparation hooks and compute tool-call display fields in provider order
 *   - dispatch `tool.call` before execution starts
 *   - execute tools with non-conflicting resource accesses concurrently
 *   - serialize tools whose resource accesses conflict
 *   - dispatch terminal `tool.result` events in provider order
 *
 * These phases are coupled by transcript ordering and abort handling, so they
 * should be reviewed together.
 */

import type { LLMChatResponse } from './llm';
import { finalizePendingToolResult } from './tool-call-finalize';
import { preflightToolCall } from './tool-call-preflight';
import { prepareSkippedToolCall, prepareToolCall } from './tool-call-prepare';
import { ToolScheduler } from './tool-scheduler';
import type {
  PendingToolResult,
  ToolCallBatchResult,
  ToolCallStepContext,
} from './tool-call-types';

export type { ToolCallBatchResult, ToolCallStepContext } from './tool-call-types';

export async function runToolCallBatch(
  step: ToolCallStepContext,
  response: LLMChatResponse,
): Promise<ToolCallBatchResult> {
  if (response.toolCalls.length === 0) return { stopTurn: false };
  const batchStep = { ...step, toolCalls: response.toolCalls };
  const calls = response.toolCalls.map((toolCall) => preflightToolCall(step, toolCall));
  const scheduler = new ToolScheduler<PendingToolResult>();
  const pendingResults: Array<Promise<PendingToolResult>> = [];
  // toolCallIds that received a `tool.intend` and therefore need a `tool.ack`
  // once execution settles, so the intend→ack durability window is closed.
  const finalizedIntends = new Set<string>();
  let stopTurn = false;

  try {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]!;
      const prepared = await prepareToolCall(batchStep, call);
      if (prepared.intended === true) finalizedIntends.add(call.toolCall.id);
      pendingResults.push(scheduler.add(prepared.task));

      if (prepared.stopBatchAfterThis === true) {
        stopTurn = true;
        for (const skippedCall of calls.slice(index + 1)) {
          const skippedTask = await prepareSkippedToolCall(batchStep, skippedCall);
          pendingResults.push(scheduler.add(skippedTask));
        }
        break;
      }
    }

    // Tool tasks may finish out of order; terminal results are still emitted in
    // provider order. Await all tasks so each recorded `tool.call` gets a
    // paired `tool.result`; the caller checks abort before writing `step.end`.
    for (const pendingResult of pendingResults) {
      const result = await finalizePendingToolResult(batchStep, await pendingResult);
      if (result.stopTurn === true) stopTurn = true;
      // Acknowledge that execution settled, closing the intend→ack window so a
      // crash after this point is unambiguous (the side effect completed).
      if (finalizedIntends.has(result.toolCall.id)) {
        await step.dispatchEvent({
          type: 'tool.ack',
          parentUuid: result.toolCall.id,
          toolCallId: result.toolCall.id,
        });
      }
      await step.dispatchEvent({
        type: 'tool.result',
        parentUuid: result.toolCall.id,
        toolCallId: result.toolCall.id,
        result: result.result,
      });
    }
  } finally {
    // Preparation or result dispatch can throw after execution has started.
    // Always settle spawned tasks before the caller continues so rejected
    // execute promises cannot surface as detached unhandled rejections.
    await Promise.allSettled(pendingResults);
  }
  return { stopTurn };
}
