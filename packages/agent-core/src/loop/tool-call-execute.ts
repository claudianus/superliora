import { errorMessage, isAbortError } from './errors';
import {
  coerceToolResult,
  makeErrorToolResult,
  makeToolResult,
} from './tool-call-result';
import type {
  PendingToolResult,
  PreflightedToolCall,
  RunnableToolCall,
  ToolCallStepContext,
} from './tool-call-types';
import {
  REPETITION_HARD_STOP_THRESHOLD,
  abortedToolOutput,
  getCircuitBreakerState,
  getToolCallPatternCount,
  isToolCircuitOpen,
  recordToolFailureForCircuitBreaker,
  recordToolSuccessForCircuitBreaker,
  resetToolFailure,
  trackToolFailure,
} from './tool-call-guards';
import type { ExecutableToolResult, RunnableToolExecution, ToolCall } from './types';
import type { Logger } from '#/logging/types';

const GRACE_TIMEOUT_MS = 2_000;

/**
 * Threshold (ms) for flagging slow tool executions. Tools exceeding this
 * are logged for observability (AHE decision observability pillar).
 */
const SLOW_TOOL_THRESHOLD_MS = 10_000;

export async function runRunnableToolCall(
  step: ToolCallStepContext,
  call: RunnableToolCall,
  effectiveArgs: unknown,
  metadata: unknown,
  execution: RunnableToolExecution,
): Promise<PendingToolResult> {
  const { signal } = step;
  const { toolCall, toolName } = call;

  if (signal.aborted) {
    return makeErrorToolResult(call, effectiveArgs, abortedToolOutput(toolName, signal));
  }

  // Circuit breaker check: block tools with open circuits.
  if (isToolCircuitOpen(toolName)) {
    step.log?.warn('tool circuit breaker open; blocking execution', {
      toolName,
      toolCallId: toolCall.id,
      state: getCircuitBreakerState(toolName),
    });
    return makeErrorToolResult(
      call,
      effectiveArgs,
      `Tool "${toolName}" is temporarily unavailable due to repeated failures. Circuit breaker open — will retry after cooldown.`,
    );
  }

  // Doom-loop hard stop: identical tool+args repeated past threshold in this turn.
  // trackToolCallPattern is also called from dispatchToolCall; use count check here
  // so execution is blocked even if dispatch already recorded the signature.
  const patternCount = getToolCallPatternCount(toolName, effectiveArgs);
  if (patternCount >= REPETITION_HARD_STOP_THRESHOLD) {
    step.log?.warn('doom_loop hard stop; blocking tool execution', {
      toolName,
      toolCallId: toolCall.id,
      repetitionCount: patternCount,
      code: 'DOOM_LOOP_HARD_STOP',
    });
    return makeToolResult(call, effectiveArgs, {
      output: `doom_loop_hard_stop: 동일 도구·인자 반복(${String(patternCount)}회)으로 실행을 차단했습니다. code=DOOM_LOOP_HARD_STOP. 다른 접근을 시도하거나 사용자에게 막힘 요약을 보고하세요.`,
      isError: true,
      stopTurn: true,
    });
  }

  const startMs = Date.now();
  let toolResult: ExecutableToolResult;
  try {
    const raw = await executeTool(step, execution, toolCall, toolName, metadata);
    toolResult = coerceToolResult(raw, toolName);
  } catch (error) {
    const aborted = isAbortError(error) || signal.aborted;
    if (!aborted) {
      step.log?.warn('tool execution failed', {
        toolName,
        toolCallId: toolCall.id,
        error,
      });
      trackToolFailure(toolName, step.log);
      recordToolFailureForCircuitBreaker(toolName);
    }
    const output = aborted
      ? abortedToolOutput(toolName, signal)
      : `Tool "${toolName}" failed: ${errorMessage(error)}`;
    return makeErrorToolResult(call, effectiveArgs, output);
  }

  const durationMs = Date.now() - startMs;
  // Track slow tool executions for observability.
  if (durationMs > SLOW_TOOL_THRESHOLD_MS) {
    step.log?.info('slow tool execution', {
      toolName,
      toolCallId: toolCall.id,
      durationMs,
      thresholdMs: SLOW_TOOL_THRESHOLD_MS,
    });
  }

  // Track failure patterns for isError results (e.g. grace timeout, coercion).
  if (toolResult.isError === true) {
    trackToolFailure(toolName, step.log);
    recordToolFailureForCircuitBreaker(toolName);
  } else {
    resetToolFailure(toolName);
    recordToolSuccessForCircuitBreaker(toolName);
  }

  return makeToolResult(call, effectiveArgs, toolResult);
}

async function executeTool(
  step: ToolCallStepContext,
  execution: RunnableToolExecution,
  toolCall: ToolCall,
  toolName: string,
  metadata: unknown,
): Promise<ExecutableToolResult> {
  const { dispatchEvent, signal, turnId } = step;

  signal.throwIfAborted();

  const executePromise = execution.execute({
    turnId,
    toolCallId: toolCall.id,
    metadata,
    signal,
    onUpdate: (update) => {
      if (signal.aborted) return;
      dispatchEvent({
        type: 'tool.progress',
        toolCallId: toolCall.id,
        update,
      });
    },
  });
  return raceExecuteWithGraceTimeout(executePromise, signal, toolName, step.log);
}

async function raceExecuteWithGraceTimeout(
  executePromise: Promise<ExecutableToolResult>,
  signal: AbortSignal,
  toolName: string,
  log?: Logger | undefined,
): Promise<ExecutableToolResult> {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let graceFired = false;

  const graceSentinel: Promise<ExecutableToolResult> = new Promise((resolve) => {
    const armTimer = (): void => {
      graceTimer = setTimeout(() => {
        graceFired = true;
        resolve({
          output: `Tool "${toolName}" aborted by grace timeout (${String(GRACE_TIMEOUT_MS)}ms)`,
          isError: true,
        });
      }, GRACE_TIMEOUT_MS);
    };
    if (signal.aborted) {
      armTimer();
    } else {
      onAbort = armTimer;
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    // Tools that ignore AbortSignal may never settle. After abort, the grace
    // branch lets the turn finish with a synthetic error result.
    const result = await Promise.race([executePromise, graceSentinel]);
    if (graceFired) {
      // The real tool work is still running in `executePromise`; it ignored
      // the abort signal within the grace window. Surface that so the leak is
      // observable instead of silent, and attach a continuation so a late
      // settlement is logged rather than becoming an unhandled rejection.
      log?.warn('tool ignored abort signal; grace timeout fired while execution continues', {
        toolName,
        graceTimeoutMs: GRACE_TIMEOUT_MS,
      });
      executePromise.then(
        () => {
          log?.info('tool settled after grace timeout (work continued past abort)', { toolName });
        },
        (error) => {
          log?.warn('tool rejected after grace timeout', { toolName, error: error });
        },
      );
    }
    return result;
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    if (onAbort !== undefined) {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {
        // Some AbortSignal polyfills do not implement removeEventListener.
      }
    }
  }
}
