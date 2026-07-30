import type { CompactionPhase } from '@superliora/sdk';

import type { AgentGroupComponent } from '../../components/messages/agent-group';
import { AssistantMessageComponent } from '../../components/messages/assistant-message';
import type { CompactionComponent } from '../../components/dialogs/session/compaction';
import type { ReadGroupComponent } from '../../components/messages/read-group';
import type { ThinkingComponent } from '../../components/messages/thinking';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import {
  cleanupStreamingUiAfterReplay,
  disposeStreamingCompactionBlock,
  disposeStreamingPendingToolComponents,
  disposeStreamingThinkingComponent,
} from './dispose';
import {
  createStreamingTextRevealState,
  resetRevealState,
} from '../../utils/streaming/streaming-text-reveal';
import type { TodoItem } from '../../components/chrome/todo/todo-panel';
import type {
  LivePaneState,
  QueuedMessage,
  ToolCallBlockData,
  ToolResultBlockData,
} from '../../types';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  applyBackgroundTaskTerminalStatus as applyBackgroundTaskTerminalStatusHelper,
  markSubagentBackgrounded as markSubagentBackgroundedHelper,
} from './background-agent';
import {
  type ChainSummaryState,
} from './chain-summary';
import { finalizeStreamingTurn } from './turn-finalize';
import {
  setStreamingTodoList,
  streamingBeginCompaction,
  streamingCancelCompaction,
  streamingEndCompaction,
  streamingPromoteCompaction,
  streamingUpdateCompactionProgress,
} from './todo-compaction';
import {
  buildStreamingRenderContextStateFromParts,
  buildStreamingToolRegistryStateFromParts,
  buildTextRenderContext,
  buildToolRenderContext,
  type StreamingRenderContextState,
} from './render-context';
import type { StreamingTextBlock, TextRenderContext } from './text-render';
import type { ToolRenderContext } from './tool-render';
import type { StreamingRevealContext } from './reveal';
import {
  streamingUiClearFlushTimer,
  streamingUiDiscardPending,
  streamingUiFlushNow,
  streamingUiFlushToolCallPreview,
  streamingUiHasPending,
  streamingUiOnStreamingTextEnd,
  streamingUiOnStreamingTextStart,
  streamingUiOnStreamingTextUpdate,
  streamingUiOnThinkingEnd,
  streamingUiOnThinkingUpdate,
  streamingUiOnToolCallEnd,
  streamingUiOnToolCallStart,
  streamingUiResetRevealChannels,
  streamingUiRevealContext,
  streamingUiRunPendingFlush,
  streamingUiScheduleFlush,
  streamingUiSettleActiveChainSummary,
  streamingUiShouldSmoothStreamReveal,
} from './operations';
import {
  clearFlushTimerIfIdle as clearFlushTimerIfIdleHelper,
  createStreamingFlushState,
  type StreamingFlushState,
} from './flush';
import {
  getStreamingActiveToolCall,
  getStreamingToolComponent,
  hasStreamingActiveToolCall,
  removeStreamingActiveToolCall,
  removeStreamingToolComponent,
  removeStreamingToolComponentIfInactive,
  setStreamingActiveToolCall,
} from './tool-accessors';
import {
  accumulateStreamingToolCallDelta,
  completeStreamingToolResult,
  getStreamingToolCallPreviewState,
  markStreamingStepTruncated,
  registerStreamingToolCall,
  type StreamingUIToolRegistryState,
} from './tool-registry';
import { type PendingToolGroup } from './tool-groups';
export type { StreamingUIHost } from './host-types';
import type { StreamingUIHost } from './host-types';

export class StreamingUIController {
  private readonly _flushState: StreamingFlushState = createStreamingFlushState();
  readonly pendingToolCallFlushIds = this._flushState.pendingToolCallFlushIds;

  /**
   * Shared catch-up reveal timer for assistant + thinking display lag.
   * Runs only while at least one channel still lags its server draft.
   */
  private readonly revealRuntime = {
    revealTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    channels: {
      assistantReveal: createStreamingTextRevealState(),
      thinkingReveal: createStreamingTextRevealState(),
    },
  };


