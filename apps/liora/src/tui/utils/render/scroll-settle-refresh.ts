/**
 * After pure-scroll (especially fling), cold cards may still be placeholders.
 * Progressive content paints fill a few visible cards per frame without a hitch.
 */

import type { TUIState } from '#/tui/tui-state';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import { TRANSCRIPT_SCROLL_TIMER_HOLD_MS } from '#/tui/utils/render/transcript-paint-mode';

let settleTimer: ReturnType<typeof setTimeout> | undefined;
let progressiveTimer: ReturnType<typeof setTimeout> | undefined;
let progressivePasses = 0;

/** Max progressive fill frames after one fling (safety cap). */
const MAX_PROGRESSIVE_PASSES = 12;
/** Delay between progressive content paints (yield to input). */
const PROGRESSIVE_GAP_MS = 16;

/** Call whenever the transcript viewport offset changes from user scroll. */
export function scheduleTranscriptScrollSettleRefresh(state: TUIState): void {
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  }
  // Cancel in-flight progressive fill; a new fling supersedes it.
  if (progressiveTimer !== undefined) {
    clearTimeout(progressiveTimer);
    progressiveTimer = undefined;
  }
  progressivePasses = 0;

  // Slightly longer than chrome timer hold so deferred formats and settle share
  // one quiet window after the wheel stops — keep this short so stream resume
  // after a flick does not feel sticky.
  const delayMs = TRANSCRIPT_SCROLL_TIMER_HOLD_MS + 16;
  const timer = setTimeout(() => {
    settleTimer = undefined;
    runSettlePass(state);
  }, delayMs);
  timer.unref?.();
  settleTimer = timer;
}

function runSettlePass(state: TUIState): void {
  requestTUIContentRender(state);
  // After the paint runs, the host frame path may set needsMaterializeContinue.
  // We cannot read it synchronously here (paint is async via the render loop),
  // so schedule a short progressive chain that exits early when nothing is left.
  progressivePasses = 0;
  scheduleProgressiveFill(state);
}

function scheduleProgressiveFill(state: TUIState): void {
  if (progressiveTimer !== undefined) {
    clearTimeout(progressiveTimer);
    progressiveTimer = undefined;
  }
  if (progressivePasses >= MAX_PROGRESSIVE_PASSES) return;
  const timer = setTimeout(() => {
    progressiveTimer = undefined;
    progressivePasses += 1;
    // needsMaterializeContinue includes cold materialize + incremental present
    // budget stop (hasPendingDirty) so progressive fill finishes dirty rows.
    const needsMore =
      typeof state.transcriptContainer.needsMaterializeContinue === 'boolean'
        ? state.transcriptContainer.needsMaterializeContinue
        : typeof state.transcriptContainer.needsIncrementalPresentContinue === 'boolean'
          ? state.transcriptContainer.needsIncrementalPresentContinue
          : false;
    // Always paint at least a couple progressive frames after settle — the
    // flag is only true after a paint that used placeholders. First progressive
    // tick runs after the settle content request has had a chance to paint.
    if (progressivePasses === 1 || needsMore) {
      requestTUIContentRender(state);
      if (progressivePasses < MAX_PROGRESSIVE_PASSES) {
        scheduleProgressiveFill(state);
      }
    }
  }, PROGRESSIVE_GAP_MS);
  timer.unref?.();
  progressiveTimer = timer;
}

/** Test helper. */
export function clearTranscriptScrollSettleRefreshForTest(): void {
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  }
  if (progressiveTimer !== undefined) {
    clearTimeout(progressiveTimer);
    progressiveTimer = undefined;
  }
  progressivePasses = 0;
}
