import {
  ansiPushPointerShape,
  ANSI_POP_POINTER_SHAPE,
  hitTestPanelBorder,
  isResizeZone,
  type KittyPointerShape,
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

/** Hover zone while the pointer rests on a resize grip (no button held). */
let hoverZone: PanelBorderZone | undefined;

/** Last Kitty pointer shape we pushed (undefined = default / popped). */
let activePointerShape: KittyPointerShape | undefined;

/** Test-only: drop any in-flight drag / hover so cases stay isolated. */
export function resetStageResizeDragForTests(): void {
  activeDrag = undefined;
  hoverZone = undefined;
  activePointerShape = undefined;
}

/** Current resize hover zone for stage-frame paint (undefined = none). */
export function getStageResizeHoverZone(): PanelBorderZone | undefined {
  return activeDrag?.zone ?? hoverZone;
}

/** True while a corner/edge drag is in progress. */
export function isStageResizeDragging(): boolean {
  return activeDrag !== undefined;
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
  // Hover moves arrive as button=none + action=move (any-event tracking 1003).
  // Drag moves keep the pressed button + action=drag (1002).
  if (event.button !== 'left' && event.button !== 'none') return false;
  if (
    event.action !== 'press' &&
    event.action !== 'drag' &&
    event.action !== 'release' &&
    event.action !== 'move'
  ) {
    return false;
  }

  if (event.action === 'move') {
    return handleHoverMove(state, event);
  }

  if (event.action === 'release') {
    if (activeDrag === undefined) return false;
    activeDrag = undefined;
    // Re-evaluate hover under the release point so the grip stays lit if
    // the pointer is still on the frame.
    updateHoverFromPoint(state, event.x, event.y);
    requestTUILayoutRender(state);
    return true;
  }

  if (event.action === 'press') {
    const band = resolveStageBand(state);
    if (band === undefined) return false;
    if (!stageFrameVisible(band, state.terminal.columns, state.terminal.rows)) return false;
    const zone = hitTestGrab(band, event.x, event.y);
    if (!isResizeZone(zone)) return false;
    activeDrag = {
      zone,
      pressX: event.x,
      pressY: event.y,
      startWidth: band.width,
      startHeight: band.height,
    };
    hoverZone = zone;
    applyPointerShape(state, pointerShapeForZone(zone));
    requestTUILayoutRender(state);
    return true;
  }

  // action === 'drag'
  if (activeDrag === undefined) return false;
  const dx = event.x - activeDrag.pressX;
  const dy = event.y - activeDrag.pressY;
  state.userStageSize = computeNextSize(activeDrag, dx, dy, state);
  // Keep pointer shape locked to the drag zone for the whole gesture.
  applyPointerShape(state, pointerShapeForZone(activeDrag.zone));
  requestTUILayoutRender(state);
  return true;
}

function handleHoverMove(state: TUIState, event: NativeInputMouseEvent): boolean {
  // While dragging, motion is delivered as 'drag' — ignore stray moves.
  if (activeDrag !== undefined) return false;
  const prev = hoverZone;
  updateHoverFromPoint(state, event.x, event.y);
  if (hoverZone === prev) {
    // Still update pointer shape if terminal lost it (rare) — cheap when equal.
    if (hoverZone !== undefined) {
      applyPointerShape(state, pointerShapeForZone(hoverZone));
    }
    return hoverZone !== undefined;
  }
  requestTUILayoutRender(state);
  return true;
}

function updateHoverFromPoint(state: TUIState, x: number, y: number): void {
  const band = resolveStageBand(state);
  if (band === undefined || !stageFrameVisible(band, state.terminal.columns, state.terminal.rows)) {
    clearHover(state);
    return;
  }
  const zone = hitTestGrab(band, x, y);
  if (!isResizeZone(zone)) {
    clearHover(state);
    return;
  }
  hoverZone = zone;
  applyPointerShape(state, pointerShapeForZone(zone));
}

function clearHover(state: TUIState): void {
  const had = hoverZone !== undefined || activePointerShape !== undefined;
  hoverZone = undefined;
  applyPointerShape(state, undefined);
  if (had) {
    // Caller decides whether to re-render; clearHover itself is silent.
  }
}

function hitTestGrab(band: StageFrameBand, x: number, y: number): PanelBorderZone {
  // The visible stroke ring sits one cell outside the bundle (STAGE_FRAME_GAP),
  // so expand the band by one cell: the grab border then matches the drawn
  // frame exactly and never overlaps the transcript body inside the bundle.
  const grabRect: RendererRect = {
    x: band.x - 1,
    y: band.y - 1,
    width: band.width + 2,
    height: band.height + 2,
  };
  const zone = hitTestPanelBorder(x, y, grabRect);
  // Panel frames treat the top edge as a title-bar drag handle. The stage
  // has no window chrome — the whole ring is a resize grip, so remap.
  if (zone === 'title-bar') return 'resize-top';
  return zone;
}

/**
 * Map a resize zone to a Kitty pointer shape. Terminals without the protocol
 * ignore the CSI; we still push it so Kitty / Ghostty / WezTerm show the grip.
 */
export function pointerShapeForZone(zone: PanelBorderZone): KittyPointerShape {
  switch (zone) {
    case 'resize-left':
    case 'resize-right':
      return 'ew-resize';
    case 'resize-top':
    case 'resize-bottom':
      return 'ns-resize';
    case 'resize-top-left':
    case 'resize-bottom-right':
      return 'nwse-resize';
    case 'resize-top-right':
    case 'resize-bottom-left':
      return 'nesw-resize';
    default:
      return 'default';
  }
}

function applyPointerShape(state: TUIState, shape: KittyPointerShape | undefined): void {
  if (shape === activePointerShape) return;
  try {
    if (shape === undefined || shape === 'default') {
      if (activePointerShape !== undefined) {
        state.terminal.write(ANSI_POP_POINTER_SHAPE);
      }
      activePointerShape = undefined;
      return;
    }
    // Push replaces the previous shape; no need to pop first.
    state.terminal.write(ansiPushPointerShape(shape));
    activePointerShape = shape;
  } catch {
    // Never let pointer CSI take down the input path.
  }
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
