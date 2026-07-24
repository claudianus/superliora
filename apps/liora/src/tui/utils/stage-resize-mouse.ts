import {
  hitTestPanelBorder,
  isResizeZone,
  type NativeInputEvent,
  type NativeInputMouseEvent,
  type PanelBorderZone,
  type RendererRect,
} from '#/tui/renderer';

import {
  resolveStageLayout,
  STAGE_MIN_HEIGHT,
  STAGE_MIN_WIDTH,
} from '../controllers/stage-layout';
import type { TUIState } from '../tui-state';
import { requestTUILayoutRender } from './frame-render';
import { stageFrameVisible, type StageFrameBand } from './stage-frame';

/**
 * Live corner/edge drag state. Module-level (mirrors `stage-frame.ts`) because
 * a resize gesture spans multiple discrete mouse events and the TUI input
 * router is rebuilt per dispatch.
 */
interface StageResizeDrag {
  readonly zone: PanelBorderZone;
  readonly pressX: number;
  readonly pressY: number;
  readonly startWidth: number;
  readonly startHeight: number;
}

let activeDrag: StageResizeDrag | undefined;

/** Test-only: drop any in-flight drag so cases stay isolated. */
export function resetStageResizeDragForTests(): void {
  activeDrag = undefined;
}

export function handleStageResizeMouseInput(
  state: TUIState,
  event: NativeInputEvent,
): boolean {
  if (event.type !== 'mouse') return false;
  return handleStageResizeMouseEvent(state, event);
}

function handleStageResizeMouseEvent(
  state: TUIState,
  event: NativeInputMouseEvent,
): boolean {
  if (event.button !== 'left' && event.button !== 'none') return false;
  if (event.action !== 'press' && event.action !== 'drag' && event.action !== 'release') {
    return false;
  }

  if (event.action === 'release') {
    if (activeDrag === undefined) return false;
    activeDrag = undefined;
    return true;
  }

  if (event.action === 'press') {
    const band = resolveStageBand(state);
    if (band === undefined) return false;
    if (!stageFrameVisible(band, state.terminal.columns, state.terminal.rows)) return false;
    // The visible stroke ring sits one cell outside the bundle (STAGE_FRAME_GAP),
    // so expand the band by one cell: the grab border then matches the drawn
    // frame exactly and never overlaps the transcript body inside the bundle.
    const grabRect: RendererRect = {
      x: band.x - 1,
      y: band.y - 1,
      width: band.width + 2,
      height: band.height + 2,
    };
    const zone = hitTestPanelBorder(event.x, event.y, grabRect);
    if (!isResizeZone(zone)) return false;
    activeDrag = {
      zone,
      pressX: event.x,
      pressY: event.y,
      startWidth: band.width,
      startHeight: band.height,
    };
    return true;
  }

  // action === 'drag'
  if (activeDrag === undefined) return false;
  const dx = event.x - activeDrag.pressX;
  const dy = event.y - activeDrag.pressY;
  state.userStageSize = computeNextSize(activeDrag, dx, dy, state);
  requestTUILayoutRender(state);
  return true;
}

/**
 * The band the renderer last drew, so hit-testing matches the on-screen
 * geometry (dock + workspace centering included). Falls back to a fresh
 * resolve before the first frame has cached anything.
 */
function resolveStageBand(state: TUIState): StageFrameBand | undefined {
  if (state.cachedStageBand !== undefined) return state.cachedStageBand;
  const layout = resolveStageLayout({
    width: state.terminal.columns,
    height: state.terminal.rows,
    userStageSize: state.userStageSize,
  });
  return layout.stage;
}

/**
 * Grow/shrink from the pressed edge. The stage is always centered by the
 * layout, so moving one edge by `d` cells must change the size by `2 * d`
 * (the opposite edge mirrors) to keep the center fixed in place.
 */
function computeNextSize(
  drag: StageResizeDrag,
  dx: number,
  dy: number,
  state: TUIState,
): { width: number; height: number } {
  const zone = drag.zone;
  let width = drag.startWidth;
  let height = drag.startHeight;
  if (zone.includes('right')) width = drag.startWidth + 2 * dx;
  if (zone.includes('left')) width = drag.startWidth - 2 * dx;
  if (zone.includes('bottom')) height = drag.startHeight + 2 * dy;
  if (zone.includes('top')) height = drag.startHeight - 2 * dy;

  width = clamp(width, STAGE_MIN_WIDTH, state.terminal.columns);
  height = clamp(height, STAGE_MIN_HEIGHT, state.terminal.rows);
  return { width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
