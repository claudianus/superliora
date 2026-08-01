/**
 * After a pure-scroll fling, visible cards may be placeholders (cold bodies
 * were not materialised during the wheel storm). One content paint after the
 * hold fills real layouts without fighting pure-scroll frames.
 */

import type { TUIState } from '#/tui/tui-state';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import { TRANSCRIPT_SCROLL_TIMER_HOLD_MS } from '#/tui/utils/render/transcript-paint-mode';

let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Call whenever the transcript viewport offset changes from user scroll. */
export function scheduleTranscriptScrollSettleRefresh(state: TUIState): void {
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  }
  // Slightly longer than pure-scroll hold so deferred formats and settle share
  // one quiet window after the wheel stops.
  const delayMs = TRANSCRIPT_SCROLL_TIMER_HOLD_MS + 40;
  const timer = setTimeout(() => {
    settleTimer = undefined;
    requestTUIContentRender(state);
  }, delayMs);
  timer.unref?.();
  settleTimer = timer;
}

/** Test helper. */
export function clearTranscriptScrollSettleRefreshForTest(): void {
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  }
}
