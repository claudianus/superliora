/**
 * Public entry point for the stateless agent loop.
 *
 * Higher-level orchestration may import from this module; this module must not
 * import from host-layer implementations.
 */

export type {
  AfterStepHook,
  AfterStepResult,
  AfterToolBatchHook,
  BeforeStepResult,
  BeforeStepHook,
  LoopHooks,
  LoopAfterStepContext,
  LoopToolBatchContext,
  LoopStepHookContext,
  LoopStepStopReason,
  LoopStoppedStepContext,
  LoopTerminalStepStopReason,
  LoopTurnStopReason,
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
  DOOM_LOOP_WARN_PREFIX,
  REPETITION_HARD_STOP_THRESHOLD,
  REPETITION_WARN_THRESHOLD,
  checkToolCallIdempotency,
  formatDoomLoopWarnTip,
  getCircuitBreakerState,
  getToolCallPatternCount,
  isToolCircuitOpen,
  recordToolCallExecution,
  recordToolFailureForCircuitBreaker,
  recordToolSuccessForCircuitBreaker,
  resetCircuitBreakers,
  resetIdempotencyTracker,
  resetToolFailureTracker,
  toolCallIdempotencyKey,
  trackToolCallPattern,
} from './tool-call-guards';
export {
  CIRCUIT_BREAKER_RECOVERED_CODE,
  IDEMPOTENCY_REPLAY_CODE,
  SLOW_TOOL_THRESHOLD_MS,
  SLOW_TOOL_WARN_PREFIX,
  formatCircuitBreakerProbeFailedTip,
  formatCircuitBreakerRecoveredTip,
  formatSlowToolWarnTip,
} from './tool-call-execute';
export type { CircuitBreakerState, ToolCallPatternVerdict } from './tool-call-guards';
