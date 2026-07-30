import { STREAM_REVEAL_TICK_MS } from '../../constant/streaming';
import { shouldAnimate } from '../appearance/index';
import { getActiveAppearancePreferences } from '../../features/appearance/appearance-effects';
import {
  isRevealCaughtUp,
  resetRevealState,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
  type StreamingTextRevealState,
} from '../../utils/streaming/streaming-text-reveal';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import type { AssistantMessageComponent } from '../../components/messages/assistant-message';
import type { ThinkingComponent } from '../../components/messages/thinking';
import type { TUIState } from '../../tui-state';

export interface StreamingRevealChannels {
  assistantReveal: StreamingTextRevealState;
  thinkingReveal: StreamingTextRevealState;
}

export interface StreamingRevealRuntime {
  revealTimer: ReturnType<typeof setTimeout> | undefined;
  channels: StreamingRevealChannels;
}

export interface StreamingRevealContext {
  readonly state: TUIState;
  readonly isReplaying: boolean;
  readonly runtime: StreamingRevealRuntime;
  getStreamingBlock(): {
    component: AssistantMessageComponent;
    entry: { content: string };
  } | null;
  getActiveThinkingComponent(): ThinkingComponent | undefined;
}

export function shouldSmoothStreamReveal(isReplaying: boolean): boolean {
  if (isReplaying) return false;
  return shouldAnimate(getActiveAppearancePreferences());
}

export function resetRevealChannels(
  ctx: StreamingRevealContext,
  nowMs: number = 0,
): void {
  clearRevealTimer(ctx);
  ctx.runtime.channels.assistantReveal = resetRevealState(nowMs);
  ctx.runtime.channels.thinkingReveal = resetRevealState(nowMs);
}

export function clearRevealTimer(ctx: StreamingRevealContext): void {
  if (ctx.runtime.revealTimer === undefined) return;
  clearTimeout(ctx.runtime.revealTimer);
  ctx.runtime.revealTimer = undefined;
}

/** Start / stop the shared reveal timer based on remaining lag. */
export function rescheduleRevealTimer(ctx: StreamingRevealContext): void {
  const { channels } = ctx.runtime;
  const assistantLag =
    ctx.getStreamingBlock() !== null && !isRevealCaughtUp(channels.assistantReveal);
  const thinkingLag =
    ctx.getActiveThinkingComponent() !== undefined &&
    !isRevealCaughtUp(channels.thinkingReveal);
  if (!assistantLag && !thinkingLag) {
    clearRevealTimer(ctx);
    return;
  }
  if (ctx.runtime.revealTimer !== undefined) return;
  ctx.runtime.revealTimer = setTimeout(() => {
    ctx.runtime.revealTimer = undefined;
    onRevealTick(ctx);
  }, STREAM_REVEAL_TICK_MS);
}

export function onRevealTick(ctx: StreamingRevealContext): void {
  if (!shouldSmoothStreamReveal(ctx.isReplaying)) {
    snapAllActiveReveals(ctx);
    return;
  }

  const nowMs = Date.now();
  let painted = false;
  const { channels } = ctx.runtime;

  const block = ctx.getStreamingBlock();
  if (block !== null && !isRevealCaughtUp(channels.assistantReveal)) {
    channels.assistantReveal = setRevealTarget(
      channels.assistantReveal,
      block.entry.content,
      nowMs,
    );
    channels.assistantReveal = tickReveal(channels.assistantReveal, nowMs);
    block.component.updateContent(visibleText(channels.assistantReveal), { transient: true });
    painted = true;
  }

  const thinking = ctx.getActiveThinkingComponent();
  if (thinking !== undefined && !isRevealCaughtUp(channels.thinkingReveal)) {
    channels.thinkingReveal = tickReveal(channels.thinkingReveal, nowMs);
    thinking.setText(visibleText(channels.thinkingReveal));
    painted = true;
  }

  if (painted) {
    requestTUIContentRender(ctx.state);
  }
  rescheduleRevealTimer(ctx);
}

export function snapAllActiveReveals(ctx: StreamingRevealContext): void {
  const nowMs = Date.now();
  const { channels } = ctx.runtime;
  const block = ctx.getStreamingBlock();
  if (block !== null) {
    channels.assistantReveal = snapRevealToTarget(
      setRevealTarget(channels.assistantReveal, block.entry.content, nowMs),
      nowMs,
    );
    block.component.updateContent(block.entry.content, { transient: true });
  }
  const thinking = ctx.getActiveThinkingComponent();
  if (thinking !== undefined) {
    channels.thinkingReveal = snapRevealToTarget(channels.thinkingReveal, nowMs);
    thinking.setText(channels.thinkingReveal.target);
  }
  requestTUIContentRender(ctx.state);
  clearRevealTimer(ctx);
}
