import type { TUIState } from '#/tui/tui-state';
import type { FrameInvalidationIntent } from '#/tui/features/native-layout/native-frame-policy';
import { TRANSCRIPT_SCROLL_HEAVY_HOLD_MS } from '#/tui/utils/render/transcript-paint-mode';

interface PendingScrollRefresh {
  timer: NodeJS.Timeout;
  intent: FrameInvalidationIntent;
  refresh: 'none' | 'paint' | 'geometry';
}

const pendingRefreshes = new Map<TUIState, PendingScrollRefresh>();

/** Coalesce wheel-settle work without losing the invalidation that was deferred. */
export function scheduleTranscriptScrollSettleRefresh(
  state: TUIState,
  options: {
    readonly intent?: 'content' | 'layout';
    readonly refresh?: 'paint' | 'geometry';
  } = {},
): void {
  const previous = pendingRefreshes.get(state);
  if (previous !== undefined) clearTimeout(previous.timer);
  const intent = previous?.intent === 'layout' || options.intent === 'layout'
    ? 'layout'
    : 'content';
  const refresh = previous?.refresh === 'geometry' || options.refresh === 'geometry'
    ? 'geometry'
    : previous?.refresh === 'paint' || options.refresh === 'paint'
      ? 'paint'
      : 'none';
  const timer = setTimeout(() => {
    pendingRefreshes.delete(state);
    if (state.transcriptContainer.isBatchMounting) return;
    if (refresh === 'geometry') state.transcriptContainer.invalidateGeometryAndPaint();
    else if (refresh === 'paint') state.transcriptContainer.invalidatePaint();
    // The quiet window has elapsed. Re-entering the defer helpers here used to
    // discard layout/geometry intent and arm another settle instead of flushing.
    state.renderer.invalidateFrame(intent);
  }, TRANSCRIPT_SCROLL_HEAVY_HOLD_MS + 16);
  timer.unref?.();
  pendingRefreshes.set(state, { timer, intent, refresh });
}

/** True while any viewport has a pending quiet-window refresh. */
export function isTranscriptScrollSettleArmed(state?: TUIState): boolean {
  return state === undefined ? pendingRefreshes.size > 0 : pendingRefreshes.has(state);
}

/** Test helper. */
export function clearTranscriptScrollSettleRefreshForTest(): void {
  for (const pending of pendingRefreshes.values()) clearTimeout(pending.timer);
  pendingRefreshes.clear();
}
