import type { ToolCallBlockData, ToolResultBlockData } from '../../types';
import {
  discardPendingFlush as discardPendingFlushHelper,
  flushNow as flushNowHelper,
  hasPendingFlush,
  runPendingFlush,
  scheduleFlush as scheduleFlushHelper,
  type StreamingFlushState,
} from './flush';
import {
  onStreamingTextEnd as onStreamingTextEndHelper,
  onStreamingTextStart as onStreamingTextStartHelper,
  onStreamingTextUpdate as onStreamingTextUpdateHelper,
  onThinkingEnd as onThinkingEndHelper,
  onThinkingUpdate as onThinkingUpdateHelper,
  type TextRenderContext,
} from './text-render';
import {
  flushToolCallPreview as flushToolCallPreviewHelper,
  onToolCallEnd as onToolCallEndHelper,
  onToolCallStart as onToolCallStartHelper,
  type ToolRenderContext,
} from './tool-render';
import {
  resetRevealChannels as resetRevealChannelsHelper,
  shouldSmoothStreamReveal as shouldSmoothStreamRevealHelper,
  type StreamingRevealContext,
} from './reveal';
import { buildRevealContext, type StreamingRenderContextState } from './render-context';
import { settleActiveChainSummary as settleActiveChainSummaryHelper, type ChainSummaryState } from './chain-summary';

export function streamingUiHasPending(flushState: StreamingFlushState): boolean {
  return hasPendingFlush(flushState);
}

export function streamingUiClearFlushTimer(flushState: StreamingFlushState): void {
  if (flushState.flushTimer === undefined) return;
  clearTimeout(flushState.flushTimer);
  flushState.flushTimer = undefined;
  flushState.scheduledFlushAt = undefined;
}

export function streamingUiDiscardPending(
  flushState: StreamingFlushState,
  resetRevealChannels: () => void,
): void {
  discardPendingFlushHelper(flushState);
  resetRevealChannels();
}

export function streamingUiScheduleFlush(flushState: StreamingFlushState, flush: () => void): void {
  scheduleFlushHelper(flushState, flush);
}

export function streamingUiFlushNow(flushState: StreamingFlushState, flush: () => void): void {
  flushNowHelper(flushState, flush);
}

export function streamingUiRunPendingFlush(
  flushState: StreamingFlushState,
  handlers: {
    onThinkingFlush: () => void;
    onAssistantFlush: () => void;
    onToolCallFlush: (id: string) => void;
  },
): void {
  runPendingFlush(flushState, handlers);
}

export function streamingUiOnStreamingTextStart(ctx: TextRenderContext): void {
  onStreamingTextStartHelper(ctx);
}

export function streamingUiOnStreamingTextUpdate(ctx: TextRenderContext, fullText: string): void {
  onStreamingTextUpdateHelper(ctx, fullText);
}

export function streamingUiOnStreamingTextEnd(ctx: TextRenderContext): void {
  onStreamingTextEndHelper(ctx);
}

export function streamingUiOnThinkingUpdate(ctx: TextRenderContext, fullText: string): void {
  onThinkingUpdateHelper(ctx, fullText);
}

export function streamingUiOnThinkingEnd(ctx: TextRenderContext): void {
  onThinkingEndHelper(ctx);
}

export function streamingUiOnToolCallStart(ctx: ToolRenderContext, toolCall: ToolCallBlockData): void {
  onToolCallStartHelper(ctx, toolCall);
}

export function streamingUiOnToolCallEnd(
  ctx: ToolRenderContext,
  toolCallId: string,
  result: ToolResultBlockData,
): void {
  onToolCallEndHelper(ctx, toolCallId, result);
}

export function streamingUiFlushToolCallPreview(ctx: ToolRenderContext, id: string): void {
  flushToolCallPreviewHelper(ctx, id);
}

export function streamingUiShouldSmoothStreamReveal(isReplaying: boolean): boolean {
  return shouldSmoothStreamRevealHelper(isReplaying);
}

export function streamingUiResetRevealChannels(
  renderContextState: StreamingRenderContextState,
  nowMs = 0,
): void {
  resetRevealChannelsHelper(buildRevealContext(renderContextState), nowMs);
}

export function streamingUiRevealContext(
  renderContextState: StreamingRenderContextState,
): StreamingRevealContext {
  return buildRevealContext(renderContextState);
}

export function streamingUiSettleActiveChainSummary(chainSummary: ChainSummaryState): void {
  settleActiveChainSummaryHelper(chainSummary);
}
