import type { LoopEventDispatcher, LoopToolCallEvent } from './events';
import type { LLM } from './llm';
import type { ToolCallTask } from './tool-scheduler';
import type { ToolParallelStatus } from './tool-parallel-status';
import type { Logger } from '#/logging/types';
import type {
  ExecutableTool,
  ExecutableToolResult,
  LoopHooks,
  ToolCall,
} from './types';

export interface ToolCallStepContext {
  readonly tools?: readonly ExecutableTool[] | undefined;
  readonly hooks?: LoopHooks | undefined;
  readonly log?: Logger | undefined;
  readonly dispatchEvent: LoopEventDispatcher;
  readonly llm: LLM;
  readonly signal: AbortSignal;
  readonly turnId: string;
  readonly currentStep: number;
  readonly stepUuid: string;
  readonly toolParallelStatus?: ToolParallelStatus | undefined;
}

export interface ToolCallBatchContext extends ToolCallStepContext {
  readonly toolCalls: readonly ToolCall[];
}

export type PreflightedToolCall = RunnableToolCall | RejectedToolCall;

export interface RunnableToolCall {
  readonly kind: 'runnable';
  readonly toolCall: ToolCall;
  readonly toolName: string;
  readonly tool: ExecutableTool;
  readonly args: unknown;
}

export interface RejectedToolCall {
  readonly kind: 'rejected';
  readonly toolCall: ToolCall;
  readonly toolName: string;
  readonly args: unknown;
  readonly output: string;
}

export type PrepareToolExecutionDecision =
  | {
      readonly kind: 'allowed';
      readonly args: unknown;
      readonly metadata?: unknown;
      /** Per-call force-stop signal combined with the turn signal (V1-4). */
      readonly executionSignal?: AbortSignal | undefined;
    }
  | { readonly kind: 'synthetic'; readonly args: unknown; readonly result: ExecutableToolResult }
  | { readonly kind: 'blocked'; readonly args: unknown; readonly output: string }
  | { readonly kind: 'hookFailed'; readonly args: unknown; readonly output: string };

export interface PendingToolResult {
  readonly toolCall: ToolCall;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: ExecutableToolResult;
  readonly stopTurn?: boolean | undefined;
}

export interface PreparedToolCallTask {
  readonly task: ToolCallTask<PendingToolResult>;
  readonly stopBatchAfterThis?: boolean | undefined;
  /** True when a `tool.intend` was dispatched for this call (needs an ack). */
  readonly intended?: boolean | undefined;
}

export type ToolCallDisplayFields = Pick<LoopToolCallEvent, 'description' | 'display'>;

export interface ToolCallBatchResult {
  readonly stopTurn: boolean;
}