  private _currentTurnId: string | undefined = undefined;
  private _currentStep = 0;
  /** Consumed by the first assistant block mounted for the current turn. */
  private turnStartCueArmed = false;
  private _assistantDraft = '';
  private _thinkingDraft = '';
  private _streamingBlock: StreamingTextBlock | null = null;
  private _activeThinkingComponent: ThinkingComponent | undefined = undefined;
  private _activeCompactionBlock: CompactionComponent | undefined = undefined;
  private _activeToolCalls = new Map<string, ToolCallBlockData>();
  private _streamingToolCallArguments = new Map<
    string,
    { name?: string; argumentsText: string; startedAtMs: number }
  >();
  private _pendingToolComponents = new Map<string, ToolCallComponent>();
  private _chainSummary: ChainSummaryState = { active: null, turnIndex: -1 };
  private _pendingAgentGroup: PendingToolGroup<AgentGroupComponent> | null = null;
  private _pendingReadGroup: PendingToolGroup<ReadGroupComponent> | null = null;

  constructor(private readonly host: StreamingUIHost) {}


  getTurnContext(): { turnId: string | undefined; step: number } {
    return { turnId: this._currentTurnId, step: this._currentStep };
  }

  setTurnId(turnId: string | undefined): void {
    if (turnId === this._currentTurnId) return;
    this._currentTurnId = turnId;
    this.turnStartCueArmed = turnId !== undefined;
  }

  setStep(step: number): void {
    this._currentStep = step;
  }

  hasActiveTurn(): boolean {
    return this._currentTurnId !== undefined;
  }

  appendThinkingDelta(delta: string): void {
    this._thinkingDraft += delta;
    this._flushState.pendingThinkingFlush = true;
    this._flushState.dirtyMarksSinceFlush += 1;
  }

  appendAssistantDelta(delta: string): void {
    if (this._streamingBlock === null) this.onStreamingTextStart();
    this._assistantDraft += delta;
    this._flushState.pendingAssistantFlush = true;
    this._flushState.dirtyMarksSinceFlush += 1;
  }

  hasThinkingDraft(): boolean {
    return this._thinkingDraft.length > 0;
  }

  hasActiveThinkingComponent(): boolean {
    return this._activeThinkingComponent !== undefined;
  }

  hasStreamingBlock(): boolean {
    return this._streamingBlock !== null;
  }

  getStreamingBlockComponent(): AssistantMessageComponent | undefined {
    return this._streamingBlock?.component;
  }

  clearAssistantDraft(): void {
    this._assistantDraft = '';
  }


  getActiveToolCall(id: string): ToolCallBlockData | undefined {
    return getStreamingActiveToolCall(this._activeToolCalls, id);
  }

  hasActiveToolCall(id: string): boolean {
    return hasStreamingActiveToolCall(this._activeToolCalls, id);
  }

  setActiveToolCall(id: string, toolCall: ToolCallBlockData): void {
    setStreamingActiveToolCall(this._activeToolCalls, id, toolCall);
  }

  removeActiveToolCall(id: string): void {
    removeStreamingActiveToolCall(this._activeToolCalls, id);
  }

  getToolComponent(id: string): ToolCallComponent | undefined {
    return getStreamingToolComponent(this._pendingToolComponents, id);
  }

  removeToolComponent(id: string): void {
    removeStreamingToolComponent(this._pendingToolComponents, id);
  }

  hasPendingAgentGroup(): boolean {
    return this._pendingAgentGroup !== null;
  }

  hasPendingReadGroup(): boolean {
    return this._pendingReadGroup !== null;
  }

  removeToolComponentIfInactive(toolCallId: string): void {
    removeStreamingToolComponentIfInactive(
      this._activeToolCalls,
      this._pendingToolComponents,
      toolCallId,
    );
  }

  /** See `streaming-ui-background-agent.ts` for the resolution policy and rationale. */
  applyBackgroundTaskTerminalStatus(args: {
    agentId?: string | undefined;
    description: string;
    status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost';
    errorText?: string | undefined;
  }): boolean {
    return applyBackgroundTaskTerminalStatusHelper(
      this._pendingToolComponents,
      this.host.state.transcriptContainer,
      args,
    );
  }

