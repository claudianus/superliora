import type { CompactionPhase, Session } from '@superliora/sdk';

import type { AgentGroupComponent } from '../../components/messages/agent-group';
import { AssistantMessageComponent } from '../../components/messages/assistant-message';
import type { CompactionComponent } from '../../components/dialogs/compaction';
import type { ReadGroupComponent } from '../../components/messages/read-group';
import type { ThinkingComponent } from '../../components/messages/thinking';
import { ToolCallComponent } from '../../components/messages/tool-call';
import { isSwarmProgressToolName } from '../../components/messages/agent-swarm-progress';
import { hasDispose } from '../../utils/component-capabilities';
import { appendStreamingArgsPreview, parseStreamingArgs } from '../../utils/event-payload';
import { type MotionBeatController } from '../../utils/motion-beats';
import {
  createStreamingTextRevealState,
  resetRevealState,
} from '../../utils/streaming-text-reveal';
import { notifyUserAttentionOnce } from '../../utils/terminal-notification';
import type { TodoItem } from '../../components/chrome/todo-panel';
import type {
  AppState,
  LivePaneState,
  QueuedMessage,
  ToolCallBlockData,
  ToolResultBlockData,
  TranscriptEntry,
} from '../../types';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '#/tui/utils/frame-render';
import {
  applyBackgroundTaskTerminalStatus as applyBackgroundTaskTerminalStatusHelper,
  markSubagentBackgrounded as markSubagentBackgroundedHelper,
} from './background-agent';
import {
  settleActiveChainSummary as settleActiveChainSummaryHelper,
  type ChainSummaryState,
} from './chain-summary';
import {
  beginCompaction as beginCompactionHelper,
  cancelCompaction as cancelCompactionHelper,
  endCompaction as endCompactionHelper,
  promoteCompactionToBlocking as promoteCompactionToBlockingHelper,
  updateCompactionProgress as updateCompactionProgressHelper,
} from './compaction';
import {
  clearFlushTimerIfIdle as clearFlushTimerIfIdleHelper,
  createStreamingFlushState,
  discardPendingFlush as discardPendingFlushHelper,
  flushNow as flushNowHelper,
  hasPendingFlush,
  runPendingFlush,
  scheduleFlush as scheduleFlushHelper,
  type StreamingFlushState,
} from './flush';
import {
  clearRevealTimer as clearRevealTimerHelper,
  resetRevealChannels as resetRevealChannelsHelper,
  rescheduleRevealTimer as rescheduleRevealTimerHelper,
  shouldSmoothStreamReveal as shouldSmoothStreamRevealHelper,
  type StreamingRevealContext,
} from './reveal';
import {
  onStreamingTextEnd as onStreamingTextEndHelper,
  onStreamingTextStart as onStreamingTextStartHelper,
  onStreamingTextUpdate as onStreamingTextUpdateHelper,
  onThinkingEnd as onThinkingEndHelper,
  onThinkingUpdate as onThinkingUpdateHelper,
  type StreamingTextBlock,
  type TextRenderContext,
} from './text-render';
import {
  flushToolCallPreview as flushToolCallPreviewHelper,
  onToolCallEnd as onToolCallEndHelper,
  onToolCallStart as onToolCallStartHelper,
  type ToolRenderContext,
} from './tool-render';
import {
  type PendingToolGroup,
} from './tool-groups';
import {
  appearanceAnimationNow,
} from '../../features/appearance/appearance-effects';

