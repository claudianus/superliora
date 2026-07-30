import type { ToolCallBlockData } from '../../types';
import type { ToolCallComponent } from '../../components/messages/tool-call/index';

export function getStreamingActiveToolCall(
  activeToolCalls: Map<string, ToolCallBlockData>,
  id: string,
): ToolCallBlockData | undefined {
  return activeToolCalls.get(id);
}

export function hasStreamingActiveToolCall(
  activeToolCalls: Map<string, ToolCallBlockData>,
  id: string,
): boolean {
  return activeToolCalls.has(id);
}

export function setStreamingActiveToolCall(
  activeToolCalls: Map<string, ToolCallBlockData>,
  id: string,
  toolCall: ToolCallBlockData,
): void {
  activeToolCalls.set(id, toolCall);
}

export function removeStreamingActiveToolCall(
  activeToolCalls: Map<string, ToolCallBlockData>,
  id: string,
): void {
  activeToolCalls.delete(id);
}

export function getStreamingToolComponent(
  pendingToolComponents: Map<string, ToolCallComponent>,
  id: string,
): ToolCallComponent | undefined {
  return pendingToolComponents.get(id);
}

export function removeStreamingToolComponent(
  pendingToolComponents: Map<string, ToolCallComponent>,
  id: string,
): void {
  pendingToolComponents.delete(id);
}

export function removeStreamingToolComponentIfInactive(
  activeToolCalls: Map<string, ToolCallBlockData>,
  pendingToolComponents: Map<string, ToolCallComponent>,
  toolCallId: string,
): void {
  if (!activeToolCalls.has(toolCallId)) {
    pendingToolComponents.delete(toolCallId);
  }
}
