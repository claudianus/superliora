import type {
  ToolCallDeltaEvent,
  ToolCallStartedEvent,
  ToolProgressEvent,
  ToolResultEvent,
} from '@superliora/sdk';

import type {
  AppState,
  LivePaneState,
  ToolCallBlockData,
  ToolResultBlockData,
} from '../../types';
import type { TUIState } from '../../tui-state';
import {
  argsRecord,
  serializeToolResultOutput,
} from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by tool / shell event handling. */
export interface ToolsEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
}

export class SessionEventTools {
  constructor(private readonly host: ToolsEventHost) {}

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
    state.todoPanel.bumpActivity();
    requestTUILayoutRender(state);
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
      display: event.display,
    };
    streamingUI.completeToolResult(event.toolCallId, resultData);
    this.host.patchLivePane({ mode: 'waiting' });
  }

}
