/**
 * Turn telemetry tracking — extracted from TurnFlow.
 *
 * Encapsulates per-turn telemetry state (tool-call timing, dedup detection,
 * step tracking, interruption records) and the classification helpers for
 * API errors and tool outcomes.
 */

import { createHash } from 'node:crypto';
import {
  APIConnectionError,
  APIEmptyResponseError,
  APIStatusError,
  APITimeoutError,
  inputTotal,
  isContextOverflowStatusError,
  type TokenUsage,
} from '@superliora/kosong';

import type { Agent } from '..';
import { ErrorCodes, type LioraErrorPayload } from '#/errors';
import type { LoopEvent, LoopTurnInterruptedEvent, ExecutableToolResult } from '../../loop/index';
import type { TelemetryPropertyValue } from '../../telemetry';
import { canonicalTelemetryArgs, isPlainRecord } from './canonical-args';

// ---------------------------------------------------------------------------
// TurnTelemetry class
// ---------------------------------------------------------------------------

export class TurnTelemetry {
  private readonly toolCallStartedAt = new Map<string, { name: string; startedAt: number }>();
  private readonly toolCallDupType = new Map<string, 'normal' | 'cross_step'>();
  private readonly stepToolCallKeys = new Map<number, Set<string>>();
  private readonly telemetryModeByTurn = new Map<number, 'agent' | 'plan'>();
  private readonly currentStepByTurn = new Map<number, number>();
  private readonly interruptedTelemetryTurnIds = new Set<number>();
  private readonly stepFailureByTurn = new Map<number, LoopTurnInterruptedEvent>();
  currentStep = 0;

  constructor(private readonly agent: Agent) {}

  /** Resets per-turn transient state (called at the start of each turn). */
  resetForTurn(turnId: number, mode: 'agent' | 'plan'): void {
    this.currentStep = 0;
    this.stepToolCallKeys.clear();
    this.toolCallDupType.clear();
    this.telemetryModeByTurn.set(turnId, mode);
    this.currentStepByTurn.set(turnId, 0);
  }

  /** Cleans up per-turn maps after a turn completes. */
  cleanupTurn(turnId: number): void {
    this.telemetryModeByTurn.delete(turnId);
    this.currentStepByTurn.delete(turnId);
    this.interruptedTelemetryTurnIds.delete(turnId);
    this.stepFailureByTurn.delete(turnId);
  }

  trackLoopTelemetry(event: LoopEvent, turnId: number): void {
    if (event.type === 'step.begin') {
      this.beginTrackedStep(turnId, event.step);
      return;
    }
    if (event.type === 'turn.interrupted') {
      if (event.reason === 'error' && event.activeStep !== undefined) {
        this.stepFailureByTurn.set(turnId, event);
      }
      this.trackTurnInterrupted(turnId, interruptedStep(event));
      return;
    }
    this.trackToolLifecycle(event, turnId);
  }

  trackTurnInterrupted(turnId: number, atStep: number): void {
    if (this.interruptedTelemetryTurnIds.has(turnId)) return;
    this.interruptedTelemetryTurnIds.add(turnId);
    this.agent.telemetry.track('turn_interrupted', {
      mode: this.telemetryModeByTurn.get(turnId) ?? this.telemetryMode(),
      at_step: atStep,
    });
  }

  telemetryMode(): 'agent' | 'plan' {
    return this.agent.planMode.isActive ? 'plan' : 'agent';
  }

  shouldTrackApiError(turnId: number): boolean {
    const failure = this.stepFailureByTurn.get(turnId);
    return failure?.reason === 'error' && failure.activeStep !== undefined;
  }

