import type { AgentGroupComponent } from '../../components/messages/agent-group';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import { isGenericToolResult } from '../../components/messages/tool-renderers/registry';
import {
  appearanceAnimationNow,
} from '../../features/appearance/appearance-effects';
import { parseStreamingArgs } from '../../utils/event-payload';
import type { LivePaneState, ToolCallBlockData, ToolResultBlockData } from '../../types';
import { requestTUIContentRender, requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  ensureChainSummary as ensureChainSummaryHelper,
  type ChainSummaryState,
} from './chain-summary';
import {
  noteStreamPhase,
  type PhaseBoundaryState,
} from './phase-boundary';
import type { StreamingUIHost } from '.';
import {
  tryAttachSpawnToolCall as attachSpawnToolCall,
  type PendingToolGroup,
} from './tool-groups';

export interface StreamingToolCallArgs {
  name?: string;
  argumentsText: string;
  startedAtMs: number;
}

export interface ToolRenderContext {
  readonly host: StreamingUIHost;
  getCurrentStep(): number;
  getCurrentTurnId(): string | undefined;
  getActiveToolCalls(): Map<string, ToolCallBlockData>;
  getPendingToolComponents(): Map<string, ToolCallComponent>;
  getStreamingToolCallArguments(): Map<string, StreamingToolCallArgs>;
  getChainSummary(): ChainSummaryState;
  getPhaseBoundary(): PhaseBoundaryState;
  getPendingAgentGroup(): PendingToolGroup<AgentGroupComponent> | null;
  setPendingAgentGroup(group: PendingToolGroup<AgentGroupComponent> | null): void;
  getThinkingDraftLength(): number;
  hasStreamingBlock(): boolean;
  finalizeLiveTextBuffers(nextMode: LivePaneState['mode']): void;
  onToolCallStart(toolCall: ToolCallBlockData): void;
}

export function flushToolCallPreview(ctx: ToolRenderContext, id: string): void {
  const streaming = ctx.getStreamingToolCallArguments().get(id);
  if (streaming === undefined) return;
  const toolCall: ToolCallBlockData = {
    id,
    name: streaming.name ?? ctx.getActiveToolCalls().get(id)?.name ?? 'Tool',
    args: parseStreamingArgs(streaming.argumentsText),
    streamingArguments: streaming.argumentsText,
    streamingStartedAtMs: streaming.startedAtMs,
    step: ctx.getCurrentStep(),
    turnId: ctx.getCurrentTurnId(),
  };
  ctx.getActiveToolCalls().set(id, toolCall);

  if (ctx.getThinkingDraftLength() > 0 || ctx.hasStreamingBlock()) {
    ctx.finalizeLiveTextBuffers('tool');
  }

  const existingComponent = ctx.getPendingToolComponents().get(id);
  if (existingComponent !== undefined) {
    existingComponent.updateToolCall(toolCall);
  } else if (
    toolCall.name !== 'SessionControl' ||
    (typeof toolCall.args['operation'] === 'string' && toolCall.args['operation'] !== 'spawn')
  ) {
    ctx.onToolCallStart(toolCall);
  }
}

export function onToolCallStart(
  ctx: ToolRenderContext,
  toolCall: ToolCallBlockData,
): void {
  const { state } = ctx.host;
  // Phase chrome: chain bar (non-full) or TurnPhaseBoundary (full — cards lack header).
  noteStreamPhase(state, ctx.getPhaseBoundary(), 'tools');
  const tc = new ToolCallComponent(
    toolCall,
    undefined,
    state.ui,
    state.appState.workDir,
    state.toolOutputViewports,
    state.persistSessionUiState,
  );
  if (state.toolOutputExpanded) tc.setExpanded(true);
  tc.setDetail(state.transcriptDetail);
  ctx.getPendingToolComponents().set(toolCall.id, tc);
  // Chain phase bar for all densities except full (full = maximum detail chrome).
  if (state.transcriptDetail !== 'full') {
    // minimal: rows hidden · compact: one-line headers · standard: short previews
    ensureChainSummaryHelper(state, ctx.getChainSummary()).setCurrentLabel(toolCall.name);
  }

  if (toolCall.name !== 'SessionControl' || toolCall.args['operation'] !== 'spawn') {
    ctx.setPendingAgentGroup(null);
  }

  const handled = tryAttachSpawnToolCall(ctx, toolCall, tc);
  if (!handled) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
  }

}

export function onToolCallEnd(
  ctx: ToolRenderContext,
  toolCallId: string,
  result: ToolResultBlockData,
): void {
  const { state } = ctx.host;
  const matchedCall = ctx.getActiveToolCalls().get(toolCallId);
  const tc = ctx.getPendingToolComponents().get(toolCallId);
  if (tc) {
    tc.setResult(result);
    ctx.getPendingToolComponents().delete(toolCallId);
    if (state.transcriptDetail !== 'full') {
      const active = ctx.getChainSummary().active;
      if (active !== null) {
        active.record({
          isError: result.is_error === true,
          errorText: result.is_error === true ? result.output : undefined,
          name: matchedCall?.name,
        });
      }
    }
    const toolName = matchedCall?.name;
    if (toolName !== undefined && isGenericToolResult(toolName)) {
      ctx.host.motionBeats.play({
        name: 'tool_settle',
        seed: `tool:${toolCallId}`,
        title: toolName,
        nowMs: appearanceAnimationNow(),
        streamThrottle: true,
      });
    }
    requestTUIContentRender(state);
    ctx.host.mergeCurrentTurnSteps();
    return;
  }

  ctx.host.mergeCurrentTurnSteps();
}

function tryAttachSpawnToolCall(
  ctx: ToolRenderContext,
  toolCall: ToolCallBlockData,
  tc: ToolCallComponent,
): boolean {
  const result = attachSpawnToolCall(
    ctx.host.state,
    toolCall,
    tc,
    ctx.getCurrentStep(),
    ctx.getCurrentTurnId(),
    ctx.getPendingAgentGroup(),
  );
  ctx.setPendingAgentGroup(result.pending);
  return result.handled;
}

