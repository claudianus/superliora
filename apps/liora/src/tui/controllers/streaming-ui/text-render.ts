import { AssistantMessageComponent } from '../../components/messages/assistant-message';
import { ThinkingComponent } from '../../components/messages/thinking';
import {
  appearanceAnimationNow,
} from '../../features/appearance/appearance-effects';
import {
  resetRevealState,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
} from '../../utils/streaming/streaming-text-reveal';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import type { TranscriptEntry } from '../../types';
import { requestTUIContentRender, requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  rescheduleRevealTimer as rescheduleRevealTimerHelper,
  type StreamingRevealContext,
  type StreamingRevealRuntime,
} from './reveal';
import {
  noteStreamPhase,
  type PhaseBoundaryState,
} from './phase-boundary';
import type { StreamingUIHost } from '.';

export interface StreamingTextBlock {
  component: AssistantMessageComponent;
  entry: TranscriptEntry;
}

export interface TextRenderContext {
  readonly host: StreamingUIHost;
  readonly revealRuntime: StreamingRevealRuntime;
  getStreamingBlock(): StreamingTextBlock | null;
  setStreamingBlock(block: StreamingTextBlock | null): void;
  getTurnStartCueArmed(): boolean;
  setTurnStartCueArmed(armed: boolean): void;
  getCurrentTurnId(): string | undefined;
  getActiveThinkingComponent(): ThinkingComponent | undefined;
  setActiveThinkingComponent(component: ThinkingComponent | undefined): void;
  getPhaseBoundary(): PhaseBoundaryState;
  clearPendingToolGroups(): void;
  settleActiveChainSummary(): void;
  shouldSmoothStreamReveal(): boolean;
  revealContext(): StreamingRevealContext;
}

export function onStreamingTextStart(ctx: TextRenderContext): void {
  const { state } = ctx.host;
  // The answer phase begins: the minimal-density tool chain summary (if
  // any) switches to its settled past-tense form.
  ctx.settleActiveChainSummary();
  ctx.clearPendingToolGroups();
  // Advance phase tracker; answer component paints its own header.
  noteStreamPhase(state, ctx.getPhaseBoundary(), 'answer');
  ctx.revealRuntime.channels.assistantReveal = resetRevealState(Date.now());
  rescheduleRevealTimerHelper(ctx.revealContext());
  const entry = {
    id: nextTranscriptId(),
    kind: 'assistant' as const,
    turnId: ctx.getCurrentTurnId(),
    renderMode: 'markdown' as const,
    content: '',
  };
  const component = new AssistantMessageComponent();
  if (ctx.getTurnStartCueArmed()) {
    ctx.setTurnStartCueArmed(false);
    component.markTurnStartCue(appearanceAnimationNow());
  }
  ctx.setStreamingBlock({ component, entry });
  ctx.host.pushTranscriptEntry(entry);
  state.transcriptContainer.addChild(component);
  requestTUILayoutRender(state);
}

export function onStreamingTextUpdate(ctx: TextRenderContext, fullText: string): void {
  const block = ctx.getStreamingBlock();
  if (block === null) return;

  // Truth source: full server draft always lives on the transcript entry.
  block.entry.content = fullText;
  const nowMs = Date.now();

  if (!ctx.shouldSmoothStreamReveal()) {
    ctx.revealRuntime.channels.assistantReveal = snapRevealToTarget(
      setRevealTarget(ctx.revealRuntime.channels.assistantReveal, fullText, nowMs),
      nowMs,
    );
    block.component.updateContent(fullText, { transient: true });
    // In-place height growth — dirty only this slot, not the whole transcript.
    ctx.host.state.transcriptContainer.invalidateChildGeometry(block.component);
    requestTUIContentRender(ctx.host.state);
    rescheduleRevealTimerHelper(ctx.revealContext());
    return;
  }

  ctx.revealRuntime.channels.assistantReveal = setRevealTarget(
    ctx.revealRuntime.channels.assistantReveal,
    fullText,
    nowMs,
  );
  // Immediate tick so the first chunk is not delayed until the timer fires.
  ctx.revealRuntime.channels.assistantReveal = tickReveal(
    ctx.revealRuntime.channels.assistantReveal,
    nowMs,
  );
  block.component.updateContent(visibleText(ctx.revealRuntime.channels.assistantReveal), {
    transient: true,
  });
  ctx.host.state.transcriptContainer.invalidateChildGeometry(block.component);
  requestTUIContentRender(ctx.host.state);
  rescheduleRevealTimerHelper(ctx.revealContext());
}

