import { Utf8PrefixBuffer } from '@superliora/sdk';
import { STREAMING_ARGS_PREVIEW_MAX_BYTES } from '#/tui/constant/streaming';
import { appendStreamingArgsPreview, parseStreamingArgs } from '../../utils/event-payload';
import type { LivePaneState, ToolCallBlockData, ToolResultBlockData } from '../../types';
import type { ToolCallComponent } from '../../components/messages/tool-call/index';
import type { StreamingFlushState } from './flush';
import type { StreamingUIHost } from './host-types';

/** Tool-call tracking surface delegated from {@link StreamingUIController}. */
export interface StreamingUIToolRegistryState {
  readonly host: StreamingUIHost;
  readonly flushState: StreamingFlushState;
  readonly activeToolCalls: Map<string, ToolCallBlockData>;
  readonly pendingToolComponents: Map<string, ToolCallComponent>;
  readonly streamingToolCallArguments: Map<
    string,
    { name?: string; argumentsText: string; startedAtMs: number; buffer?: Utf8PrefixBuffer }
  >;
  finalizeLiveTextBuffers(nextMode?: LivePaneState['mode']): void;
  onToolCallStart(toolCall: ToolCallBlockData): void;
  onToolCallEnd(toolCallId: string, result: ToolResultBlockData): void;
}

export function registerStreamingToolCall(
  state: StreamingUIToolRegistryState,
  toolCall: ToolCallBlockData,
): boolean {
  const existing = state.activeToolCalls.get(toolCall.id);
  state.activeToolCalls.set(toolCall.id, toolCall);
  state.flushState.pendingToolCallFlushIds.delete(toolCall.id);
  state.streamingToolCallArguments.delete(toolCall.id);
  const existingComponent = state.pendingToolComponents.get(toolCall.id);
  if (existingComponent !== undefined) {
    existingComponent.updateToolCall(toolCall);
  } else if (existing === undefined) {
    state.finalizeLiveTextBuffers('tool');
    if (toolCall.name !== 'Agent') {
      state.onToolCallStart(toolCall);
    }
  }
  return existing === undefined;
}

export function accumulateStreamingToolCallDelta(
  state: StreamingUIToolRegistryState,
  id: string,
  eventName: string | undefined,
  argumentsPart: string | null | undefined,
): void {
  const existing = state.streamingToolCallArguments.get(id);
  const buffer = existing?.buffer ?? new Utf8PrefixBuffer(STREAMING_ARGS_PREVIEW_MAX_BYTES);
  if (existing?.buffer === undefined) buffer.append(existing?.argumentsText ?? '');
  const argumentsText = appendStreamingArgsPreview(existing?.argumentsText, argumentsPart, buffer);
  const name = eventName ?? existing?.name ?? state.activeToolCalls.get(id)?.name ?? 'Tool';
  const startedAtMs = existing?.startedAtMs ?? Date.now();
  state.streamingToolCallArguments.set(id, { name, argumentsText, startedAtMs, buffer });
  state.flushState.pendingToolCallFlushIds.add(id);
  state.flushState.dirtyMarksSinceFlush += 1;
}

export function getStreamingToolCallPreviewState(
  state: StreamingUIToolRegistryState,
  id: string,
):
  | { name: string; args: Record<string, unknown>; argumentsText: string; startedAtMs: number; buffer?: Utf8PrefixBuffer }
  | undefined {
  const streaming = state.streamingToolCallArguments.get(id);
  if (streaming === undefined) return undefined;
  return {
    name: streaming.name ?? state.activeToolCalls.get(id)?.name ?? 'Tool',
    args: parseStreamingArgs(streaming.argumentsText),
    argumentsText: streaming.argumentsText,
    startedAtMs: streaming.startedAtMs,
  };
}

export function completeStreamingToolResult(
  state: StreamingUIToolRegistryState,
  toolCallId: string,
  result: ToolResultBlockData,
): ToolCallBlockData | undefined {
  const matchedCall = state.activeToolCalls.get(toolCallId);
  if (matchedCall !== undefined) {
    state.onToolCallEnd(toolCallId, result);
  }
  state.activeToolCalls.delete(toolCallId);
  state.streamingToolCallArguments.delete(toolCallId);
  return matchedCall;
}

export function markStreamingStepTruncated(
  state: StreamingUIToolRegistryState,
  turnId: string,
  step: number,
): number {
  let count = 0;
  for (const toolCall of state.activeToolCalls.values()) {
    if (toolCall.result !== undefined) continue;
    if (toolCall.streamingArguments === undefined) continue;
    if (toolCall.turnId !== turnId) continue;
    if (toolCall.step !== step) continue;
    toolCall.truncated = true;
    const component = state.pendingToolComponents.get(toolCall.id);
    if (component !== undefined) {
      component.updateToolCall(toolCall);
    }
    count += 1;
  }
  state.streamingToolCallArguments.clear();
  return count;
}
