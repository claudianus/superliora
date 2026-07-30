import { coerceToolResult, normalizeToolResult, toolResultStopsTurn } from './tool-call-result';
import { errorMessage, isAbortError } from './errors';
import type {
  PendingToolResult,
  ToolCallBatchContext,
} from './tool-call-types';

export async function finalizePendingToolResult(
  step: ToolCallBatchContext,
  pendingResult: PendingToolResult,
): Promise<PendingToolResult> {
  const { hooks, signal, turnId, currentStep, llm } = step;
  if (hooks?.finalizeToolResult === undefined) {
    return { ...pendingResult, result: normalizeToolResult(pendingResult.result) };
  }

  try {
    const finalizedResult = await hooks.finalizeToolResult({
      toolCall: pendingResult.toolCall,
      toolCalls: step.toolCalls,
      args: pendingResult.args,
      result: pendingResult.result,
      turnId,
      stepNumber: currentStep,
      signal,
      llm,
    });
    const effectiveResult = coerceToolResult(
      finalizedResult ?? pendingResult.result,
      pendingResult.toolName,
    );
    return {
      ...pendingResult,
      stopTurn: pendingResult.stopTurn === true || toolResultStopsTurn(effectiveResult),
      result: normalizeToolResult(effectiveResult),
    };
  } catch (error) {
    // This is the redaction/truncation boundary. If it fails, do not persist
    // the raw tool output; write an error result instead.
    const aborted = isAbortError(error) || signal.aborted;
    if (!aborted) {
      step.log?.warn('finalizeToolResult hook failed', {
        toolName: pendingResult.toolName,
        toolCallId: pendingResult.toolCall.id,
        error,
      });
    }
    const output = aborted
      ? `Tool "${pendingResult.toolName}" aborted during finalizeToolResult hook.`
      : `finalizeToolResult hook failed for "${pendingResult.toolName}": ${errorMessage(error)}`;
    return {
      ...pendingResult,
      stopTurn: pendingResult.stopTurn,
      result: { output, isError: true },
    };
  }
}
