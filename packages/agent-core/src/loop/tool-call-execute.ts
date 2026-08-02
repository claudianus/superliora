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
  REPETITION_WARN_THRESHOLD,
  abortedToolOutput,
  checkToolCallIdempotency,
  formatDoomLoopWarnTip,
  getCircuitBreakerState,
  getToolCallPatternCount,
  isToolCircuitOpen,
  recordToolCallExecution,
  recordToolFailureForCircuitBreaker,
  recordToolSuccessForCircuitBreaker,
  resetToolFailure,
  toolCallIdempotencyKey,
  trackToolFailure,
} from './tool-call-guards';
import type { ExecutableToolResult, RunnableToolExecution, ToolCall } from './types';
import type { Logger } from '#/logging/types';

const GRACE_TIMEOUT_MS = 2_000;

/**
 * Threshold (ms) for flagging slow tool executions. Tools exceeding this
 * are logged for observability (AHE decision observability pillar).
 */
export const SLOW_TOOL_THRESHOLD_MS = 10_000;

/** Loop27a — model-visible marker when a tool exceeds SLOW_TOOL_THRESHOLD_MS. */
export const SLOW_TOOL_WARN_PREFIX = 'SLOW_TOOL_WARN:' as const;

export function formatSlowToolWarnTip(
  toolName: string,
  durationMs: number,
  thresholdMs: number = SLOW_TOOL_THRESHOLD_MS,
): string {
  return (
    `${SLOW_TOOL_WARN_PREFIX} ${toolName} took ${String(durationMs)}ms ` +
    `(threshold ${String(thresholdMs)}ms). Prefer smaller scopes or parallelize independent work; ` +
    `do not chain more long tools without progress.`
  );
}

/** Loop29a — successful half-open/open probe closed the tool circuit. */
export const CIRCUIT_BREAKER_RECOVERED_CODE = 'CIRCUIT_BREAKER_RECOVERED' as const;

export function formatCircuitBreakerRecoveredTip(
  toolName: string,
  fromState: string = 'half-open',
): string {
  return (
    `${CIRCUIT_BREAKER_RECOVERED_CODE}: Tool "${toolName}" probe succeeded ` +
    `(from ${fromState}). Circuit closed — tool is available again. ` +
    `code=${CIRCUIT_BREAKER_RECOVERED_CODE}.`
  );
}

/** Loop29a — half-open probe failed; circuit re-opened. */
export function formatCircuitBreakerProbeFailedTip(toolName: string): string {
  return (
    `CIRCUIT_BREAKER_OPEN: Tool "${toolName}" half-open probe failed; ` +
    `circuit re-opened. code=CIRCUIT_BREAKER_OPEN. Pick another tool or wait for cooldown.`
  );
}

/**
 * Loop26a — mutation tools eligible for short-window idempotency replay.
 * Matches mutation-verification-sensor write surface (Edit/Write/ApplyPatch).
 * Read-like tools must NOT short-circuit (stale results are worse than re-run).
 */
const IDEMPOTENT_MUTATION_TOOLS = new Set(['Edit', 'Write', 'ApplyPatch']);

export const IDEMPOTENCY_REPLAY_CODE = 'IDEMPOTENCY_REPLAY' as const;