  /** See `streaming-ui-background-agent.ts` for the foreground/backgrounded gating. */
  markSubagentBackgrounded(agentId: string | undefined): boolean {
    return markSubagentBackgroundedHelper(
      this._pendingToolComponents,
      this.host.state.transcriptContainer,
      agentId,
    );
  }

  /** Registers a tool call that arrived via tool.call.started. */
  registerToolCall(toolCall: ToolCallBlockData): boolean {
    return registerStreamingToolCall(this.toolRegistryState(), toolCall);
  }

  /** Accumulates a streaming tool-call argument delta. */
  accumulateToolCallDelta(
    id: string,
    eventName: string | undefined,
    argumentsPart: string | null | undefined,
  ): void {
    accumulateStreamingToolCallDelta(this.toolRegistryState(), id, eventName, argumentsPart);
  }

  getStreamingToolCallPreview(
    id: string,
  ): { name: string; args: Record<string, unknown>; argumentsText: string; startedAtMs: number } | undefined {
    return getStreamingToolCallPreviewState(this.toolRegistryState(), id);
  }

  /** Completes a tool call: delivers the result and removes tracking state. */
  completeToolResult(toolCallId: string, result: ToolResultBlockData): ToolCallBlockData | undefined {
    return completeStreamingToolResult(this.toolRegistryState(), toolCallId, result);
  }

  /** Marks in-flight tool calls as truncated when a step hits max_tokens. */
  markStepTruncated(turnId: string, step: number): number {
    return markStreamingStepTruncated(this.toolRegistryState(), turnId, step);
  }

  /** Tears down replay-specific state after session history has been rendered. */
  cleanupAfterReplay(completedToolCallIds: Set<string>): void {
    cleanupStreamingUiAfterReplay({
      revealContext: () => this.revealContext(),
      resetAssistantReveal: () => {
        this.revealRuntime.channels.assistantReveal = resetRevealState();
      },
      resetThinkingReveal: () => {
        this.revealRuntime.channels.thinkingReveal = resetRevealState();
      },
      activeToolCalls: this._activeToolCalls,
      pendingToolComponents: this._pendingToolComponents,
      clearPendingAgentGroup: () => {
        this._pendingAgentGroup = null;
      },
      clearPendingReadGroup: () => {
        this._pendingReadGroup = null;
      },
      completedToolCallIds,
      flushState: this._flushState,
      host: this.host,
      setCurrentTurnId: (turnId) => {
        this._currentTurnId = turnId;
      },
      setCurrentStep: (step) => {
        this._currentStep = step;
      },
      clearStreamingToolCallArguments: () => {
        this._streamingToolCallArguments.clear();
      },
    });
  }

  disposeActiveThinkingComponent(): void {
    disposeStreamingThinkingComponent({
      getActiveThinkingComponent: () => this._activeThinkingComponent,
      setActiveThinkingComponent: (component) => {
        this._activeThinkingComponent = component;
      },
      resetThinkingReveal: () => {
        this.revealRuntime.channels.thinkingReveal = resetRevealState();
      },
      revealContext: () => this.revealContext(),
    });
  }

  disposeAndClearPendingToolComponents(): void {
    disposeStreamingPendingToolComponents(this._pendingToolComponents);
  }

  disposeActiveCompactionBlock(): void {
    disposeStreamingCompactionBlock({
      getActiveCompactionBlock: () => this._activeCompactionBlock,
      setActiveCompactionBlock: (block) => {
        this._activeCompactionBlock = block;
      },
    });
  }


  hasPending(): boolean {
    return streamingUiHasPending(this._flushState);
  }

  clearFlushTimer(): void {
    streamingUiClearFlushTimer(this._flushState);
  }

  discardPending(): void {
    streamingUiDiscardPending(this._flushState, () => this.resetRevealChannelsInternal());
  }

