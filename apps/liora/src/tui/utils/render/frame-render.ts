import type { TUIState } from '../../tui-state';
import type { FrameInvalidationIntent } from '#/tui/features/native-layout/native-frame-policy';

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
  state.renderer.invalidateFrame(intent);
}

export function requestTUIContentRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
  state.renderer.invalidateFrame('content');
}

export function requestTUILayoutRender(state: TUIState): void {
  if (shouldSuppressTUIFrameRequests(state)) return;
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

/** Force one frame after a suppressed hydrate batch (bypasses isReplaying). */
export function flushSuppressedTUIFrame(
  state: TUIState,
  intent: FrameInvalidationIntent = 'layout',
): void {
  state.renderer.invalidateFrame(intent);
}
