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
} from '../../controllers/layout/stage-layout';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import { stageFrameVisible, type StageFrameBand } from '#/tui/features/stage/stage-frame';
import { getTerminalProfile, hasFeature } from '#/tui/utils/terminal/terminal-capability-profile';

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

/** Minimal terminal surface needed to pop a pushed Kitty pointer shape. */
export interface ResizeMouseTerminalLike {
  write(chunk: string): unknown;
}

/** Pop the active Kitty pointer shape (if any) and forget it. */
function popPointerShape(terminal: ResizeMouseTerminalLike): void {
  if (activePointerShape === undefined) return;
  try {
    terminal.write(ANSI_POP_POINTER_SHAPE);
  } catch {
    // Never let pointer shape OSC take down the input path.
  }
  activePointerShape = undefined;
}

/**
 * Drop all stage-resize pointer state and pop any active Kitty pointer
 * shape. Call on terminal resize: the grip geometry the shape was pushed
 * for no longer matches the on-screen frame, so without this the resize
 * cursor stays stuck until the next mouse move re-evaluates hover.
 */
export function resetStageResizePointerShape(terminal: ResizeMouseTerminalLike): boolean {
  const changed = activeDrag !== undefined || hoverZone !== undefined || activePointerShape !== undefined;
  activeDrag = undefined;
  hoverZone = undefined;
  popPointerShape(terminal);
  return changed;
}

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
  if (event.type === 'focus' && !event.focused) {
    const changed = resetStageResizePointerShape(state.terminal);
    if (changed) requestTUILayoutRender(state);
    return changed;
  }
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
    const changed = resetStageResizePointerShape(state.terminal);
    if (changed) requestTUILayoutRender(state);
    return changed;
  }

  if (event.action === 'press') {
    const band = resolveStageBand(state);
    if (band === undefined || !stageFrameVisible(band, state.terminal.columns, state.terminal.rows)) {
      // Click outside the visible stage frame — clear any lingering hover
      // so the resize cursor doesn't stay stuck.
      clearHover(state);
      return false;
    }
    const zone = hitTestGrab(band, event.x, event.y);
    if (!isResizeZone(zone)) {
      // Click inside the stage area but not on a resize grip — clear any
      // lingering hover so the resize cursor doesn't stay stuck.
      clearHover(state);
      return false;
    }
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
  // However, a hover move with no button pressed while a drag is active
  // means the release event was lost (e.g. the user released the mouse
  // button outside the terminal window). Clear the stale drag state so
  // the cursor can reset instead of staying stuck in resize form.
  if (activeDrag !== undefined) {
    if (event.button === 'none') {
      activeDrag = undefined;
      // Clear hover state immediately so the cursor resets before re-evaluating
      clearHover(state);
    } else {
      return false;
    }
  }
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
  hoverZone = undefined;
  // The pointer left the grip while hovering: pop the resize cursor shape
  // right away so it never lingers over non-grip content.
  popPointerShape(state.terminal);
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
  // Only terminals known to implement OSC 22 pointer shapes may receive the
  // sequence — unsupported terminals can misparse it and print garbage.
  if (!hasFeature(getTerminalProfile(), 'pointerShapes')) return;
  if (shape === activePointerShape) return;
  if (shape === undefined || shape === 'default') {
    popPointerShape(state.terminal);
    return;
  }
  // The Kitty pointer shape protocol (OSC 22) is stack-based: each push adds
  // an entry, and each pop removes one. When switching between resize shapes
  // (e.g. ew-resize → ns-resize while moving around a corner), we must pop
  // the previous shape before pushing the new one. Otherwise the stack grows
  // and a single pop on hover-off leaves a stale shape active, leaving the
  // cursor stuck in a resize form.
  if (activePointerShape !== undefined) {
    try {
      state.terminal.write(ANSI_POP_POINTER_SHAPE);
    } catch {
      // Never let pointer shape OSC take down the input path.
    }
  }
  try {
    state.terminal.write(ansiPushPointerShape(shape));
    activePointerShape = shape;
  } catch {
    // Never let pointer shape OSC take down the input path.
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
