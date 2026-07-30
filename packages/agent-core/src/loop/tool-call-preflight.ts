import {
  compileToolArgsValidator,
  validateToolArgs,
  type JsonType,
} from '../tools/args-validator';

import { parseToolCallArguments } from './tool-args-parse';
import { validators } from './tool-call-guards';
import type { ExecutableTool } from './types';
import type {
  PreflightedToolCall,
  ToolCallStepContext,
} from './tool-call-types';
import type { ToolCall } from './types';

/**
 * Provider-order validation pass. It does not run hooks, spawn tools, or write
 * events. Validator compilation may populate the local cache.
 */
export function preflightToolCall(
  step: Pick<ToolCallStepContext, 'tools' | 'log'>,
  toolCall: ToolCall,
): PreflightedToolCall {
  const toolName = toolCall.name;
  const parsedArgs = parseToolCallArguments(toolCall.arguments);
  const tool = step.tools?.find((candidate) => candidate.name === toolName);
  if (tool === undefined) {
    return {
      kind: 'rejected',
      toolCall,
      toolName,
      args: parsedArgs.data,
      output: `Tool "${toolName}" not found`,
    };
  }

  if (parsedArgs.parseFailed) {
    step.log?.debug('tool args JSON parse failed', {
      toolName,
      toolCallId: toolCall.id,
      rawLength: toolCall.arguments?.length ?? 0,
      error: parsedArgs.error,
    });
  }

  const validationError = validateExecutableToolArgs(tool, parsedArgs.data);
  if (validationError !== null) {
    return {
      kind: 'rejected',
      toolCall,
      toolName,
      args: parsedArgs.data,
      output: `Invalid args for tool "${toolName}": ${validationError}`,
    };
  }
  return { kind: 'runnable', toolCall, toolName, tool, args: parsedArgs.data };
}

export function validateExecutableToolArgs(tool: ExecutableTool, args: unknown): string | null {
  let validator = validators.get(tool);
  if (validator === undefined) {
    try {
      validator = compileToolArgsValidator(tool.parameters);
      validators.set(tool, validator);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return validateToolArgs(validator, args as JsonType);
}
