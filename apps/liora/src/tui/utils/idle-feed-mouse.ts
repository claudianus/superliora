import type { NativeInputMouseEvent } from '#/tui/renderer';

import { IdleStageComponent } from '../components/chrome/idle-stage';
import { CHROME_GUTTER } from '../constant/rendering';
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

/**
 * Map a transcript globalLine onto the IdleStage child that owns that row.
 * Welcome (or other) chrome above Idle must not arm / consume feed.
 */
function findIdleStageAtGlobalLine(
  state: TUIState,
  globalLine: number,
): IdleStageComponent | undefined {
  if (!Number.isFinite(globalLine) || globalLine < 0) return undefined;
  const inner = transcriptInnerWidth(state);
  let lineOffset = 0;
  for (const child of state.transcriptContainer.children) {
    const childLines = child.render(inner).length;
    const childEnd = lineOffset + childLines;
    if (globalLine >= lineOffset && globalLine < childEnd) {
      return child instanceof IdleStageComponent ? child : undefined;
    }
    lineOffset = childEnd;
  }
  return undefined;
}

function transcriptInnerWidth(state: TUIState): number {
  const columns = state.terminal.columns;
  const width = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  return Math.max(1, width - CHROME_GUTTER - CHROME_GUTTER);
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
    if (findIdleStageAtGlobalLine(state, point.globalLine) === undefined) {
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

  const idle = findIdleStageAtGlobalLine(state, point.globalLine);
  if (idle === undefined) return false;

  if (!idle.tryDropFoodAtContent(pending.col)) return false;
  state.transcriptSelection.clear();
  return true;
}

export function clearIdleFeedPending(state: TUIState): void {
  pendingByState.delete(state);
}
