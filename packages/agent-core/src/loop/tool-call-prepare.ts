import {
  formatPathSecurityErrorOutput,
  PathSecurityError,
} from '../tools/policies/path-access';

import { errorMessage, isAbortError } from './errors';
import { ToolAccesses } from './tool-access';
import { dispatchToolCall } from './tool-call-dispatch';
import { runRunnableToolCall } from './tool-call-execute';
import {
  abortedToolOutput,
  isAlwaysSideEffectingTool,
  writePathsFromAccesses,
} from './tool-call-guards';
import {
  validateExecutableToolArgs,
} from './tool-call-preflight';
import {
  coerceToolResult,
  makeErrorToolResult,
  makeToolResult,
  toolResultStopsTurn,
} from './tool-call-result';
import type { ToolCallTask } from './tool-scheduler';
import type {
  PendingToolResult,
  PreparedToolCallTask,
  PreflightedToolCall,
  PrepareToolExecutionDecision,
  RunnableToolCall,
  ToolCallBatchContext,
  ToolCallDisplayFields,
} from './tool-call-types';
import type {
  AuthorizeToolExecutionResult,
  ExecutableToolResult,
  PrepareToolExecutionResult,
  RunnableToolExecution,
  ToolExecution,
} from './types';

export async function prepareToolCall(
  step: ToolCallBatchContext,
  call: PreflightedToolCall,
): Promise<PreparedToolCallTask> {
  const settleError = async (
    args: unknown,
    output: string,
    displayFields?: ToolCallDisplayFields,
  ): Promise<PreparedToolCallTask> => {
    await dispatchToolCall(step, call, args, displayFields);
    return { task: makeResolvedToolCallTask(makeErrorToolResult(call, args, output)) };
  };

  const settleSynthetic = async (
    args: unknown,
    result: ExecutableToolResult,
    displayFields?: ToolCallDisplayFields,
  ): Promise<PreparedToolCallTask> => {
    const coerced = coerceToolResult(result, call.toolName);
    await dispatchToolCall(step, call, args, displayFields);
    return {
      task: makeResolvedToolCallTask(makeToolResult(call, args, coerced)),
      stopBatchAfterThis: toolResultStopsTurn(coerced),
    };
  };

  if (call.kind === 'rejected') return settleError(call.args, call.output);

  const decision = await runPrepareToolExecutionHook(step, call);
  if (decision.kind === 'blocked' || decision.kind === 'hookFailed') {
    return settleError(decision.args, decision.output);
  }
  if (decision.kind === 'synthetic') {
    return settleSynthetic(decision.args, decision.result);
  }

  const validationError = validateExecutableToolArgs(call.tool, decision.args);
  if (validationError !== null) {
    return settleError(
      decision.args,
      `Invalid args for tool "${call.toolName}" after prepareToolExecution hook: ${validationError}`,
    );
  }

  const effectiveArgs = decision.args;
  let execution: ToolExecution;
  try {
    execution = await call.tool.resolveExecution(effectiveArgs);
  } catch (error) {
    if (!(error instanceof PathSecurityError)) {
      step.log?.warn('tool execution setup failed', {
        toolName: call.toolName,
        toolCallId: call.toolCall.id,
        error,
      });
    }
    const output =
      error instanceof PathSecurityError
        ? // Loop45a: include stable PATH_* code for TUI named notices.
          formatPathSecurityErrorOutput(error)
        : `Tool "${call.toolName}" failed to resolve execution: ${errorMessage(error)}`;
    return settleError(effectiveArgs, output);
  }

  const displayFields = toolCallDisplayFieldsFromExecution(execution);
  const settleAborted = (): Promise<PreparedToolCallTask> =>
    settleError(effectiveArgs, abortedToolOutput(call.toolName, step.signal), displayFields);

  if (step.signal.aborted) return settleAborted();

  if (execution.isError === true) {
    return settleSynthetic(effectiveArgs, execution, displayFields);
  }

  const authorization = await runAuthorizeToolExecutionHook(step, call, effectiveArgs, execution);
  if (step.signal.aborted) return settleAborted();

  if (authorization?.block === true) {
    return settleError(
      effectiveArgs,
      authorization.reason ?? `Tool call "${call.toolName}" was blocked`,
      displayFields,
    );
  }

  if (authorization?.syntheticResult !== undefined) {
    return settleSynthetic(effectiveArgs, authorization.syntheticResult, displayFields);
  }

  const executionMetadata = authorization?.executionMetadata ?? decision.metadata;
  await dispatchToolCall(step, call, effectiveArgs, displayFields);
  // For tools that mutate durable state, record a pre-execution intent and
  // flush it to disk BEFORE the side effect runs. A crash during execution
  // then leaves a durable marker that the effect was attempted, so resume can
  // reconcile (e.g. verify a file write already landed) instead of silently
  // redoing it or assuming it never happened.
  const writePaths = writePathsFromAccesses(execution.accesses);
  const intended = writePaths !== undefined || isAlwaysSideEffectingTool(call.toolName);
  if (intended) {
    await step.dispatchEvent({
      type: 'tool.intend',
      toolCallId: call.toolCall.id,
      name: call.toolName,
      args: effectiveArgs,
      ...(writePaths !== undefined ? { writePaths } : {}),
    });
  }
  return {
    task: {
      accesses: execution.accesses ?? ToolAccesses.all(),
      start: async () => ({
        result: runRunnableToolCall(step, call, effectiveArgs, executionMetadata, execution),
      }),
    },
    stopBatchAfterThis: execution.stopBatchAfterThis,
    intended,
  };
}

