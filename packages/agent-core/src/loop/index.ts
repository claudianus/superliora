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
  LoopTerminalStepStopReason,
  LoopTurnStopReason,
  RecordStepUsageResult,
  RecordStepUsageInfo,
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
