import type { NativeInputMouseEvent } from '#/tui/renderer';

import { IdleStageComponent } from '../components/chrome/idle-stage';
import type { TUIState } from '../tui-state';
import type { TranscriptSelectionPoint } from './transcript-selection-model';

/** Max screen-cell movement that still counts as a short click for feeding. */
export const IDLE_FEED_MAX_MOVE = 1;

type PendingIdleFeed = {
  readonly col: number;
  readonly x: number;
  readonly y: number;
};

const pendingByState = new WeakMap<TUIState, PendingIdleFeed>();

export function isShortClickFeed(
  press: { x: number; y: number } | undefined,
  release: { x: number; y: number },
  maxMove: number,
): boolean {
  if (press === undefined) return false;
  return (
    Math.abs(release.x - press.x) <= maxMove && Math.abs(release.y - press.y) <= maxMove
  );
}

function findIdleStage(state: TUIState): IdleStageComponent | undefined {
  return state.transcriptContainer.children.find(
    (child): child is IdleStageComponent => child instanceof IdleStageComponent,
  );
}

/**
 * Track short-click feed intent over an idle stage without stealing drag-selection.
 * Returns true only when a short click was consumed as a feed drop.
 */
export function handleIdleFeedMouseInput(
  state: TUIState,
  event: NativeInputMouseEvent,
  point: TranscriptSelectionPoint,
): boolean {
  if (event.action === 'press') {
    if (findIdleStage(state) === undefined) {
      pendingByState.delete(state);
      return false;
    }
    pendingByState.set(state, { col: point.col, x: event.x, y: event.y });
    return false;
  }

  if (event.action === 'drag') {
    const pending = pendingByState.get(state);
    if (pending === undefined) return false;
    if (!isShortClickFeed(pending, event, IDLE_FEED_MAX_MOVE)) {
      pendingByState.delete(state);
    }
    return false;
  }

  if (event.action !== 'release') return false;

  const pending = pendingByState.get(state);
  pendingByState.delete(state);
  if (pending === undefined) return false;
  if (!isShortClickFeed(pending, event, IDLE_FEED_MAX_MOVE)) return false;

  const idle = findIdleStage(state);
  if (idle === undefined) return false;

  idle.tryDropFoodAtContent(pending.col);
  state.transcriptSelection.clear();
  return true;
}

export function clearIdleFeedPending(state: TUIState): void {
  pendingByState.delete(state);
}