function isIdempotentMutationTool(toolName: string): boolean {
  return IDEMPOTENT_MUTATION_TOOLS.has(toolName);
}

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
    const state = getCircuitBreakerState(toolName);
    step.log?.warn('tool circuit breaker open; blocking execution', {
      toolName,
      toolCallId: toolCall.id,
      state,
    });
    // Loop25a: stable marker so TUI can surface a named recovery notice.
    return makeErrorToolResult(
      call,
      effectiveArgs,
      `CIRCUIT_BREAKER_OPEN: Tool "${toolName}" is temporarily unavailable due to repeated failures ` +
        `(state=${state ?? 'open'}). code=CIRCUIT_BREAKER_OPEN. Pick another tool or wait for cooldown — do not hammer the same tool.`,
    );
  }

  // Loop29a: after cooldown, isToolCircuitOpen may have flipped open→half-open.
  // This allowed call is the single probe; success closes, failure re-opens.
  const isHalfOpenProbe = getCircuitBreakerState(toolName) === 'half-open';

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

  // Loop26a: short-window idempotency for mutation tools — replay prior result
  // instead of re-applying the same write (guards double-apply after retry).
  const idempotencyKey = isIdempotentMutationTool(toolName)
    ? toolCallIdempotencyKey(toolName, effectiveArgs)
    : undefined;
  if (idempotencyKey !== undefined) {
    const prior = checkToolCallIdempotency(idempotencyKey);
    if (prior !== undefined && prior.result !== undefined) {
      step.log?.info('idempotent mutation replay; skipping re-execution', {
        toolName,
        toolCallId: toolCall.id,
        ageMs: Date.now() - prior.executedAt,
        code: IDEMPOTENCY_REPLAY_CODE,
      });
      const priorOut = prior.result;
      const tip =
        `\n\n${IDEMPOTENCY_REPLAY_CODE}: identical ${toolName} args already applied ` +
        `${String(Date.now() - prior.executedAt)}ms ago. ` +
        `Replayed prior result — no second write.`;
      return makeToolResult(call, effectiveArgs, {
        output: priorOut.length > 0 ? `${priorOut}${tip}` : tip.trim(),
        isError: false,
      });
    }
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
    let output = aborted
      ? abortedToolOutput(toolName, signal)
      : `Tool "${toolName}" failed: ${errorMessage(error)}`;
    // Loop29a: thrown failure during half-open probe re-opens — same marker as isError path.
    if (!aborted && isHalfOpenProbe) {
      output = `${output}\n\n${formatCircuitBreakerProbeFailedTip(toolName)}`;
      step.log?.warn('tool circuit breaker half-open probe failed; re-opened', {
        toolName,
        toolCallId: toolCall.id,
      });
    }
    return makeErrorToolResult(call, effectiveArgs, output);
  }

  const durationMs = Date.now() - startMs;
  // Loop27a: slow tools — log + model-visible tip (not log-only).
  if (durationMs > SLOW_TOOL_THRESHOLD_MS) {
    step.log?.info('slow tool execution', {
      toolName,
      toolCallId: toolCall.id,
      durationMs,
      thresholdMs: SLOW_TOOL_THRESHOLD_MS,
    });
    const tip = formatSlowToolWarnTip(toolName, durationMs);
    const base =
      typeof toolResult.output === 'string' ? toolResult.output : String(toolResult.output ?? '');
    toolResult = {
      ...toolResult,
      output: base.length > 0 ? `${base}\n\n${tip}` : tip,
    };
  }

  // Track failure patterns for isError results (e.g. grace timeout, coercion).
  if (toolResult.isError === true) {
    trackToolFailure(toolName, step.log);
    recordToolFailureForCircuitBreaker(toolName);
    // Loop29a: half-open probe failure re-opens — mark so TUI reuses open notice.
    if (isHalfOpenProbe) {
      const tip = formatCircuitBreakerProbeFailedTip(toolName);
      const base =
        typeof toolResult.output === 'string' ? toolResult.output : String(toolResult.output ?? '');
      toolResult = {
        ...toolResult,
        output: base.length > 0 ? `${base}\n\n${tip}` : tip,
      };
      step.log?.warn('tool circuit breaker half-open probe failed; re-opened', {
        toolName,
        toolCallId: toolCall.id,
      });
    }
  } else {
    resetToolFailure(toolName);
    const recoveredFrom = recordToolSuccessForCircuitBreaker(toolName);
    // Loop29a: successful probe (or any non-closed → closed) is operator-visible.
    if (recoveredFrom !== undefined) {
      const tip = formatCircuitBreakerRecoveredTip(toolName, recoveredFrom);
      const base =
        typeof toolResult.output === 'string' ? toolResult.output : String(toolResult.output ?? '');
      toolResult = {
        ...toolResult,
        output: base.length > 0 ? `${base}\n\n${tip}` : tip,
      };
      step.log?.info('tool circuit breaker recovered', {
        toolName,
        toolCallId: toolCall.id,
        fromState: recoveredFrom,
        code: CIRCUIT_BREAKER_RECOVERED_CODE,
      });
    }
    // Only cache successful mutations — replaying errors would hide retries.
    if (idempotencyKey !== undefined) {
      const out =
        typeof toolResult.output === 'string'
          ? toolResult.output
          : String(toolResult.output ?? '');
      recordToolCallExecution(idempotencyKey, toolName, effectiveArgs, out);
    }
  }

  // Loop24b: one-shot soft tip when identical (tool,args) hits warn threshold.
  // Hard stop is handled above; here we still executed but model must see the stall.
  if (patternCount === REPETITION_WARN_THRESHOLD) {
    const tip = formatDoomLoopWarnTip(toolName, patternCount);
    const base =
      typeof toolResult.output === 'string' ? toolResult.output : String(toolResult.output ?? '');
    toolResult =
      toolResult.isError === true
        ? { ...toolResult, output: base.length > 0 ? `${base}\n\n${tip}` : tip }
        : { ...toolResult, output: base.length > 0 ? `${base}\n\n${tip}` : tip };
    step.log?.warn('doom_loop soft warn tip attached to tool result', {
      toolName,
      toolCallId: toolCall.id,
      repetitionCount: patternCount,
    });
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
