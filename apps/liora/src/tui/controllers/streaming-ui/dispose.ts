import { hasDispose } from '../../utils/component-capabilities';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  clearRevealTimer as clearRevealTimerHelper,
  rescheduleRevealTimer as rescheduleRevealTimerHelper,
  type StreamingRevealContext,
} from './reveal';
import type { CompactionComponent } from '../../components/dialogs/session/compaction';
import type { ThinkingComponent } from '../../components/messages/thinking';
import type { ToolCallComponent } from '../../components/messages/tool-call/index';
import type { StreamingFlushState } from './flush';
import type { StreamingUIHost } from './host-types';
import type { ToolCallBlockData } from '../../types';

export function cleanupStreamingUiAfterReplay(args: {
  revealContext: () => StreamingRevealContext;
  resetAssistantReveal: () => void;
  resetThinkingReveal: () => void;
  activeToolCalls: Map<string, ToolCallBlockData>;
  pendingToolComponents: Map<string, ToolCallComponent>;
  clearPendingAgentGroup: () => void;
  clearPendingReadGroup: () => void;
  completedToolCallIds: Set<string>;
  flushState: StreamingFlushState;
  host: StreamingUIHost;
  setCurrentTurnId: (turnId: string | undefined) => void;
  setCurrentStep: (step: number) => void;
  clearStreamingToolCallArguments: () => void;
}): void {
  clearRevealTimerHelper(args.revealContext());
  args.resetAssistantReveal();
  args.resetThinkingReveal();
  args.activeToolCalls.clear();
  for (const toolCallId of args.completedToolCallIds) {
    args.pendingToolComponents.delete(toolCallId);
  }
  args.clearPendingAgentGroup();
  args.clearPendingReadGroup();
  args.setCurrentTurnId(undefined);
  args.setCurrentStep(0);
  args.clearStreamingToolCallArguments();
  args.flushState.pendingToolCallFlushIds.clear();
  requestTUILayoutRender(args.host.state);
}

export function disposeStreamingThinkingComponent(args: {
  getActiveThinkingComponent: () => ThinkingComponent | undefined;
  setActiveThinkingComponent: (component: ThinkingComponent | undefined) => void;
  resetThinkingReveal: () => void;
  revealContext: () => StreamingRevealContext;
}): void {
  const active = args.getActiveThinkingComponent();
  if (active !== undefined) {
    active.dispose();
    args.setActiveThinkingComponent(undefined);
  }
  args.resetThinkingReveal();
  rescheduleRevealTimerHelper(args.revealContext());
}

export function disposeStreamingPendingToolComponents(
  pendingToolComponents: Map<string, ToolCallComponent>,
): void {
  for (const component of pendingToolComponents.values()) {
    if (hasDispose(component)) component.dispose();
  }
  pendingToolComponents.clear();
}

export function disposeStreamingCompactionBlock(args: {
  getActiveCompactionBlock: () => CompactionComponent | undefined;
  setActiveCompactionBlock: (block: CompactionComponent | undefined) => void;
}): void {
  const active = args.getActiveCompactionBlock();
  if (active !== undefined) {
    active.dispose();
    args.setActiveCompactionBlock(undefined);
  }
}
