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
    // the raw tool output unredacted — but never misreport a mutation that
    // already happened on disk as failed: a hook crash on a successful
    // Edit/Write used to make the model re-apply the write (double-apply or
    // "old_string not found" spirals). Keep the original outcome, append a
    // warning that the hook crashed, and say explicitly that side effects
    // may already be applied.
    const aborted = isAbortError(error) || signal.aborted;
    if (!aborted) {
      step.log?.warn('finalizeToolResult hook failed', {
        toolName: pendingResult.toolName,
        toolCallId: pendingResult.toolCall.id,
        error,
      });
    }
    if (aborted) {
      return {
        ...pendingResult,
        stopTurn: pendingResult.stopTurn,
        result: {
          output: `Tool "${pendingResult.toolName}" aborted during finalizeToolResult hook.`,
          isError: true,
        },
      };
    }
    const original = pendingResult.result;
    const originalOutput =
      typeof original === 'object' && original !== null && 'output' in original
        ? String(original.output)
        : '';
    const hookWarning =
      `finalizeToolResult hook failed for "${pendingResult.toolName}": ${errorMessage(error)} ` +
      'The hook crashed AFTER the tool completed; the tool result above is from the tool itself, ' +
      'but post-processing (redaction, verification, mutation sensors) may be incomplete. ';
    const tail =
      'code=FINALIZE_HOOK_FAILED. Do not blindly re-run a mutating tool: the change may already be applied — verify the on-disk state first.';
    const combinedOutput =
      (originalOutput.length > 0 ? `${originalOutput}\n\n${hookWarning}${tail}` : `${hookWarning}${tail}`);
    return {
      ...pendingResult,
      stopTurn: pendingResult.stopTurn,
      result: {
        ...(typeof original === 'object' && original !== null ? original : {}),
        output: combinedOutput,
        isError: true,
      },
    };
  }
}
