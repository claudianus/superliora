import type { FinishReason, TextPart, ThinkPart, TokenUsage } from '@superliora/kosong';

import type { LLMProviderRouteSelection } from './llm';
import type { ToolInputDisplay } from '../tools/display';
import type { ExecutableToolResult, LoopStepStopReason, ToolUpdate } from './types';

export type LoopInterruptReason = 'aborted' | 'max_steps' | 'error';

export interface LoopStepBeginEvent {
  readonly type: 'step.begin';
  readonly uuid: string;
  readonly turnId: string;
  readonly step: number;
}

export interface LoopStepEndEvent {
  readonly type: 'step.end';
  readonly uuid: string;
  readonly turnId: string;
  readonly step: number;
  readonly usage?: TokenUsage | undefined;
  readonly finishReason?: LoopStepStopReason | undefined;
  readonly llmFirstTokenLatencyMs?: number | undefined;
  readonly llmStreamDurationMs?: number | undefined;
  readonly llmRequestBuildMs?: number | undefined;
  readonly llmServerFirstTokenMs?: number | undefined;
  readonly llmServerDecodeMs?: number | undefined;
  readonly llmClientConsumeMs?: number | undefined;
  /**
   * Provider diagnostics are optional and must not drive loop control.
   * Use `finishReason` for normalized behavior.
   */
  readonly providerFinishReason?: FinishReason | undefined;
  readonly rawFinishReason?: string | undefined;
  readonly providerRouteSelection?: LLMProviderRouteSelection | undefined;
}

export interface LoopStepRetryingEvent {
  readonly type: 'step.retrying';
  readonly turnId: string;
  readonly step: number;
  readonly stepUuid: string;
  readonly failedAttempt: number;
  readonly nextAttempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly statusCode?: number;
}

export interface LoopContentPartEvent {
  readonly type: 'content.part';
  readonly uuid: string;
  readonly turnId: string;
  readonly step: number;
  readonly stepUuid: string;
  readonly part: TextPart | ThinkPart;
}

export interface LoopToolCallEvent {
  readonly type: 'tool.call';
  readonly uuid: string;
  readonly turnId: string;
  readonly step: number;
  readonly stepUuid: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly args: unknown;
  readonly description?: string | undefined;
  readonly display?: ToolInputDisplay | undefined;
  readonly extras?: Record<string, unknown> | undefined;
}

/**
 * Pre-execution intent log for a tool call that will produce durable side
 * effects (file writes, shell commands). Persisted and fsync'd *before* the
 * tool runs, so that a crash mid-execution leaves a durable record of what was
 * attempted — letting resume distinguish "never started" from "started,
 * unknown completion" and, for file writes, verify idempotently whether the
 * intended content already landed.
 */
export interface LoopToolIntendEvent {
  readonly type: 'tool.intend';
  readonly toolCallId: string;
  readonly name: string;
  readonly args: unknown;
  /**
   * File paths this call is expected to write (derived from the tool's
   * declared accesses). Present only for file-mutating tools; absent for
   * side effects that are not file-backed (shell, network).
   */
  readonly writePaths?: readonly string[] | undefined;
}

/**
 * Post-execution acknowledgment paired with {@link LoopToolIntendEvent}. A
 * crash that leaves an `intend` without a matching `ack` means execution may
 * or may not have completed — the resume path reconciles accordingly.
 */
export interface LoopToolAckEvent {
  readonly type: 'tool.ack';
  readonly parentUuid: string;
  readonly toolCallId: string;
}

export interface LoopToolResultEvent {
  readonly type: 'tool.result';
  readonly parentUuid: string;
  readonly toolCallId: string;
  readonly result: ExecutableToolResult;
}

export interface LoopTurnInterruptedEvent {
  readonly type: 'turn.interrupted';
  readonly reason: LoopInterruptReason;
  readonly attemptedSteps: number;
  readonly activeStep?: number | undefined;
  readonly message?: string | undefined;
  readonly cancelledByUser?: boolean | undefined;
}

export interface LoopTextDeltaEvent {
  readonly type: 'text.delta';
  readonly delta: string;
}

export interface LoopThinkingDeltaEvent {
  readonly type: 'thinking.delta';
  readonly delta: string;
}

export interface LoopToolCallDeltaEvent {
  readonly type: 'tool.call.delta';
  readonly toolCallId: string;
  readonly name?: string | undefined;
  readonly argumentsPart?: string | undefined;
}

export interface LoopToolProgressEvent {
  readonly type: 'tool.progress';
  readonly toolCallId: string;
  readonly update: ToolUpdate;
}

export type LoopRecordedEvent =
  | LoopStepBeginEvent
  | LoopStepEndEvent
  | LoopContentPartEvent
  | LoopToolCallEvent
  | LoopToolIntendEvent
  | LoopToolAckEvent
  | LoopToolResultEvent;

export type LoopLiveOnlyEvent =
  | LoopTurnInterruptedEvent
  | LoopStepRetryingEvent
  | LoopTextDeltaEvent
  | LoopThinkingDeltaEvent
  | LoopToolCallDeltaEvent
  | LoopToolProgressEvent;

export type LoopEvent = LoopRecordedEvent | LoopLiveOnlyEvent;
export type LoopLiveEventEmitter = (event: LoopEvent) => void;

export type LoopEventDispatcher = {
  (event: LoopRecordedEvent): Promise<void>;
  (event: LoopLiveOnlyEvent): void;
};

export interface CreateLoopEventDispatcherInput {
  readonly appendTranscriptRecord: (record: LoopRecordedEvent) => Promise<void>;
  readonly emitLiveEvent?: LoopLiveEventEmitter | undefined;
}

export function createLoopEventDispatcher(
  input: CreateLoopEventDispatcherInput,
): LoopEventDispatcher {
  function dispatchEvent(event: LoopRecordedEvent): Promise<void>;
  function dispatchEvent(event: LoopLiveOnlyEvent): void;
  function dispatchEvent(event: LoopEvent): Promise<void> | void {
    if (isRecordedEvent(event)) {
      return recordEvent(input, event);
    }
    safeEmitLive(input.emitLiveEvent, event);
  }
  return dispatchEvent;
}

function isRecordedEvent(event: LoopEvent): event is LoopRecordedEvent {
  return (
    event.type === 'step.begin' ||
    event.type === 'step.end' ||
    event.type === 'content.part' ||
    event.type === 'tool.call' ||
    event.type === 'tool.intend' ||
    event.type === 'tool.ack' ||
    event.type === 'tool.result'
  );
}

async function recordEvent(
  input: CreateLoopEventDispatcherInput,
  event: LoopRecordedEvent,
): Promise<void> {
  await input.appendTranscriptRecord(event);
  safeEmitLive(input.emitLiveEvent, event);
}

function safeEmitLive(emit: LoopLiveEventEmitter | undefined, event: LoopEvent): void {
  if (emit === undefined) return;
  let maybePromise: unknown;
  try {
    maybePromise = (emit as (event: LoopEvent) => unknown)(event);
  } catch {
    return;
  }
  if (
    maybePromise !== undefined &&
    maybePromise !== null &&
    typeof (maybePromise as { then?: unknown }).then === 'function' &&
    typeof (maybePromise as { catch?: unknown }).catch === 'function'
  ) {
    (maybePromise as Promise<unknown>).catch(() => {
      // Live listeners are best-effort; their failures must not affect the turn.
    });
  }
}
