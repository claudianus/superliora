import type { PendingToolResult, PreflightedToolCall } from './tool-call-types';
import type { ExecutableToolResult } from './types';

export function makeToolResult(
  call: PreflightedToolCall,
  args: unknown,
  result: ExecutableToolResult,
): PendingToolResult {
  return {
    toolCall: call.toolCall,
    toolName: call.toolName,
    args,
    result,
    stopTurn: toolResultStopsTurn(result),
  };
}

export function toolResultStopsTurn(result: ExecutableToolResult): boolean {
  return result.stopTurn === true;
}

export function makeErrorToolResult(
  call: PreflightedToolCall,
  args: unknown,
  output: string,
): PendingToolResult {
  return makeToolResult(call, args, { output, isError: true });
}

export { coerceToolResult, normalizeToolResult } from './tool-call-result-coerce';