export interface StreamingUIHost {
  state: TUIState;
  session: Session | undefined;
  readonly motionBeats: MotionBeatController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  requireSession(): Session;
  deferUserMessages: boolean;
  shiftQueuedMessage(): QueuedMessage | undefined;
  pushTranscriptEntry(entry: TranscriptEntry): void;
  mergeCurrentTurnSteps(): void;
}

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

  // ---------------------------------------------------------------------------
  // Streaming runtime state (private — accessed via semantic methods below)
  // ---------------------------------------------------------------------------

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
  /**
   * Per-turn tool chain summary for `minimal` transcript density
   * (PREMIUM.md §7.9). Mounted when the turn's first tool starts; settled
   * when the assistant answer begins or a new user-message boundary shows
   * up. `null` outside minimal density or after settle.
   */
  private _chainSummary: ChainSummaryState = { active: null, turnIndex: -1 };
  private _pendingAgentGroup: PendingToolGroup<AgentGroupComponent> | null = null;
  private _pendingReadGroup: PendingToolGroup<ReadGroupComponent> | null = null;

  constructor(private readonly host: StreamingUIHost) {}

  // ---------------------------------------------------------------------------
  // Turn context — read/write accessors
  // ---------------------------------------------------------------------------

  getTurnContext(): { turnId: string | undefined; step: number } {
    return { turnId: this._currentTurnId, step: this._currentStep };
  }

  setTurnId(turnId: string | undefined): void {
    if (turnId === this._currentTurnId) return;
    this._currentTurnId = turnId;
    // A fresh turn re-arms the entrance cue; the first assistant block mounted
    // for this turn consumes it so turn boundaries stay visible (Gap 5).
    this.turnStartCueArmed = turnId !== undefined;
  }

  setStep(step: number): void {
    this._currentStep = step;
  }

  hasActiveTurn(): boolean {
    return this._currentTurnId !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Text streaming — semantic write accessors
  // ---------------------------------------------------------------------------

  appendThinkingDelta(delta: string): void {
    this._thinkingDraft += delta;
    this._flushState.pendingThinkingFlush = true;
    this._flushState.dirtyMarksSinceFlush += 1;
  }

  appendAssistantDelta(delta: string): void {
    if (this._streamingBlock === null) {
      this.onStreamingTextStart();
    }
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

  // ---------------------------------------------------------------------------
  // Tool call state — semantic accessors
  // ---------------------------------------------------------------------------

  getActiveToolCall(id: string): ToolCallBlockData | undefined {
    return this._activeToolCalls.get(id);
  }

  hasActiveToolCall(id: string): boolean {
    return this._activeToolCalls.has(id);
  }

  setActiveToolCall(id: string, toolCall: ToolCallBlockData): void {
    this._activeToolCalls.set(id, toolCall);
  }

  removeActiveToolCall(id: string): void {
    this._activeToolCalls.delete(id);
  }

  getToolComponent(id: string): ToolCallComponent | undefined {
    return this._pendingToolComponents.get(id);
  }

  removeToolComponent(id: string): void {
    this._pendingToolComponents.delete(id);
  }

  hasPendingAgentGroup(): boolean {
    return this._pendingAgentGroup !== null;
  }

  hasPendingReadGroup(): boolean {
    return this._pendingReadGroup !== null;
  }

  removeToolComponentIfInactive(toolCallId: string): void {
    if (!this._activeToolCalls.has(toolCallId)) {
      this._pendingToolComponents.delete(toolCallId);
    }
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

  /** Registers a tool call that arrived via tool.call.started.
   *  Clears any pending streaming state for this id, updates or creates the
   *  component, and returns whether the call was new (no previous entry). */
  registerToolCall(toolCall: ToolCallBlockData): boolean {
    const existing = this._activeToolCalls.get(toolCall.id);
    this._activeToolCalls.set(toolCall.id, toolCall);
    this._flushState.pendingToolCallFlushIds.delete(toolCall.id);
    this._streamingToolCallArguments.delete(toolCall.id);
    const existingComponent = this._pendingToolComponents.get(toolCall.id);
    if (existingComponent !== undefined) {
      existingComponent.updateToolCall(toolCall);
    } else if (existing === undefined) {
      this.finalizeLiveTextBuffers('tool');
      if (toolCall.name !== 'Agent' && !isSwarmProgressToolName(toolCall.name)) {
        this.onToolCallStart(toolCall);
      }
    }
    return existing === undefined;
  }

  /** Accumulates a streaming tool-call argument delta. */
  accumulateToolCallDelta(
    id: string,
    eventName: string | undefined,
    argumentsPart: string | null | undefined,
  ): void {
    const existing = this._streamingToolCallArguments.get(id);
    const argumentsText = appendStreamingArgsPreview(existing?.argumentsText, argumentsPart);
    const name = eventName ?? existing?.name ?? this._activeToolCalls.get(id)?.name ?? 'Tool';
    const startedAtMs = existing?.startedAtMs ?? Date.now();
    this._streamingToolCallArguments.set(id, { name, argumentsText, startedAtMs });
    this._flushState.pendingToolCallFlushIds.add(id);
    this._flushState.dirtyMarksSinceFlush += 1;
  }

  getStreamingToolCallPreview(
    id: string,
  ): { name: string; args: Record<string, unknown>; argumentsText: string; startedAtMs: number } | undefined {
    const streaming = this._streamingToolCallArguments.get(id);
    if (streaming === undefined) return undefined;
    return {
      name: streaming.name ?? this._activeToolCalls.get(id)?.name ?? 'Tool',
      args: parseStreamingArgs(streaming.argumentsText),
      argumentsText: streaming.argumentsText,
      startedAtMs: streaming.startedAtMs,
    };
  }

  /** Completes a tool call: delivers the result and removes tracking state.
   *  Returns the matched ToolCallBlockData, or undefined if no call was tracked. */
  completeToolResult(toolCallId: string, result: ToolResultBlockData): ToolCallBlockData | undefined {
    const matchedCall = this._activeToolCalls.get(toolCallId);
    if (matchedCall !== undefined) {
      this.onToolCallEnd(toolCallId, result);
    }
    this._activeToolCalls.delete(toolCallId);
    this._streamingToolCallArguments.delete(toolCallId);
    return matchedCall;
  }

  /** Marks in-flight tool calls as truncated when a step hits max_tokens.
   *  Returns the count of tool calls that were truncated. */
  markStepTruncated(turnId: string, step: number): number {
    let count = 0;
    for (const toolCall of this._activeToolCalls.values()) {
      if (toolCall.result !== undefined) continue;
      if (toolCall.streamingArguments === undefined) continue;
      if (toolCall.turnId !== turnId) continue;
      if (toolCall.step !== step) continue;
      toolCall.truncated = true;
      const component = this._pendingToolComponents.get(toolCall.id);
      if (component !== undefined) {
        component.updateToolCall(toolCall);
      }
      count += 1;
    }
    this._streamingToolCallArguments.clear();
    return count;
  }

  /** Tears down replay-specific state after session history has been rendered. */
  cleanupAfterReplay(completedToolCallIds: Set<string>): void {
    clearRevealTimerHelper(this.revealContext());
    this.revealRuntime.channels.assistantReveal = resetRevealState();
    this.revealRuntime.channels.thinkingReveal = resetRevealState();
    this._activeToolCalls.clear();
    for (const toolCallId of completedToolCallIds) {
      this._pendingToolComponents.delete(toolCallId);
    }
    this._pendingAgentGroup = null;
    this._pendingReadGroup = null;
    this._currentTurnId = undefined;
    this._currentStep = 0;
    this._streamingToolCallArguments.clear();
    this._flushState.pendingToolCallFlushIds.clear();
    requestTUILayoutRender(this.host.state);
  }

  // ---------------------------------------------------------------------------
  // Dispose helpers (moved from LioraTUI)
  // ---------------------------------------------------------------------------

  disposeActiveThinkingComponent(): void {
    if (this._activeThinkingComponent !== undefined) {
      this._activeThinkingComponent.dispose();
      this._activeThinkingComponent = undefined;
    }
    this.revealRuntime.channels.thinkingReveal = resetRevealState();
    rescheduleRevealTimerHelper(this.revealContext());
  }

  disposeAndClearPendingToolComponents(): void {
    for (const component of this._pendingToolComponents.values()) {
      if (hasDispose(component)) component.dispose();
    }
    this._pendingToolComponents.clear();
  }

  disposeActiveCompactionBlock(): void {
    if (this._activeCompactionBlock !== undefined) {
      this._activeCompactionBlock.dispose();
      this._activeCompactionBlock = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Flush control
  // ---------------------------------------------------------------------------

  hasPending(): boolean {
    return hasPendingFlush(this._flushState);
  }

  clearFlushTimer(): void {
    if (this._flushState.flushTimer === undefined) return;
    clearTimeout(this._flushState.flushTimer);
    this._flushState.flushTimer = undefined;
    this._flushState.scheduledFlushAt = undefined;
  }

  discardPending(): void {
    discardPendingFlushHelper(this._flushState);
    this.resetRevealChannelsInternal();
  }

  scheduleFlush(): void {
    scheduleFlushHelper(this._flushState, () => this.flush());
  }

  flushNow(): void {
    flushNowHelper(this._flushState, () => this.flush());
  }

  private flush(): void {
    runPendingFlush(this._flushState, {
      onThinkingFlush: () => {
        if (this._thinkingDraft.length > 0) {
          this.onThinkingUpdate(this._thinkingDraft);
        }
      },
      onAssistantFlush: () => {
        this.onStreamingTextUpdate(this._assistantDraft);
      },
      onToolCallFlush: (id) => {
        this.flushToolCallPreview(id);
      },
    });
  }

  markAssistantDirty(): void {
    this._flushState.pendingAssistantFlush = true;
  }

  markThinkingDirty(): void {
    this._flushState.pendingThinkingFlush = true;
  }

  // ---------------------------------------------------------------------------
  // Text streaming
  // ---------------------------------------------------------------------------

  flushThinkingToTranscript(nextMode: LivePaneState['mode'] = 'idle'): void {
    this.flushNow();
    this._thinkingDraft = '';
    this.onThinkingEnd();
    this.host.patchLivePane({ mode: nextMode });
  }

  finalizeAssistantStream(): void {
    this.flushNow();
    if (this._streamingBlock !== null) {
      this.onStreamingTextEnd();
    }
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
    const { state } = this.host;
    if (state.appState.streamingPhase === 'idle') return;
    this.host.deferUserMessages = false;
    const completedTurnKey =
      this._currentTurnId ?? `local:${String(state.appState.streamingStartTime)}`;
    // Capture before finalize nulls the block: the closing settle lands on the
    // turn's last assistant block (the usage/footer line keeps its own flash).
    const closingAssistantBlock = this.getStreamingBlockComponent();
    this.finalizeLiveTextBuffers('idle');
    if (closingAssistantBlock !== undefined) {
      closingAssistantBlock.markTurnEndCue(appearanceAnimationNow());
    }
    this.resetToolCallState();
    this._currentTurnId = undefined;

    const next = this.host.shiftQueuedMessage();
    if (next !== undefined) {
      this.host.setAppState({ streamingPhase: 'idle' });
      this.host.resetLivePane();
      setTimeout(() => {
        sendQueued(next);
      }, 0);
      return;
    }

    this.host.setAppState({ streamingPhase: 'idle' });
    this.host.resetLivePane();
    notifyUserAttentionOnce(state, `turn-complete:${completedTurnKey}`, {
      title: 'SuperLiora task complete',
      body: state.appState.sessionTitle ?? undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Live Render Hooks
  // ---------------------------------------------------------------------------

  onStreamingTextStart(): void {
    onStreamingTextStartHelper(this.textRenderContext());
  }

  onStreamingTextUpdate(fullText: string): void {
    onStreamingTextUpdateHelper(this.textRenderContext(), fullText);
  }

  onStreamingTextEnd(): void {
    onStreamingTextEndHelper(this.textRenderContext());
  }

  onThinkingUpdate(fullText: string): void {
    onThinkingUpdateHelper(this.textRenderContext(), fullText);
  }

  onThinkingEnd(): void {
    onThinkingEndHelper(this.textRenderContext());
  }

  onToolCallStart(toolCall: ToolCallBlockData): void {
    onToolCallStartHelper(this.toolRenderContext(), toolCall);
  }

  onToolCallEnd(toolCallId: string, result: ToolResultBlockData): void {
    onToolCallEndHelper(this.toolRenderContext(), toolCallId, result);
  }

  setTodoList(todos: readonly TodoItem[]): void {
    const { state } = this.host;
    // Preserve any live goal monitor chrome already bound via setAppState.
    state.todoPanel.setGoal(state.appState.goal);
    state.todoPanel.setTodos(todos);
    state.todoPanelContainer.clear();
    if (!state.todoPanel.isEmpty()) {
      state.todoPanelContainer.addChild(state.todoPanel);
    }
    requestTUILayoutRender(state);
  }

  beginCompaction(
    instruction?: string,
    options?: { readonly background?: boolean; readonly modelAlias?: string },
  ): void {
    this._activeCompactionBlock = beginCompactionHelper(
      this.host,
      this._activeCompactionBlock,
      instruction,
      options,
    );
  }

  endCompaction(tokensBefore?: number, tokensAfter?: number, detail?: string): void {
    this._activeCompactionBlock = endCompactionHelper(
      this.host,
      this._activeCompactionBlock,
      tokensBefore,
      tokensAfter,
      detail,
    );
  }

  cancelCompaction(): void {
    this._activeCompactionBlock = cancelCompactionHelper(this.host, this._activeCompactionBlock);
  }

  promoteCompactionToBlocking(): void {
    promoteCompactionToBlockingHelper(this.host, this._activeCompactionBlock);
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
    updateCompactionProgressHelper(this.host, this._activeCompactionBlock, phase, delta, meta);
  }

  // ---------------------------------------------------------------------------
  // Render context builders
  // ---------------------------------------------------------------------------

  private flushToolCallPreview(id: string): void {
    flushToolCallPreviewHelper(this.toolRenderContext(), id);
  }

  private textRenderContext(): TextRenderContext {
    return {
      host: this.host,
      revealRuntime: this.revealRuntime,
      getStreamingBlock: () => this._streamingBlock,
      setStreamingBlock: (block) => {
        this._streamingBlock = block;
      },
      getTurnStartCueArmed: () => this.turnStartCueArmed,
      setTurnStartCueArmed: (armed) => {
        this.turnStartCueArmed = armed;
      },
      getCurrentTurnId: () => this._currentTurnId,
      getActiveThinkingComponent: () => this._activeThinkingComponent,
      setActiveThinkingComponent: (component) => {
        this._activeThinkingComponent = component;
      },
      clearPendingToolGroups: () => {
        this._pendingAgentGroup = null;
        this._pendingReadGroup = null;
      },
      settleActiveChainSummary: () => this.settleActiveChainSummary(),
      shouldSmoothStreamReveal: () => this.shouldSmoothStreamReveal(),
      revealContext: () => this.revealContext(),
    };
  }

  private toolRenderContext(): ToolRenderContext {
    return {
      host: this.host,
      getCurrentStep: () => this._currentStep,
      getCurrentTurnId: () => this._currentTurnId,
      getActiveToolCalls: () => this._activeToolCalls,
      getPendingToolComponents: () => this._pendingToolComponents,
      getStreamingToolCallArguments: () => this._streamingToolCallArguments,
      getChainSummary: () => this._chainSummary,
      getPendingAgentGroup: () => this._pendingAgentGroup,
      setPendingAgentGroup: (group) => {
        this._pendingAgentGroup = group;
      },
      getPendingReadGroup: () => this._pendingReadGroup,
      setPendingReadGroup: (group) => {
        this._pendingReadGroup = group;
      },
      getThinkingDraftLength: () => this._thinkingDraft.length,
      hasStreamingBlock: () => this._streamingBlock !== null,
      finalizeLiveTextBuffers: (mode) => this.finalizeLiveTextBuffers(mode),
      onToolCallStart: (toolCall) => this.onToolCallStart(toolCall),
    };
  }

  private shouldSmoothStreamReveal(): boolean {
    return shouldSmoothStreamRevealHelper(this.host.state.appState.isReplaying);
  }

  private resetRevealChannelsInternal(nowMs: number = 0): void {
    resetRevealChannelsHelper(this.revealContext(), nowMs);
  }

  private revealContext(): StreamingRevealContext {
    return {
      state: this.host.state,
      isReplaying: this.host.state.appState.isReplaying,
      runtime: this.revealRuntime,
      getStreamingBlock: () => this._streamingBlock,
      getActiveThinkingComponent: () => this._activeThinkingComponent,
    };
  }

  private settleActiveChainSummary(): void {
    settleActiveChainSummaryHelper(this._chainSummary);
  }
}
