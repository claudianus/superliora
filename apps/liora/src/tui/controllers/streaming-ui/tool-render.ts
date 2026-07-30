import { isSwarmProgressToolName } from '../../components/messages/agent-swarm-progress/index';
import type { AgentGroupComponent } from '../../components/messages/agent-group';
import type { ReadGroupComponent } from '../../components/messages/read-group';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import { isGenericToolResult } from '../../components/messages/tool-renderers/registry';
import {
  appearanceAnimationNow,
} from '../../features/appearance/appearance-effects';
import { parseStreamingArgs } from '../../utils/event-payload';
import { isMotionTheatreActive } from '../../utils/render/motion-beats';
import type { LivePaneState, ToolCallBlockData, ToolResultBlockData } from '../../types';
import { requestTUIContentRender, requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  ensureChainSummary as ensureChainSummaryHelper,
  type ChainSummaryState,
} from './chain-summary';
import type { StreamingUIHost } from '.';
import {
  tryAttachAgentToolCall as attachAgentToolCall,
  tryAttachReadToolCall as attachReadToolCall,
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
  getPendingAgentGroup(): PendingToolGroup<AgentGroupComponent> | null;
  setPendingAgentGroup(group: PendingToolGroup<AgentGroupComponent> | null): void;
  getPendingReadGroup(): PendingToolGroup<ReadGroupComponent> | null;
  setPendingReadGroup(group: PendingToolGroup<ReadGroupComponent> | null): void;
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
  } else if (toolCall.name !== 'Agent' && !isSwarmProgressToolName(toolCall.name)) {
    ctx.onToolCallStart(toolCall);
  }
}

export function onToolCallStart(
  ctx: ToolRenderContext,
  toolCall: ToolCallBlockData,
): void {
  if (toolCall.name === 'AskUserQuestion') return;

  const { state } = ctx.host;
  const tc = new ToolCallComponent(
    toolCall,
    undefined,
    state.ui,
    state.appState.workDir,
    state.toolOutputViewports,
  );
  if (state.toolOutputExpanded) tc.setExpanded(true);
  tc.setDetail(state.transcriptDetail);
  ctx.getPendingToolComponents().set(toolCall.id, tc);
  if (state.transcriptDetail === 'minimal') {
    // Mounts before this tool card is appended, so the aggregate line
    // leads the turn's one-line tool block.
    ensureChainSummaryHelper(state, ctx.getChainSummary()).setCurrentLabel(toolCall.name);
  }

  if (toolCall.name !== 'Agent') ctx.setPendingAgentGroup(null);
  if (toolCall.name !== 'Read') ctx.setPendingReadGroup(null);

  let handled = tryAttachAgentToolCall(ctx, toolCall, tc);
  if (!handled) handled = tryAttachReadToolCall(ctx, toolCall, tc);
  if (!handled) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
  }

  if (toolCall.name === 'ExitPlanMode' && typeof toolCall.args['plan'] !== 'string') {
    const session = ctx.host.requireSession();
    void (async () => {
      try {
        const plan = await session.getPlan();
        tc.setPlanInfo(plan === null ? {} : { plan: plan.content, path: plan.path });
      } catch {
        tc.setPlanInfo({});
      }
    })();
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
    if (state.transcriptDetail === 'minimal') {
      const active = ctx.getChainSummary().active;
      if (active !== null) {
        const args = matchedCall?.args ?? {};
        const file =
          typeof args['file_path'] === 'string'
            ? (args['file_path'] as string)
            : typeof args['path'] === 'string'
              ? (args['path'] as string)
              : undefined;
        active.record({
          isError: result.is_error === true,
          errorText: result.is_error === true ? result.output : undefined,
          file,
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
        theatreActive: isMotionTheatreActive(state.appState),
      });
    }
    requestTUIContentRender(state);
    ctx.host.mergeCurrentTurnSteps();
    return;
  }

  if (matchedCall?.name === 'AskUserQuestion') {
    const completed = new ToolCallComponent(
      matchedCall,
      result,
      state.ui,
      state.appState.workDir,
    );
    if (state.toolOutputExpanded) completed.setExpanded(true);
    completed.setDetail(state.transcriptDetail);
    state.transcriptContainer.addChild(completed);
    requestTUILayoutRender(state);
  }
  ctx.host.mergeCurrentTurnSteps();
}

function tryAttachAgentToolCall(
  ctx: ToolRenderContext,
  toolCall: ToolCallBlockData,
  tc: ToolCallComponent,
): boolean {
  const result = attachAgentToolCall(
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

function tryAttachReadToolCall(
  ctx: ToolRenderContext,
  toolCall: ToolCallBlockData,
  tc: ToolCallComponent,
): boolean {
  const result = attachReadToolCall(
    ctx.host.state,
    toolCall,
    tc,
    ctx.getCurrentStep(),
    ctx.getCurrentTurnId(),
    ctx.getPendingReadGroup(),
  );
  ctx.setPendingReadGroup(result.pending);
  return result.handled;
}
