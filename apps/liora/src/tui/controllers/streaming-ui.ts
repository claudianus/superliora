import type { CompactionPhase, Session } from '@superliora/sdk';

import type { AgentGroupComponent } from '../components/messages/agent-group';
import { AssistantMessageComponent } from '../components/messages/assistant-message';
import type { CompactionComponent } from '../components/dialogs/compaction';
import type { ReadGroupComponent } from '../components/messages/read-group';
import { ThinkingComponent } from '../components/messages/thinking';
import { ToolCallComponent } from '../components/messages/tool-call';
import { isSwarmProgressToolName } from '../components/messages/agent-swarm-progress';
import { isGenericToolResult } from '../components/messages/tool-renderers/registry';
import {
  STREAMING_UI_FLUSH_BURST_DELTAS,
  STREAMING_UI_FLUSH_MAX_MS,
  STREAMING_UI_FLUSH_MS,
} from '../constant/streaming';
import {
  appearanceAnimationNow,
} from '../utils/appearance-effects';
import { hasDispose } from '../utils/component-capabilities';
import { appendStreamingArgsPreview, parseStreamingArgs } from '../utils/event-payload';
import { isMotionTheatreActive, type MotionBeatController } from '../utils/motion-beats';
import { nextStreamingFlushDelay } from '../utils/streaming-flush-schedule';
import {
  createStreamingTextRevealState,
  resetRevealState,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
} from '../utils/streaming-text-reveal';
import { notifyUserAttentionOnce } from '../utils/terminal-notification';
import { nextTranscriptId } from '../utils/transcript-id';
import type { TodoItem } from '../components/chrome/todo-panel';
import type {
  AppState,
  LivePaneState,
  QueuedMessage,
  ToolCallBlockData,
  ToolResultBlockData,
  TranscriptEntry,
} from '../types';
import type { TUIState } from '../tui-state';
import { requestTUIContentRender, requestTUILayoutRender } from '#/tui/utils/frame-render';
import {
  applyBackgroundTaskTerminalStatus as applyBackgroundTaskTerminalStatusHelper,
  markSubagentBackgrounded as markSubagentBackgroundedHelper,
} from './streaming-ui-background-agent';
import {
  ensureChainSummary as ensureChainSummaryHelper,
  settleActiveChainSummary as settleActiveChainSummaryHelper,
  type ChainSummaryState,
} from './streaming-ui-chain-summary';
import {
  beginCompaction as beginCompactionHelper,
  cancelCompaction as cancelCompactionHelper,
  endCompaction as endCompactionHelper,
  promoteCompactionToBlocking as promoteCompactionToBlockingHelper,
  updateCompactionProgress as updateCompactionProgressHelper,
} from './streaming-ui-compaction';
import {
  clearRevealTimer as clearRevealTimerHelper,
  resetRevealChannels as resetRevealChannelsHelper,
  rescheduleRevealTimer as rescheduleRevealTimerHelper,
  shouldSmoothStreamReveal as shouldSmoothStreamRevealHelper,
  type StreamingRevealContext,
} from './streaming-ui-reveal';
import {
  tryAttachAgentToolCall as attachAgentToolCall,
  tryAttachReadToolCall as attachReadToolCall,
  type PendingToolGroup,
} from './streaming-ui-tool-groups';

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
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private lastFlushAt: number | undefined;
  /** Scheduled fire time (ms epoch) of the pending flushTimer, if any. */
  private scheduledFlushAt: number | undefined;
  /** Dirty marks since the last flush; drives adaptive burst coalescing. */
  private dirtyMarksSinceFlush = 0;
  private pendingAssistantFlush = false;
  private pendingThinkingFlush = false;
  readonly pendingToolCallFlushIds = new Set<string>();

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
  private _streamingBlock: { component: AssistantMessageComponent; entry: TranscriptEntry } | null = null;
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
    this.pendingThinkingFlush = true;
    this.dirtyMarksSinceFlush += 1;
  }

  appendAssistantDelta(delta: string): void {
    if (this._streamingBlock === null) {
      this.onStreamingTextStart();
    }
    this._assistantDraft += delta;
    this.pendingAssistantFlush = true;
    this.dirtyMarksSinceFlush += 1;
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
    this.pendingToolCallFlushIds.delete(toolCall.id);
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
    this.pendingToolCallFlushIds.add(id);
    this.dirtyMarksSinceFlush += 1;
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
    this.pendingToolCallFlushIds.clear();
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
    return (
      this.pendingAssistantFlush ||
      this.pendingThinkingFlush ||
      this.pendingToolCallFlushIds.size > 0
    );
  }

  clearFlushTimer(): void {
    if (this.flushTimer === undefined) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.scheduledFlushAt = undefined;
  }

  private clearFlushTimerIfIdle(): void {
    if (this.hasPending()) return;
    this.clearFlushTimer();
    this.dirtyMarksSinceFlush = 0;
  }

  discardPending(): void {
    this.clearFlushTimer();
    this.resetRevealChannelsInternal();
    this.pendingAssistantFlush = false;
    this.pendingThinkingFlush = false;
    this.pendingToolCallFlushIds.clear();
    this.dirtyMarksSinceFlush = 0;
  }

  scheduleFlush(): void {
    if (!this.hasPending()) return;
    const now = Date.now();
    const delay = nextStreamingFlushDelay({
      now,
      lastFlushAt: this.lastFlushAt,
      pendingDeltaCount: this.dirtyMarksSinceFlush,
      baseMs: STREAMING_UI_FLUSH_MS,
      maxMs: STREAMING_UI_FLUSH_MAX_MS,
      burstThreshold: STREAMING_UI_FLUSH_BURST_DELTAS,
    });
    const fireAt = now + delay;
    if (this.flushTimer !== undefined) {
      // A burst may stretch the window later; never pull a scheduled flush
      // earlier than the fire time we already promised.
      if (fireAt <= (this.scheduledFlushAt ?? Number.POSITIVE_INFINITY)) return;
      this.clearFlushTimer();
    }
    this.scheduledFlushAt = fireAt;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.scheduledFlushAt = undefined;
      this.flush();
    }, delay);
  }

  flushNow(): void {
    this.clearFlushTimer();
    this.flush();
  }

  private flush(): void {
    if (!this.hasPending()) return;
    this.lastFlushAt = Date.now();
    const shouldFlushThinking = this.pendingThinkingFlush;
    const shouldFlushAssistant = this.pendingAssistantFlush;
    const toolCallIds = [...this.pendingToolCallFlushIds];
    this.pendingThinkingFlush = false;
    this.pendingAssistantFlush = false;
    this.pendingToolCallFlushIds.clear();
    this.dirtyMarksSinceFlush = 0;

    if (shouldFlushThinking && this._thinkingDraft.length > 0) {
      this.onThinkingUpdate(this._thinkingDraft);
    }
    if (shouldFlushAssistant) {
      this.onStreamingTextUpdate(this._assistantDraft);
    }
    for (const id of toolCallIds) {
      this.flushToolCallPreview(id);
    }
  }

  markAssistantDirty(): void {
    this.pendingAssistantFlush = true;
  }

  markThinkingDirty(): void {
    this.pendingThinkingFlush = true;
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
    this.pendingAssistantFlush = false;
    this.pendingThinkingFlush = false;
    this.clearFlushTimerIfIdle();
    this.resetRevealChannelsInternal();
    this._assistantDraft = '';
    this._streamingBlock = null;
    this._thinkingDraft = '';
    this.disposeActiveThinkingComponent();
  }

  resetToolUi(): void {
    this.pendingToolCallFlushIds.clear();
    this.clearFlushTimerIfIdle();
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
    const { state } = this.host;
    // The answer phase begins: the minimal-density tool chain summary (if
    // any) switches to its settled past-tense form.
    this.settleActiveChainSummary();
    this._pendingAgentGroup = null;
    this._pendingReadGroup = null;
    this.revealRuntime.channels.assistantReveal = resetRevealState(Date.now());
    rescheduleRevealTimerHelper(this.revealContext());
    const entry = {
      id: nextTranscriptId(),
      kind: 'assistant' as const,
      turnId: this._currentTurnId,
      renderMode: 'markdown' as const,
      content: '',
    };
    const component = new AssistantMessageComponent();
    if (this.turnStartCueArmed) {
      this.turnStartCueArmed = false;
      component.markTurnStartCue(appearanceAnimationNow());
    }
    this._streamingBlock = { component, entry };
    this.host.pushTranscriptEntry(entry);
    state.transcriptContainer.addChild(component);
    requestTUILayoutRender(state);
  }

  onStreamingTextUpdate(fullText: string): void {
    const block = this._streamingBlock;
    if (block === null) return;

    // Truth source: full server draft always lives on the transcript entry.
    block.entry.content = fullText;
    const nowMs = Date.now();

    if (!this.shouldSmoothStreamReveal()) {
      this.revealRuntime.channels.assistantReveal = snapRevealToTarget(
        setRevealTarget(this.revealRuntime.channels.assistantReveal, fullText, nowMs),
        nowMs,
      );
      block.component.updateContent(fullText, { transient: true });
      requestTUIContentRender(this.host.state);
      rescheduleRevealTimerHelper(this.revealContext());
      return;
    }

    this.revealRuntime.channels.assistantReveal = setRevealTarget(this.revealRuntime.channels.assistantReveal, fullText, nowMs);
    // Immediate tick so the first chunk is not delayed until the timer fires.
    this.revealRuntime.channels.assistantReveal = tickReveal(this.revealRuntime.channels.assistantReveal, nowMs);
    block.component.updateContent(visibleText(this.revealRuntime.channels.assistantReveal), { transient: true });
    requestTUIContentRender(this.host.state);
    rescheduleRevealTimerHelper(this.revealContext());
  }

  onStreamingTextEnd(): void {
    const block = this._streamingBlock;
    if (block !== null) {
      // Snap any lagging reveal so finalize never leaves a partial body.
      const nowMs = Date.now();
      this.revealRuntime.channels.assistantReveal = snapRevealToTarget(
        setRevealTarget(this.revealRuntime.channels.assistantReveal, block.entry.content, nowMs),
        nowMs,
      );
      block.component.updateContent(block.entry.content, { transient: false });
    }
    this._streamingBlock = null;
    this.revealRuntime.channels.assistantReveal = resetRevealState();
    rescheduleRevealTimerHelper(this.revealContext());
  }

  onThinkingUpdate(fullText: string): void {
    if (fullText.length === 0 && this._activeThinkingComponent === undefined) return;
    const { state } = this.host;
    const nowMs = Date.now();

    if (!this.shouldSmoothStreamReveal()) {
      this.revealRuntime.channels.thinkingReveal = snapRevealToTarget(
        setRevealTarget(this.revealRuntime.channels.thinkingReveal, fullText, nowMs),
        nowMs,
      );
      if (this._activeThinkingComponent === undefined) {
        this._pendingAgentGroup = null;
        this._pendingReadGroup = null;
        this._activeThinkingComponent = new ThinkingComponent(
          fullText,
          true,
          'live',
          state.ui,
        );
        if (state.toolOutputExpanded) this._activeThinkingComponent.setExpanded(true);
        state.transcriptContainer.addChild(this._activeThinkingComponent);
        requestTUILayoutRender(state);
        rescheduleRevealTimerHelper(this.revealContext());
        return;
      }
      this._activeThinkingComponent.setText(fullText);
      requestTUIContentRender(state);
      rescheduleRevealTimerHelper(this.revealContext());
      return;
    }

    this.revealRuntime.channels.thinkingReveal = setRevealTarget(this.revealRuntime.channels.thinkingReveal, fullText, nowMs);
    this.revealRuntime.channels.thinkingReveal = tickReveal(this.revealRuntime.channels.thinkingReveal, nowMs);
    const shown = visibleText(this.revealRuntime.channels.thinkingReveal);

    if (this._activeThinkingComponent === undefined) {
      this._pendingAgentGroup = null;
      this._pendingReadGroup = null;
      this._activeThinkingComponent = new ThinkingComponent(shown, true, 'live', state.ui);
      if (state.toolOutputExpanded) this._activeThinkingComponent.setExpanded(true);
      state.transcriptContainer.addChild(this._activeThinkingComponent);
      requestTUILayoutRender(state);
      rescheduleRevealTimerHelper(this.revealContext());
      return;
    }

    this._activeThinkingComponent.setText(shown);
    requestTUIContentRender(state);
    rescheduleRevealTimerHelper(this.revealContext());
  }

  onThinkingEnd(): void {
    if (this._activeThinkingComponent === undefined) return;
    const nowMs = Date.now();
    // Snap full thinking body before finalize so collapsed previews are complete.
    this.revealRuntime.channels.thinkingReveal = snapRevealToTarget(this.revealRuntime.channels.thinkingReveal, nowMs);
    if (this.revealRuntime.channels.thinkingReveal.target.length > 0) {
      this._activeThinkingComponent.setText(this.revealRuntime.channels.thinkingReveal.target);
    }
    this._activeThinkingComponent.finalize();
    this._activeThinkingComponent = undefined;
    this.revealRuntime.channels.thinkingReveal = resetRevealState();
    rescheduleRevealTimerHelper(this.revealContext());
    requestTUILayoutRender(this.host.state);
    this.host.mergeCurrentTurnSteps();
  }

  onToolCallStart(toolCall: ToolCallBlockData): void {
    if (toolCall.name === 'AskUserQuestion') return;

    const { state } = this.host;
    const tc = new ToolCallComponent(
      toolCall,
      undefined,
      state.ui,
      state.appState.workDir,
      state.toolOutputViewports,
    );
    if (state.toolOutputExpanded) tc.setExpanded(true);
    tc.setDetail(state.transcriptDetail);
    this._pendingToolComponents.set(toolCall.id, tc);
    if (state.transcriptDetail === 'minimal') {
      // Mounts before this tool card is appended, so the aggregate line
      // leads the turn's one-line tool block.
      ensureChainSummaryHelper(state, this._chainSummary).setCurrentLabel(toolCall.name);
    }

    if (toolCall.name !== 'Agent') this._pendingAgentGroup = null;
    if (toolCall.name !== 'Read') this._pendingReadGroup = null;

    let handled = this.tryAttachAgentToolCall(toolCall, tc);
    if (!handled) handled = this.tryAttachReadToolCall(toolCall, tc);
    if (!handled) {
      state.transcriptContainer.addChild(tc);
      requestTUILayoutRender(state);
    }

    if (toolCall.name === 'ExitPlanMode' && typeof toolCall.args['plan'] !== 'string') {
      const session = this.host.requireSession();
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

  onToolCallEnd(toolCallId: string, result: ToolResultBlockData): void {
    const { state } = this.host;
    const matchedCall = this._activeToolCalls.get(toolCallId);
    const tc = this._pendingToolComponents.get(toolCallId);
    if (tc) {
      tc.setResult(result);
      this._pendingToolComponents.delete(toolCallId);
      if (state.transcriptDetail === 'minimal' && this._chainSummary.active !== null) {
        const args = matchedCall?.args ?? {};
        const file =
          typeof args['file_path'] === 'string'
            ? (args['file_path'] as string)
            : typeof args['path'] === 'string'
              ? (args['path'] as string)
              : undefined;
        this._chainSummary.active.record({
          isError: result.is_error === true,
          errorText: result.is_error === true ? result.output : undefined,
          file,
        });
      }
      const toolName = matchedCall?.name;
      if (toolName !== undefined && isGenericToolResult(toolName)) {
        this.host.motionBeats.play({
          name: 'tool_settle',
          seed: `tool:${toolCallId}`,
          title: toolName,
          nowMs: appearanceAnimationNow(),
          streamThrottle: true,
          theatreActive: isMotionTheatreActive(state.appState),
        });
      }
      requestTUIContentRender(state);
      this.host.mergeCurrentTurnSteps();
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
    this.host.mergeCurrentTurnSteps();
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
  // Tool call grouping
  // ---------------------------------------------------------------------------

  private flushToolCallPreview(id: string): void {
    const streaming = this._streamingToolCallArguments.get(id);
    if (streaming === undefined) return;
    const toolCall: ToolCallBlockData = {
      id,
      name: streaming.name ?? this._activeToolCalls.get(id)?.name ?? 'Tool',
      args: parseStreamingArgs(streaming.argumentsText),
      streamingArguments: streaming.argumentsText,
      streamingStartedAtMs: streaming.startedAtMs,
      step: this._currentStep,
      turnId: this._currentTurnId,
    };
    this._activeToolCalls.set(id, toolCall);

    if (this._thinkingDraft.length > 0 || this._streamingBlock !== null) {
      this.finalizeLiveTextBuffers('tool');
    }

    const existingComponent = this._pendingToolComponents.get(id);
    if (existingComponent !== undefined) {
      existingComponent.updateToolCall(toolCall);
    } else if (toolCall.name !== 'Agent' && !isSwarmProgressToolName(toolCall.name)) {
      this.onToolCallStart(toolCall);
    }
  }

  private tryAttachAgentToolCall(toolCall: ToolCallBlockData, tc: ToolCallComponent): boolean {
    const result = attachAgentToolCall(
      this.host.state,
      toolCall,
      tc,
      this._currentStep,
      this._currentTurnId,
      this._pendingAgentGroup,
    );
    this._pendingAgentGroup = result.pending;
    return result.handled;
  }

  private tryAttachReadToolCall(toolCall: ToolCallBlockData, tc: ToolCallComponent): boolean {
    const result = attachReadToolCall(
      this.host.state,
      toolCall,
      tc,
      this._currentStep,
      this._currentTurnId,
      this._pendingReadGroup,
    );
    this._pendingReadGroup = result.pending;
    return result.handled;
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