  currentStepForTurn(turnId: number): number {
    return this.currentStepByTurn.get(turnId) ?? this.currentStep;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private beginTrackedStep(turnId: number, step: number): void {
    this.currentStepByTurn.set(turnId, step);
    this.currentStep = step;
    if (!this.stepToolCallKeys.has(step)) {
      this.stepToolCallKeys.set(step, new Set());
    }
  }

  private trackToolLifecycle(event: LoopEvent, turnId: number): void {
    if (event.type === 'tool.call') {
      const dupType = this.trackDuplicateToolCall(turnId, event.step, event.name, event.args);
      this.toolCallDupType.set(
        event.toolCallId,
        dupType === 'cross_step' ? 'cross_step' : 'normal',
      );
      this.toolCallStartedAt.set(event.toolCallId, {
        name: event.name,
        startedAt: Date.now(),
      });
      return;
    }
    if (event.type === 'tool.result') {
      const started = this.toolCallStartedAt.get(event.toolCallId);
      if (started === undefined) return;
      this.toolCallStartedAt.delete(event.toolCallId);
      const dupType = this.toolCallDupType.get(event.toolCallId) ?? 'normal';
      this.toolCallDupType.delete(event.toolCallId);
      const outcome = telemetryToolOutcome(event.result);
      const properties: Record<string, TelemetryPropertyValue> = {
        tool_name: started.name,
        outcome,
        duration_ms: Date.now() - started.startedAt,
        dup_type: dupType,
      };
      const errorType = outcome === 'error' ? telemetryToolErrorType(event.result) : undefined;
      if (errorType !== undefined) {
        properties['error_type'] = errorType;
      }
      this.agent.telemetry.track('tool_call', properties);
    }
  }

  private trackDuplicateToolCall(
    turnId: number,
    step: number,
    toolName: string,
    args: unknown,
  ): 'normal' | 'same_step' | 'cross_step' {
    const argsText = canonicalTelemetryArgs(args);
    const key = `${toolName}\u0000${argsText}`;
    const stepKeys = this.stepToolCallKeys.get(step) ?? new Set<string>();
    this.stepToolCallKeys.set(step, stepKeys);

    let dupType: 'same_step' | 'cross_step' | undefined;
    if (stepKeys.has(key)) {
      dupType = 'same_step';
    } else if (this.hasPriorStepToolCallKey(step, key)) {
      dupType = 'cross_step';
    }

    stepKeys.add(key);
    if (dupType === undefined) return 'normal';

    this.agent.telemetry.track('tool_call_dedup_detected', {
      turn_id: turnId,
      step_no: step,
      tool_name: toolName,
      dup_type: dupType,
      args_hash: createHash('sha256').update(argsText).digest('hex').slice(0, 8),
    });
    return dupType;
  }

  private hasPriorStepToolCallKey(step: number, key: string): boolean {
    for (const [seenStep, keys] of this.stepToolCallKeys) {
      if (seenStep !== step && keys.has(key)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (exported for use by TurnFlow and tests)
// ---------------------------------------------------------------------------

export function interruptedStep(event: LoopTurnInterruptedEvent): number {
  const step = event.activeStep ?? event.attemptedSteps;
  return Object.is(step, -0) ? 0 : step;
}

export function toolInputRecord(args: unknown): Record<string, unknown> {
  return isPlainRecord(args) ? args : {};
}

export function toolOutputText(output: ExecutableToolResult['output']): string {
  if (typeof output === 'string') return output;
  return output
    .filter((part): part is Extract<(typeof output)[number], { type: 'text' }> => {
      return typeof part === 'object' && part !== null && part.type === 'text';
    })
    .map((part) => part.text)
    .join('');
}

export function currentTurnInputTokens(usage: TokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined;
  return inputTotal(usage);
}

// ---------------------------------------------------------------------------
// API error classification
// ---------------------------------------------------------------------------

export interface ApiErrorClassification {
  readonly errorType: string;
  readonly statusCode?: number;
}

export function classifyApiError(error: unknown, summary: LioraErrorPayload): ApiErrorClassification {
  const statusCode = apiStatusCode(error) ?? summaryStatusCode(summary);
  if (statusCode !== undefined) {
    if (statusCode === 429) return { errorType: 'rate_limit', statusCode };
    if (statusCode === 401 || statusCode === 403) return { errorType: 'auth', statusCode };
    if (statusCode >= 500) return { errorType: '5xx_server', statusCode };
    if (isContextOverflowStatusError(statusCode, summary.message)) {
      return { errorType: 'context_overflow', statusCode };
    }
    if (statusCode >= 400) return { errorType: '4xx_client', statusCode };
    return { errorType: 'api', statusCode };
  }

  if (summary.code === ErrorCodes.PROVIDER_RATE_LIMIT) return { errorType: 'rate_limit' };
  if (summary.code === ErrorCodes.PROVIDER_AUTH_ERROR) return { errorType: 'auth' };
  if (summary.code === ErrorCodes.CONTEXT_OVERFLOW) return { errorType: 'context_overflow' };
  if (isApiConnectionError(error, summary)) return { errorType: 'network' };
  if (isApiTimeoutError(error, summary)) return { errorType: 'timeout' };
  if (isApiEmptyResponseError(error, summary)) return { errorType: 'empty_response' };
  return { errorType: 'other' };
}

// ---------------------------------------------------------------------------
// Tool telemetry outcome helpers
// ---------------------------------------------------------------------------

type ToolTelemetryResult = Extract<LoopEvent, { type: 'tool.result' }>['result'];

export function telemetryToolOutcome(result: ToolTelemetryResult): 'success' | 'error' | 'cancelled' {
  if (result.isError !== true) return 'success';
  const text = toolResultText(result).toLowerCase();
  return text.includes('aborted') ||
    text.includes('cancelled') ||
    text.includes('manually interrupted')
    ? 'cancelled'
    : 'error';
}

export function telemetryToolErrorType(result: ToolTelemetryResult): string {
  const text = toolResultText(result);
  if (text.startsWith('Tool "') && text.includes('" not found')) return 'ToolNotFound';
  if (text.startsWith('Invalid args for tool "')) return 'ToolInputError';
  if (text.includes('prepareToolExecution hook failed')) return 'HookError';
  if (text.includes('finalizeToolResult hook failed')) return 'HookError';
  if (text.includes('blocked')) return 'ToolBlocked';
  return 'ToolError';
}

function toolResultText(result: ToolTelemetryResult): string {
  return toolOutputText(result.output);
}

// ---------------------------------------------------------------------------
// Internal classification helpers
// ---------------------------------------------------------------------------

function apiStatusCode(error: unknown): number | undefined {
  if (error instanceof APIStatusError) {
    const statusCode = (error as { readonly statusCode?: unknown }).statusCode;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode = (error as { readonly statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;
  const status = (error as { readonly status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function summaryStatusCode(summary: LioraErrorPayload): number | undefined {
  const statusCode = summary.details?.['statusCode'];
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function isApiConnectionError(error: unknown, summary: LioraErrorPayload): boolean {
  return error instanceof APIConnectionError || summary.name === 'APIConnectionError';
}

function isApiTimeoutError(error: unknown, summary: LioraErrorPayload): boolean {
  return (
    error instanceof APITimeoutError ||
    summary.name === 'APITimeoutError' ||
    summary.name === 'TimeoutError'
  );
}

function isApiEmptyResponseError(error: unknown, summary: LioraErrorPayload): boolean {
  return error instanceof APIEmptyResponseError || summary.name === 'APIEmptyResponseError';
}
