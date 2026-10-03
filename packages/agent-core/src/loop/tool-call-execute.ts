import { errorMessage, isAbortError } from './errors';
import { coerceToolResult, makeErrorToolResult, makeToolResult } from './tool-call-result';
import { abortedToolOutput } from './tool-call-support';
import type { PendingToolResult, RunnableToolCall, ToolCallStepContext } from './tool-call-types';
import type { RunnableToolExecution } from './types';

export async function runRunnableToolCall(
  step: ToolCallStepContext,
  call: RunnableToolCall,
  effectiveArgs: unknown,
  metadata: unknown,
  execution: RunnableToolExecution,
  executionSignal?: AbortSignal | undefined,
): Promise<PendingToolResult> {
  const signal = executionSignal === undefined
    ? step.signal
    : AbortSignal.any([step.signal, executionSignal]);
  if (signal.aborted) {
    return makeErrorToolResult(call, effectiveArgs, abortedToolOutput(call.toolName, signal));
  }
  try {
    // Await real settlement even after abort. Scheduler ownership cannot end
    // while a tool can still mutate its declared resources.
    const raw = await execution.execute({
      turnId: step.turnId,
      toolCallId: call.toolCall.id,
      metadata,
      signal,
      onUpdate: (update) => {
        if (signal.aborted) return;
        step.dispatchEvent({ type: 'tool.progress', toolCallId: call.toolCall.id, update });
      },
    });
    return makeToolResult(call, effectiveArgs, coerceToolResult(raw, call.toolName));
  } catch (error) {
    const aborted = isAbortError(error) || signal.aborted;
    if (!aborted) {
      step.log?.warn('tool execution failed', {
        toolName: call.toolName,
        toolCallId: call.toolCall.id,
        error,
      });
    }
    return makeErrorToolResult(call, effectiveArgs, aborted
      ? abortedToolOutput(call.toolName, signal)
      : `Tool "${call.toolName}" failed: ${errorMessage(error)}`);
  }
}
