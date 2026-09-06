/**
 * Type-level lock on the loop's public surface.
 *
 * The point is to make refactors that *unintentionally* widen / narrow /
 * remove a public type a compile error rather than a quiet binary
 * regression. Real behavioural assertions live in the other e2e files;
 * this file is the structural complement to them.
 *
 * Type checks live inside a never-called function body so they run during
 * compile (`tsc --noEmit`) but cost nothing at runtime.
 */

import type { ContentPart, ModelCapability, TokenUsage } from '@superliora/kosong';

import { createLoopEventDispatcher, runTurn, ToolAccesses } from '../../src/loop/index';
import type {
  AfterStepHook,
  BeforeStepResult,
  BeforeStepHook,
  ExecutableTool,
  LLM,
  LLMChatParams,
  LLMChatResponse,
  RunTurnInput,
  ShouldContinueAfterStopHook,
  ShouldContinueAfterStopResult,
  LoopRecordedEvent,
  LoopLiveOnlyEvent,
  LoopEvent,
  LoopHooks,
  LoopInterruptReason,
  LoopLiveEventEmitter,
  LoopMessageBuilder,
  LoopEventDispatcher,
  LoopAfterStepContext,
  LoopStepHookContext,
  LoopTextDeltaEvent,
  LoopThinkingDeltaEvent,
  LoopToolCallDeltaEvent,
  LoopContentPartEvent,
  LoopStepBeginEvent,
  LoopStepEndEvent,
  LoopToolCallEvent,
  LoopToolProgressEvent,
  LoopToolResultEvent,
  LoopTurnInterruptedEvent,
  LoopStepStopReason,
  LoopStoppedStepContext,
  LoopTerminalStepStopReason,
  LoopTurnStopReason,
  ToolCallDelta,
  ToolCall,
  ExecutableToolContext,
  ToolExecutionHookContext,
  PrepareToolExecutionHook,
  PrepareToolExecutionResult,
  ExecutableToolResult,
  FinalizeToolResultContext,
  FinalizeToolResultHook,
  TurnResult,
} from '../../src/loop/index';
