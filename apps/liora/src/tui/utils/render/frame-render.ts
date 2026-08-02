import type { TUIState } from '../../tui-state';
import type { FrameInvalidationIntent } from '#/tui/features/native-layout/native-frame-policy';
import { scheduleTranscriptScrollSettleRefresh } from '#/tui/utils/render/scroll-settle-refresh';
import {
  shouldDeferTranscriptHeavyInvalidation,
  wasRecentTranscriptScroll,
} from '#/tui/utils/render/transcript-paint-mode';

/**
 * Transcript batch-mount (session hydrate) grows the tree without per-child
 * invalidate. Mid-batch frame requests remeasure every child (O(n²)) while the
 * loading overlay is already on screen — suppress them. Resume RPC / loading
 * modal updates still paint because batch mount is not active yet.
 * Callers flush once after the batch with {@link flushSuppressedTUIFrame}.
 */
export function shouldSuppressTUIFrameRequests(state: TUIState): boolean {
  return state.transcriptContainer.isBatchMounting;
}

export function invalidateTUIFrame(state: TUIState, intent: FrameInvalidationIntent): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  // During active transcript scroll, content/layout invalidations fight pure-
  // scroll paint (streaming tools, swarm, footer). Coalesce to settle refresh.
  if (
    (intent === 'content' || intent === 'layout') &&
    shouldDeferTranscriptHeavyInvalidation()
  ) {
    scheduleTranscriptScrollSettleRefresh(state);
    return;
  }
  state.renderer.invalidateFrame(intent);
}

export function requestTUIContentRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  if (shouldDeferTranscriptHeavyInvalidation()) {
    scheduleTranscriptScrollSettleRefresh(state);
    return;
  }
  state.renderer.invalidateFrame('content');
}

export function requestTUILayoutRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  if (shouldDeferTranscriptHeavyInvalidation()) {
    scheduleTranscriptScrollSettleRefresh(state);
    return;
  }
  state.renderer.invalidateFrame('layout');
}

export function requestTUIScrollRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  state.renderer.invalidateFrame('scroll');
}

export function requestTUIPaletteRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  state.renderer.invalidateFrame('palette');
}

/**
 * Transcript paint-cache drop. During scroll, skip the wipe (would re-cold
 * every visible card on the next wheel frame) and settle instead.
 */
export function requestTranscriptPaintRefresh(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  if (shouldDeferTranscriptHeavyInvalidation()) {
    scheduleTranscriptScrollSettleRefresh(state);
    return;
  }
  state.transcriptContainer.invalidatePaint();
  state.renderer.invalidateFrame('content');
}

/**
 * Geometry wipe is O(transcript) on the next resolve. During scroll storm /
 * recent pure-scroll, never wipe — schedule settle so the wheel path stays O(1).
 */
export function requestTranscriptGeometryRefresh(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  if (shouldDeferTranscriptHeavyInvalidation()) {
    scheduleTranscriptScrollSettleRefresh(state);
    return;
  }
  state.transcriptContainer.invalidateGeometryAndPaint();
  state.renderer.invalidateFrame('content');
}

/** Force one frame after a suppressed hydrate batch (bypasses isReplaying). */
export function flushSuppressedTUIFrame(
  state: TUIState,
  intent: FrameInvalidationIntent = 'layout',
): void {
  state.renderer.invalidateFrame(intent);
}
