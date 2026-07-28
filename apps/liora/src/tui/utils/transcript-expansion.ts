import type { TranscriptScrollAction } from '#/tui/utils/transcript-viewport';

/**
 * Scroll-reveal state machine for truncated transcript blocks.
 *
 * The transcript viewport already windows long history (virtual scroll), but
 * tool results stay hard-truncated to a few preview lines until the user
 * presses ctrl+o. Scroll reveal removes that extra step: any upward scroll
 * gesture expands every truncated block so the full output is reachable by
 * scrolling alone; returning to the tail collapses the previews again and
 * restores the ctrl+o pin semantics.
 */

export interface ScrollRevealTransitionInput {
  readonly action: TranscriptScrollAction;
  /** Whether the viewport position actually moved. */
  readonly changed: boolean;
  /** followOutput after the scroll action was applied. */
  readonly followOutput: boolean;
  /** offsetFromBottom after the scroll action was applied. */
  readonly offsetFromBottom: number;
  readonly previousReveal: boolean;
}

/**
 * Compute the next scroll-reveal flag from a transcript scroll gesture.
 *
 * - Upward gestures always reveal. This includes no-op scrolls (content fits
 *   the viewport): the wheel-up intent alone expands previews in place, so
 *   the "scroll to expand" hint stays a true promise even without overflow.
 * - `bottom` (End / jump-to-tail) always collapses.
 * - Downward gestures collapse only when already pinned to the tail; mid
 *   history they keep the current state so reading is not disrupted.
 */
export function nextScrollRevealState(input: ScrollRevealTransitionInput): boolean {
  switch (input.action) {
    case 'line-up':
    case 'page-up':
    case 'top':
      return true;
    case 'bottom':
      return false;
    case 'line-down':
    case 'page-down':
      return input.followOutput && input.offsetFromBottom === 0
        ? false
        : input.previousReveal;
    default:
      return input.previousReveal;
  }
}

/**
 * Effective expansion for transcript blocks: the ctrl+o pin OR scroll reveal.
 * Used both when syncing existing children and when mounting new components
 * mid-stream while the user is reading history.
 */
export function transcriptRevealActive(state: {
  readonly toolOutputExpanded: boolean;
  readonly scrollReveal: boolean;
}): boolean {
  return state.toolOutputExpanded || state.scrollReveal;
}
