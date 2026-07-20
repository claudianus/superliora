/**
 * Public entry point for the stateless agent loop.
 *
 * Higher-level orchestration may import from this module; this module must not
 * import from host-layer implementations.
 */

export type {
  AfterStepHook,
  AfterStepResult,
  BeforeStepResult,
  BeforeStepHook,
  LoopHooks,
  LoopAfterStepContext,
  LoopStepHookContext,
  LoopStepStopReason,
  LoopStoppedStepContext,
  LoopTerminalStepStopReason,
  LoopTurnStopReason,
  StopReason,
  RecordStepUsageResult,
  RecordStepUsageInfo,
  ShouldContinueAfterStopHook,
  ShouldContinueAfterStopResult,
  LoopMessageBuilder,
  ExecutableTool,
  ToolExecution,
  ToolCall,
  ExecutableToolContext,
  ToolExecutionHookContext,
  ResolvedToolExecutionHookContext,
  PrepareToolExecutionHook,
  AuthorizeToolExecutionHook,
  PrepareToolExecutionResult,
  ExecutableToolResult,
  FinalizeToolResultContext,
  FinalizeToolResultHook,
  ToolUpdate,
  TurnResult,
} from './types';

export { ToolAccesses } from './tool-access';

export type {
  CreateLoopEventDispatcherInput,
  LoopContentPartEvent,
  LoopRecordedEvent,
  LoopStepBeginEvent,
  LoopStepEndEvent,
  LoopStepRetryingEvent,
  LoopLiveOnlyEvent,
  LoopEvent,
  LoopInterruptReason,
  LoopLiveEventEmitter,
  LoopEventDispatcher,
  LoopTextDeltaEvent,
  LoopThinkingDeltaEvent,
  LoopToolAckEvent,
  LoopToolCallDeltaEvent,
  LoopToolCallEvent,
  LoopToolIntendEvent,
  LoopToolProgressEvent,
  LoopToolResultEvent,
  LoopTurnInterruptedEvent,
} from './events';
export { createLoopEventDispatcher } from './events';

export type {
  LLM,
  LLMChatParams,
  LLMChatResponse,
  LLMRequestLogFields,
  LLMStreamTiming,
  ToolCallDelta,
} from './llm';

export { runTurn } from './run-turn';
export type { RunTurnInput } from './run-turn';
export {
  checkToolCallIdempotency,
  getCircuitBreakerState,
  isToolCircuitOpen,
  recordToolCallExecution,
  recordToolFailureForCircuitBreaker,
  recordToolSuccessForCircuitBreaker,
  resetCircuitBreakers,
  resetIdempotencyTracker,
  resetToolFailureTracker,
  toolCallIdempotencyKey,
} from './tool-call';
export type { CircuitBreakerState } from './tool-call';
