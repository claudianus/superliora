import type { ToolCall } from '@superliora/sdk';

import { ToolCallComponent } from '../../components/messages/tool-call/index';
import type { ToolCallBlockData, ToolResultBlockData } from '../../types';
import {
  REPLAY_MAX_TOOL_MOUNTS_PER_TURN,
  replayEntry,
  toolCallFromReplayMessage,
  toolResultOutput,
  type ReplayRenderContext,
} from '../../utils/session/message-replay';
import type { SessionReplayHost } from './types';

export class SessionReplayToolContext {
  constructor(private readonly host: SessionReplayHost) {}

  renderToolCalls(context: ReplayRenderContext, toolCalls: readonly ToolCall[]): void {
    if (toolCalls.length === 0) return;
    const { streamingUI } = this.host;
    context.stepIndex += 1;
    this.applyStepContext(context);

    // Prefer the newest tools when a single assistant step exceeds the mount budget.
    // Older excess tools stay registered for result bookkeeping but skip UI mount.
    const remaining = Math.max(0, REPLAY_MAX_TOOL_MOUNTS_PER_TURN - context.mountedToolCountThisTurn);
    const parsed: ToolCallBlockData[] = [];
    for (const rawToolCall of toolCalls) {
      const toolCall = toolCallFromReplayMessage(rawToolCall, context);
      if (toolCall === undefined) continue;
      context.toolCalls.set(toolCall.id, toolCall);
      parsed.push(toolCall);
    }
    const mountFrom = remaining >= parsed.length ? 0 : parsed.length - remaining;
    for (let i = 0; i < parsed.length; i++) {
      const toolCall = parsed[i]!;
      streamingUI.setActiveToolCall(toolCall.id, toolCall);
      if (i < mountFrom) {
        context.suppressedToolCountThisTurn += 1;
        continue;
      }
      streamingUI.onToolCallStart(toolCall);
      context.mountedToolCallIds.add(toolCall.id);
      context.mountedToolCountThisTurn += 1;
    }
  }

  renderToolResult(context: ReplayRenderContext, toolCallId: string, content: unknown, isError: boolean): void {
    const call = context.toolCalls.get(toolCallId);
    if (call === undefined) return;

    const result: ToolResultBlockData = {
      tool_call_id: toolCallId,
      output: toolResultOutput(content),
      is_error: isError,
    };
    call.result = result;
    this.applyStepContext(context);
    // Skipped mounts never created a component; still clear active-tool bookkeeping.
    if (context.mountedToolCallIds.has(toolCallId)) {
      this.host.streamingUI.onToolCallEnd(toolCallId, result);
    }
    this.host.streamingUI.removeActiveToolCall(toolCallId);
    context.completedToolCallIds.add(toolCallId);
  }

  advanceTurn(context: ReplayRenderContext): void {
    this.flushSuppressedToolNotice(context);
    context.turnIndex += 1;
    context.stepIndex = 0;
    context.mountedToolCountThisTurn = 0;
    context.suppressedToolCountThisTurn = 0;
    context.currentTurnId = `replay:${String(context.turnIndex)}`;
    this.applyStepContext(context);
  }

  flushSuppressedToolNotice(context: ReplayRenderContext): void {
    if (context.suppressedToolCountThisTurn <= 0) return;
    const n = context.suppressedToolCountThisTurn;
    context.suppressedToolCountThisTurn = 0;
    this.host.appendTranscriptEntry(
      replayEntry(
        context,
        'status',
        `… ${String(n)} earlier tool step${n === 1 ? '' : 's'} hidden (history cap)`,
        'notice',
      ),
    );
  }

  applyStepContext(context: ReplayRenderContext): void {
    this.host.streamingUI.setTurnId(context.currentTurnId);
    this.host.streamingUI.setStep(context.stepIndex);
  }

  flushAssistant(context: ReplayRenderContext): void {
    const { streamingUI } = this.host;
    const thinking = context.assistant.thinking.join('');
    const text = context.assistant.text.join('');
    context.assistant = { thinking: [], text: [] };
    this.applyStepContext(context);

    if (thinking.length > 0) {
      streamingUI.onThinkingUpdate(thinking);
      streamingUI.onThinkingEnd();
    }
    if (text.length > 0) {
      streamingUI.onStreamingTextStart();
      streamingUI.onStreamingTextUpdate(text);
      streamingUI.onStreamingTextEnd();
      streamingUI.clearAssistantDraft();
    }
  }

  cleanupRuntime(context: ReplayRenderContext): void {
    this.flushAssistant(context);
    this.flushSuppressedToolNotice(context);
    this.host.streamingUI.cleanupAfterReplay(context.completedToolCallIds);
  }

  removeToolCall(toolCallId: string): void {
    const { state, streamingUI } = this.host;
    streamingUI.removeActiveToolCall(toolCallId);
    streamingUI.removeToolComponent(toolCallId);
    const index = state.transcriptEntries.findIndex(
      (entry) => entry.toolCallData?.id === toolCallId,
    );
    if (index >= 0) state.transcriptEntries.splice(index, 1);
    const children = state.transcriptContainer.children;
    const childIndex = children.findIndex(
      (child) => child instanceof ToolCallComponent && child.toolCallView.id === toolCallId,
    );
    if (childIndex >= 0) {
      children.splice(childIndex, 1);
      state.transcriptContainer.invalidate();
    }
  }
}