  scheduleFlush(): void {
    streamingUiScheduleFlush(this._flushState, () => this.flush());
  }

  flushNow(): void {
    streamingUiFlushNow(this._flushState, () => this.flush());
  }

  private flush(): void {
    streamingUiRunPendingFlush(this._flushState, {
      onThinkingFlush: () => {
        if (this._thinkingDraft.length > 0) this.onThinkingUpdate(this._thinkingDraft);
      },
      onAssistantFlush: () => this.onStreamingTextUpdate(this._assistantDraft),
      onToolCallFlush: (id) => this.flushToolCallPreview(id),
    });
  }

  markAssistantDirty(): void {
    this._flushState.pendingAssistantFlush = true;
  }

  markThinkingDirty(): void {
    this._flushState.pendingThinkingFlush = true;
  }


  flushThinkingToTranscript(nextMode: LivePaneState['mode'] = 'idle'): void {
    this.flushNow();
    this._thinkingDraft = '';
    this.onThinkingEnd();
    this.host.patchLivePane({ mode: nextMode });
  }

  finalizeAssistantStream(): void {
    this.flushNow();
    if (this._streamingBlock !== null) this.onStreamingTextEnd();
    this._assistantDraft = '';
    this.host.updateActivityPane();
    requestTUILayoutRender(this.host.state);
  }

  resetLiveText(): void {
    this._flushState.pendingAssistantFlush = false;
    this._flushState.pendingThinkingFlush = false;
    clearFlushTimerIfIdleHelper(this._flushState);
    this.resetRevealChannelsInternal();
    this._assistantDraft = '';
    this._streamingBlock = null;
    this._thinkingDraft = '';
    this.disposeActiveThinkingComponent();
  }

  resetToolUi(): void {
    this._flushState.pendingToolCallFlushIds.clear();
    clearFlushTimerIfIdleHelper(this._flushState);
    this._streamingToolCallArguments.clear();
    this.disposeAndClearPendingToolComponents();
    this._pendingAgentGroup = null;
    this._pendingReadGroup = null;
  }

  resetToolCallState(): void {
    this._activeToolCalls.clear();
  }

  finalizeLiveTextBuffers(nextMode: LivePaneState['mode'] = 'idle'): void {
    this.flushThinkingToTranscript(nextMode);
    this.finalizeAssistantStream();
  }

  finalizeTurn(sendQueued: (item: QueuedMessage) => void): void {
    finalizeStreamingTurn({
      host: this.host,
      currentTurnId: this._currentTurnId,
      getStreamingBlockComponent: () => this.getStreamingBlockComponent(),
      finalizeLiveTextBuffers: () => this.finalizeLiveTextBuffers('idle'),
      resetToolCallState: () => this.resetToolCallState(),
      setCurrentTurnId: (turnId) => {
        this._currentTurnId = turnId;
      },
      sendQueued,
    });
  }


  onStreamingTextStart(): void {
    streamingUiOnStreamingTextStart(this.textRenderContext());
  }

  onStreamingTextUpdate(fullText: string): void {
    streamingUiOnStreamingTextUpdate(this.textRenderContext(), fullText);
  }

  onStreamingTextEnd(): void {
    streamingUiOnStreamingTextEnd(this.textRenderContext());
  }

  onThinkingUpdate(fullText: string): void {
    streamingUiOnThinkingUpdate(this.textRenderContext(), fullText);
  }

  onThinkingEnd(): void {
    streamingUiOnThinkingEnd(this.textRenderContext());
  }

  onToolCallStart(toolCall: ToolCallBlockData): void {
    streamingUiOnToolCallStart(this.toolRenderContext(), toolCall);
  }

  onToolCallEnd(toolCallId: string, result: ToolResultBlockData): void {
    streamingUiOnToolCallEnd(this.toolRenderContext(), toolCallId, result);
  }

  setTodoList(todos: readonly TodoItem[]): void {
    setStreamingTodoList(this.host, todos);
  }

  beginCompaction(
    instruction?: string,
    options?: { readonly background?: boolean; readonly modelAlias?: string },
  ): void {
    streamingBeginCompaction(this.compactionHost(), instruction, options);
  }

