import { STREAM_REVEAL_TICK_MS } from '../../constant/streaming';
import { shouldAnimate } from '../appearance/index';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '../../features/appearance/appearance-effects';
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
  /**
   * When true, the native frame callback advances reveal via
   * {@link tickArmedStreamReveal} on the shared animation clock.
   * Replaces a private setTimeout chain (PREMIUM §7.1).
   */
  revealArmed: boolean;
  /** Last reveal advance on `appearanceAnimationNow()` (min-interval guard). */
  lastRevealTickMs: number;
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

/** Context currently armed for ambient-driven catch-up ticks. */
let armedRevealCtx: StreamingRevealContext | undefined;

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

/** Disarm ambient reveal ticks (name kept for call-site compatibility). */
export function clearRevealTimer(ctx: StreamingRevealContext): void {
  ctx.runtime.revealArmed = false;
  ctx.runtime.lastRevealTickMs = 0;
  if (armedRevealCtx === ctx) armedRevealCtx = undefined;
}

function channelsStillLagging(ctx: StreamingRevealContext): boolean {
  const { channels } = ctx.runtime;
  const assistantLag =
    ctx.getStreamingBlock() !== null && !isRevealCaughtUp(channels.assistantReveal);
  const thinkingLag =
    ctx.getActiveThinkingComponent() !== undefined &&
    !isRevealCaughtUp(channels.thinkingReveal);
  return assistantLag || thinkingLag;
}

/**
 * Arm / disarm shared-clock reveal catch-up. While lagging, the next native
 * frames call {@link tickArmedStreamReveal}; we also invalidate once so a
 * wake happens even if ambient is momentarily gated.
 */
export function rescheduleRevealTimer(ctx: StreamingRevealContext): void {
  if (!channelsStillLagging(ctx)) {
    clearRevealTimer(ctx);
    return;
  }
  armedRevealCtx = ctx;
  ctx.runtime.revealArmed = true;
  requestTUIContentRender(ctx.state);
}

/**
 * Advance armed reveal channels on the shared animation clock.
 * Called from the native frame callback after `advanceAppearanceAnimationClock`.
 */
export function tickArmedStreamReveal(): void {
  const ctx = armedRevealCtx;
  if (ctx === undefined || !ctx.runtime.revealArmed) return;
  if (!shouldSmoothStreamReveal(ctx.isReplaying)) {
    snapAllActiveReveals(ctx);
    return;
  }
  const nowMs = appearanceAnimationNow();
  if (
    ctx.runtime.lastRevealTickMs > 0 &&
    nowMs - ctx.runtime.lastRevealTickMs < STREAM_REVEAL_TICK_MS
  ) {
    return;
  }
  onRevealTick(ctx, { inFrame: true });
}

export function onRevealTick(
  ctx: StreamingRevealContext,
  options: { readonly inFrame?: boolean } = {},
): void {
  if (!shouldSmoothStreamReveal(ctx.isReplaying)) {
    snapAllActiveReveals(ctx);
    return;
  }

  const nowMs = appearanceAnimationNow();
  ctx.runtime.lastRevealTickMs = nowMs;
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
    ctx.state.transcriptContainer.invalidateChildGeometry(block.component);
    painted = true;
  }

  const thinking = ctx.getActiveThinkingComponent();
  if (thinking !== undefined && !isRevealCaughtUp(channels.thinkingReveal)) {
    channels.thinkingReveal = tickReveal(channels.thinkingReveal, nowMs);
    thinking.setText(visibleText(channels.thinkingReveal));
    ctx.state.transcriptContainer.invalidateChildGeometry(thinking);
    painted = true;
  }

  // Inside a native frame the current paint already rebuilds the transcript;
  // only schedule a follow-up wake when we are driving reveal outside a frame.
  if (painted && options.inFrame !== true) {
    requestTUIContentRender(ctx.state);
  }

  if (channelsStillLagging(ctx)) {
    armedRevealCtx = ctx;
    ctx.runtime.revealArmed = true;
    if (options.inFrame === true) {
      // Ensure another frame lands after STREAM_REVEAL_TICK_MS even if ambient
      // soft-degrades — content invalidation coalesces with the render loop.
      requestTUIContentRender(ctx.state);
    } else {
      rescheduleRevealTimer(ctx);
    }
  } else {
    clearRevealTimer(ctx);
  }
}

export function snapAllActiveReveals(ctx: StreamingRevealContext): void {
  const nowMs = appearanceAnimationNow();
  const { channels } = ctx.runtime;
  const block = ctx.getStreamingBlock();
  if (block !== null) {
    channels.assistantReveal = snapRevealToTarget(
      setRevealTarget(channels.assistantReveal, block.entry.content, nowMs),
      nowMs,
    );
    block.component.updateContent(block.entry.content, { transient: true });
    ctx.state.transcriptContainer.invalidateChildGeometry(block.component);
  }
  const thinking = ctx.getActiveThinkingComponent();
  if (thinking !== undefined) {
    channels.thinkingReveal = snapRevealToTarget(channels.thinkingReveal, nowMs);
    thinking.setText(channels.thinkingReveal.target);
    ctx.state.transcriptContainer.invalidateChildGeometry(thinking);
  }
  requestTUIContentRender(ctx.state);
  clearRevealTimer(ctx);
}