export async function prepareSkippedToolCall(
  step: ToolCallBatchContext,
  call: PreflightedToolCall,
): Promise<ToolCallTask<PendingToolResult>> {
  const output = 'Tool skipped because a previous tool call stopped the turn.';
  await dispatchToolCall(step, call, call.args);
  return makeResolvedToolCallTask(makeErrorToolResult(call, call.args, output));
}

export function makeResolvedToolCallTask(
  result: PendingToolResult,
): ToolCallTask<PendingToolResult> {
  return {
    accesses: ToolAccesses.none(),
    start: async () => ({ result: Promise.resolve(result) }),
  };
}

/**
 * Run `prepareToolExecution` in provider order before recording `tool.call`.
 * Hook decisions can block a call or replace args before execution starts.
 */
async function runPrepareToolExecutionHook(
  step: ToolCallBatchContext,
  call: RunnableToolCall,
): Promise<PrepareToolExecutionDecision> {
  const { hooks, signal, turnId, currentStep, llm } = step;
  const { toolCall, args } = call;

  if (hooks?.prepareToolExecution === undefined) {
    return { kind: 'allowed', args };
  }

  let hookResult: PrepareToolExecutionResult | undefined;
  try {
    hookResult = await hooks.prepareToolExecution({
      toolCall,
      toolCalls: step.toolCalls,
      tool: call.tool,
      args,
      turnId,
      stepNumber: currentStep,
      signal,
      llm,
    });
  } catch (error) {
    // If the turn is cancelled while an abort-aware hook is awaited, report the
    // call as aborted instead of treating it as a hook failure.
    if (isAbortError(error) || signal.aborted) {
      return {
        kind: 'hookFailed',
        args,
        output: `Tool "${call.toolName}" was aborted during prepareToolExecution hook`,
      };
    }
    return {
      kind: 'hookFailed',
      args,
      output: `prepareToolExecution hook failed for "${call.toolName}": ${errorMessage(error)}`,
    };
  }

  const effectiveArgs = hookResult?.updatedArgs ?? args;
  if (hookResult?.block === true) {
    return {
      kind: 'blocked',
      args: effectiveArgs,
      output: hookResult.reason ?? `Tool call "${call.toolName}" was blocked`,
    };
  }

  if (hookResult?.syntheticResult !== undefined) {
    return { kind: 'synthetic', args: effectiveArgs, result: hookResult.syntheticResult };
  }

  return { kind: 'allowed', args: effectiveArgs, metadata: hookResult?.executionMetadata };
}

async function runAuthorizeToolExecutionHook(
  step: ToolCallBatchContext,
  call: RunnableToolCall,
  args: unknown,
  execution: RunnableToolExecution,
): Promise<AuthorizeToolExecutionResult | undefined> {
  const { hooks, signal, turnId, currentStep, llm } = step;
  if (hooks?.authorizeToolExecution === undefined) return undefined;

  try {
    return await hooks.authorizeToolExecution({
      toolCall: call.toolCall,
      toolCalls: step.toolCalls,
      tool: call.tool,
      args,
      execution,
      turnId,
      stepNumber: currentStep,
      signal,
      llm,
    });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      return {
        block: true,
        reason: `Tool "${call.toolName}" was aborted during authorizeToolExecution hook`,
      };
    }
    return {
      block: true,
      reason: `authorizeToolExecution hook failed for "${call.toolName}": ${errorMessage(error)}`,
    };
  }
}

function toolCallDisplayFieldsFromExecution(
  execution: ToolExecution,
): ToolCallDisplayFields | undefined {
  if (execution.isError === true) return undefined;
  const description = execution.description;
  const display = execution.display;
  return {
    description: description !== undefined && description.length > 0 ? description : undefined,
    display,
  };
}