export function onStreamingTextEnd(ctx: TextRenderContext): void {
  const block = ctx.getStreamingBlock();
  if (block !== null) {
    // Snap any lagging reveal so finalize never leaves a partial body.
    const nowMs = Date.now();
    ctx.revealRuntime.channels.assistantReveal = snapRevealToTarget(
      setRevealTarget(ctx.revealRuntime.channels.assistantReveal, block.entry.content, nowMs),
      nowMs,
    );
    block.component.updateContent(block.entry.content, { transient: false });
    ctx.host.state.transcriptContainer.invalidateChildGeometry(block.component);
  }
  ctx.setStreamingBlock(null);
  ctx.revealRuntime.channels.assistantReveal = resetRevealState();
  rescheduleRevealTimerHelper(ctx.revealContext());
}

export function onThinkingUpdate(ctx: TextRenderContext, fullText: string): void {
  if (fullText.length === 0 && ctx.getActiveThinkingComponent() === undefined) return;
  const { state } = ctx.host;
  const nowMs = Date.now();

  if (!ctx.shouldSmoothStreamReveal()) {
    ctx.revealRuntime.channels.thinkingReveal = snapRevealToTarget(
      setRevealTarget(ctx.revealRuntime.channels.thinkingReveal, fullText, nowMs),
      nowMs,
    );
    if (ctx.getActiveThinkingComponent() === undefined) {
      ctx.clearPendingToolGroups();
      // Advance phase tracker; thinking component paints its own header.
      noteStreamPhase(state, ctx.getPhaseBoundary(), 'thinking');
      const component = new ThinkingComponent(fullText, true, 'live', state.ui);
      if (state.toolOutputExpanded) component.setExpanded(true);
      ctx.setActiveThinkingComponent(component);
      state.transcriptContainer.addChild(component);
      requestTUILayoutRender(state);
      rescheduleRevealTimerHelper(ctx.revealContext());
      return;
    }
    const thinking = ctx.getActiveThinkingComponent()!;
    thinking.setText(fullText);
    state.transcriptContainer.invalidateChildGeometry(thinking);
    requestTUIContentRender(state);
    rescheduleRevealTimerHelper(ctx.revealContext());
    return;
  }

  ctx.revealRuntime.channels.thinkingReveal = setRevealTarget(
    ctx.revealRuntime.channels.thinkingReveal,
    fullText,
    nowMs,
  );
  ctx.revealRuntime.channels.thinkingReveal = tickReveal(
    ctx.revealRuntime.channels.thinkingReveal,
    nowMs,
  );
  const shown = visibleText(ctx.revealRuntime.channels.thinkingReveal);

  if (ctx.getActiveThinkingComponent() === undefined) {
    ctx.clearPendingToolGroups();
    // Advance phase tracker; thinking component paints its own header.
    noteStreamPhase(state, ctx.getPhaseBoundary(), 'thinking');
    const component = new ThinkingComponent(shown, true, 'live', state.ui);
    if (state.toolOutputExpanded) component.setExpanded(true);
    ctx.setActiveThinkingComponent(component);
    state.transcriptContainer.addChild(component);
    requestTUILayoutRender(state);
    rescheduleRevealTimerHelper(ctx.revealContext());
    return;
  }

  const thinking = ctx.getActiveThinkingComponent()!;
  thinking.setText(shown);
  state.transcriptContainer.invalidateChildGeometry(thinking);
  requestTUIContentRender(state);
  rescheduleRevealTimerHelper(ctx.revealContext());
}

export function onThinkingEnd(ctx: TextRenderContext): void {
  if (ctx.getActiveThinkingComponent() === undefined) return;
  const nowMs = Date.now();
  // Snap full thinking body before finalize so collapsed previews are complete.
  ctx.revealRuntime.channels.thinkingReveal = snapRevealToTarget(
    ctx.revealRuntime.channels.thinkingReveal,
    nowMs,
  );
  const thinkingEnd = ctx.getActiveThinkingComponent()!;
  if (ctx.revealRuntime.channels.thinkingReveal.target.length > 0) {
    thinkingEnd.setText(ctx.revealRuntime.channels.thinkingReveal.target);
  }
  thinkingEnd.finalize();
  ctx.host.state.transcriptContainer.invalidateChildGeometry(thinkingEnd);
  ctx.setActiveThinkingComponent(undefined);
  ctx.revealRuntime.channels.thinkingReveal = resetRevealState();
  rescheduleRevealTimerHelper(ctx.revealContext());
  requestTUILayoutRender(ctx.host.state);
  ctx.host.mergeCurrentTurnSteps();
}
