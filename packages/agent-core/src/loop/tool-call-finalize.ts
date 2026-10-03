import { coerceToolResult, normalizeToolResult, toolResultStopsTurn } from './tool-call-result';
import type { PendingToolResult, ToolCallBatchContext } from './tool-call-types';

export async function finalizePendingToolResult(
  step: ToolCallBatchContext,
  pendingResult: PendingToolResult,
): Promise<PendingToolResult> {
  const finalized = await step.hooks?.finalizeToolResult?.({
    toolCall: pendingResult.toolCall,
    toolCalls: step.toolCalls,
    args: pendingResult.args,
    result: pendingResult.result,
    turnId: step.turnId,
    stepNumber: step.currentStep,
    signal: step.signal,
    llm: step.llm,
  });
  const result = coerceToolResult(finalized ?? pendingResult.result, pendingResult.toolName);
  return {
    ...pendingResult,
    stopTurn: pendingResult.stopTurn === true || toolResultStopsTurn(result),
    result: normalizeToolResult(result),
  };
}