  endCompaction(tokensBefore?: number, tokensAfter?: number, detail?: string): void {
    streamingEndCompaction(this.compactionHost(), tokensBefore, tokensAfter, detail);
  }

  cancelCompaction(): void {
    streamingCancelCompaction(this.compactionHost());
  }

  promoteCompactionToBlocking(): void {
    streamingPromoteCompaction(this.compactionHost());
  }

  updateCompactionProgress(
    phase: CompactionPhase,
    delta?: string,
    meta?: {
      readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
      readonly blockIndex?: number;
      readonly blockCount?: number;
      readonly blocksCompleted?: number;
      readonly fraction?: number;
    },
  ): void {
    streamingUpdateCompactionProgress(this.compactionHost(), phase, delta, meta);
  }

  private compactionHost() {
    return {
      host: this.host,
      getBlock: () => this._activeCompactionBlock,
      setBlock: (block: CompactionComponent | undefined) => {
        this._activeCompactionBlock = block;
      },
    };
  }

  private renderContextState(): StreamingRenderContextState {
    return buildStreamingRenderContextStateFromParts({
      host: this.host,
      revealRuntime: this.revealRuntime,
      turnStartCueArmed: this.turnStartCueArmed,
      currentTurnId: this._currentTurnId,
      currentStep: this._currentStep,
      streamingBlock: this._streamingBlock,
      activeThinkingComponent: this._activeThinkingComponent,
      assistantDraft: this._assistantDraft,
      thinkingDraft: this._thinkingDraft,
      activeToolCalls: this._activeToolCalls,
      pendingToolComponents: this._pendingToolComponents,
      streamingToolCallArguments: this._streamingToolCallArguments,
      chainSummary: this._chainSummary,
      pendingAgentGroup: this._pendingAgentGroup,
      pendingReadGroup: this._pendingReadGroup,
      setStreamingBlock: (block) => {
        this._streamingBlock = block;
      },
      setTurnStartCueArmed: (armed) => {
        this.turnStartCueArmed = armed;
      },
      setActiveThinkingComponent: (component) => {
        this._activeThinkingComponent = component;
      },
      setPendingAgentGroup: (group) => {
        this._pendingAgentGroup = group;
      },
      setPendingReadGroup: (group) => {
        this._pendingReadGroup = group;
      },
      finalizeLiveTextBuffers: (mode) => this.finalizeLiveTextBuffers(mode),
      onToolCallStart: (toolCall) => this.onToolCallStart(toolCall),
    });
  }

  private flushToolCallPreview(id: string): void {
    streamingUiFlushToolCallPreview(this.toolRenderContext(), id);
  }

  private textRenderContext(): TextRenderContext {
    return buildTextRenderContext(this.renderContextState());
  }

  private toolRenderContext(): ToolRenderContext {
    return buildToolRenderContext(this.renderContextState());
  }

  private shouldSmoothStreamReveal(): boolean {
    return streamingUiShouldSmoothStreamReveal(this.host.state.appState.isReplaying);
  }

  private resetRevealChannelsInternal(nowMs = 0): void {
    streamingUiResetRevealChannels(this.renderContextState(), nowMs);
  }

  private revealContext(): StreamingRevealContext {
    return streamingUiRevealContext(this.renderContextState());
  }

  private settleActiveChainSummary(): void {
    streamingUiSettleActiveChainSummary(this._chainSummary);
  }

  private toolRegistryState(): StreamingUIToolRegistryState {
    return buildStreamingToolRegistryStateFromParts({
      host: this.host,
      flushState: this._flushState,
      activeToolCalls: this._activeToolCalls,
      pendingToolComponents: this._pendingToolComponents,
      streamingToolCallArguments: this._streamingToolCallArguments,
      finalizeLiveTextBuffers: (mode) => this.finalizeLiveTextBuffers(mode),
      onToolCallStart: (toolCall) => this.onToolCallStart(toolCall),
      onToolCallEnd: (toolCallId, result) => this.onToolCallEnd(toolCallId, result),
    });
  }
}
