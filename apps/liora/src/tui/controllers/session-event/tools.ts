import type {
  Event,
  ToolCallDeltaEvent,
  ToolCallStartedEvent,
  ToolProgressEvent,
  ToolResultEvent,
} from '@superliora/sdk';

import { isSwarmProgressToolName } from '../../components/messages/agent-swarm-progress/index';
import type {
  AppState,
  LivePaneState,
  ToolCallBlockData,
  ToolResultBlockData,
} from '../../types';
import type { TUIState } from '../../tui-state';
import {
  argsRecord,
  isTodoItemShape,
  serializeToolResultOutput,
} from '../../utils/event-payload';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import {
  isMotionTheatreActive,
  type MotionBeatController,
} from '../../utils/render/motion-beats';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { searchCascadePatchFromToolResult } from '../../utils/search/search-cascade';
import { goalSoftAdvisoryPatchFromToolResult } from '../../utils/goal/goal-soft-advisory-glance';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by tool / shell event handling. */
export interface ToolsEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  readonly motionBeats?: MotionBeatController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
}

/**
 * Swarm-progress tool fan-out lives on SubAgentEventHandler. Injected so tool
 * call / delta / result handling stays coordinated without importing the
 * sibling handler graph into this module.
 */
export interface ToolsEventCoordination {
  handleAgentSwarmToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
    name: string,
  ): void;
  handleAgentSwarmToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined },
    name: string,
  ): void;
  hasAgentSwarmProgress(toolCallId: string): boolean;
  handleAgentSwarmToolResult(
    toolCallId: string,
    resultData: ToolResultBlockData,
    isError: boolean,
  ): void;
}

export class SessionEventTools {
  constructor(
    private readonly host: ToolsEventHost,
    private readonly coordination: ToolsEventCoordination,
  ) {}

  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void {
    this.host.handleShellOutput(event);
  }

  handleShellStarted(event: { commandId: string; taskId: string }): void {
    this.host.handleShellStarted(event);
  }

  handleToolCall(event: ToolCallStartedEvent): void {
    const { state, streamingUI } = this.host;
    streamingUI.flushNow();
    const { turnId, step } = streamingUI.getTurnContext();
    const toolCall: ToolCallBlockData = {
      id: event.toolCallId,
      name: event.name,
      args: argsRecord(event.args),
      description: event.description,
      display: event.display,
      step,
      turnId,
    };
    streamingUI.registerToolCall(toolCall);
    // Push to activity feed for transparency panel
    if (event.name !== 'TodoList') {
      state.todoPanel.bumpActivity();
      requestTUILayoutRender(state);
    }
    if (isSwarmProgressToolName(event.name)) {
      this.coordination.handleAgentSwarmToolCallStarted(
        event.toolCallId,
        toolCall.args,
        event.name,
      );
    }
    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  handleToolCallDelta(event: ToolCallDeltaEvent): void {
    if (event.toolCallId.length === 0) return;
    const { state, streamingUI } = this.host;
    streamingUI.accumulateToolCallDelta(event.toolCallId, event.name, event.argumentsPart);
    const preview = streamingUI.getStreamingToolCallPreview(event.toolCallId);
    if (
      preview !== undefined &&
      (isSwarmProgressToolName(preview.name) ||
        this.coordination.hasAgentSwarmProgress(event.toolCallId))
    ) {
      this.coordination.handleAgentSwarmToolCallDelta(
        event.toolCallId,
        preview.args,
        { streamingArguments: preview.argumentsText },
        preview.name,
      );
    }

    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
    if (state.appState.streamingPhase !== 'composing') {
      this.host.setAppState({ streamingPhase: 'composing', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  handleToolProgress(event: ToolProgressEvent): void {
    const text = event.update.text;
    if (text === undefined || text.length === 0) return;
    const tc = this.host.streamingUI.getToolComponent(event.toolCallId);
    if (tc === undefined) return;
    if (event.update.kind === 'status') {
      tc.appendProgress(text);
      return;
    }
    if (event.update.kind === 'stdout' || event.update.kind === 'stderr') {
      tc.appendLiveOutput(text);
    }
  }

  handleToolResult(event: ToolResultEvent): void {
    const { streamingUI } = this.host;
    streamingUI.flushNow();
    const resultData: ToolResultBlockData = {
      tool_call_id: event.toolCallId,
      output: serializeToolResultOutput(event.output),
      is_error: event.isError,
      synthetic: event.synthetic,
    };
    const matchedCall = streamingUI.completeToolResult(event.toolCallId, resultData);
    // Push result to activity feed

    this.coordination.handleAgentSwarmToolResult(
      event.toolCallId,
      resultData,
      event.isError === true,
    );
    if (matchedCall !== undefined) {
      const cascadePatch = searchCascadePatchFromToolResult(matchedCall.name, resultData.output);
      if (cascadePatch !== null) {
        this.host.setAppState(cascadePatch);
        this.host.motionBeats?.play({
          name: 'tool_settle',
          seed: 'research-cascade',
          title: 'Research cascade',
          nowMs: appearanceAnimationNow(),
          streamThrottle: true,
          theatreActive: isMotionTheatreActive(this.host.state.appState),
        });
      }
      const advisoryPatch = goalSoftAdvisoryPatchFromToolResult(
        this.host.state.appState.sessionId,
        matchedCall.name,
        matchedCall.args,
        event.isError === true,
        resultData.output,
      );
      if (advisoryPatch.goalSoftAdvisory !== this.host.state.appState.goalSoftAdvisory) {
        this.host.setAppState(advisoryPatch);
      }
    }
    if (matchedCall !== undefined && matchedCall.name === 'TodoList' && !event.isError) {
      const rawTodos = (matchedCall.args as { todos?: unknown }).todos;
      if (Array.isArray(rawTodos)) {
        const sanitized = rawTodos
          .filter((todo): todo is { title: string; status: 'pending' | 'in_progress' | 'done' } =>
            isTodoItemShape(todo),
          )
          .map((t) => ({ title: t.title, status: t.status }));
        streamingUI.setTodoList(sanitized);
      }
    }
    this.host.patchLivePane({ mode: 'waiting' });
  }

  handleToolsUpdateStore(event: Extract<Event, { type: 'tools.update_store' }>): void {
    if (event.key !== 'todo') return;
    const rawTodos = event.value;
    if (!Array.isArray(rawTodos)) return;
    const sanitized = rawTodos
      .filter((todo): todo is { title: string; status: 'pending' | 'in_progress' | 'done' } =>
        isTodoItemShape(todo),
      )
      .map((todo) => ({ title: todo.title, status: todo.status }));
    this.host.streamingUI.setTodoList(sanitized);
  }
}
