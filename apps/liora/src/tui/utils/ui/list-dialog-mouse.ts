/**
 * Shared mouse helpers for list dialogs (Command Hub, ChoicePicker, …).
 *
 * While a modal owns focus:
 * - wheel-up/down moves the highlight (no hit-test needed)
 * - left-click maps through center-modal geometry to a row
 */

import type { NativeInputEvent, NativeInputMouseEvent } from '#/tui/renderer';
import {
  CENTER_MODAL_MARGIN,
  centerModalContentWidth,
} from '#/tui/utils/ui/center-modal';

export type ListDialogMouseAction =
  | { readonly type: 'none' }
  | { readonly type: 'highlight'; readonly index: number }
  | { readonly type: 'activate'; readonly index: number }
  | { readonly type: 'move'; readonly delta: number };

export interface CenterListMouseLayout {
  /** Total lines returned by the last panel.render(width). */
  readonly panelLineCount: number;
  /** Preferred content width used for the last render. */
  readonly panelWidth: number;
  /**
   * For each selectable index, the 0-based line offset inside the panel body
   * where that row's primary label was painted.
   */
  readonly itemLineByIndex: readonly number[];
  /** Breadcrumb lines stacked above the panel in the overlay (0 or 1). */
  readonly crumbLines: number;
}

/**
 * Resolve mouse input for a focused center-modal list.
 * Terminal size defaults to stdout dimensions.
 */
export function resolveCenterListMouse(
  event: NativeInputEvent,
  layout: CenterListMouseLayout | undefined,
  selectedIndex: number,
  terminal: { readonly columns: number; readonly rows: number } = {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  },
): ListDialogMouseAction {
  if (event.type !== 'mouse') return { type: 'none' };
  const mouse = event;

  if (mouse.action === 'wheel') {
    if (mouse.button === 'wheel-up') return { type: 'move', delta: -1 };
    if (mouse.button === 'wheel-down') return { type: 'move', delta: 1 };
    return { type: 'none' };
  }

  if (mouse.action !== 'press' || mouse.button !== 'left') return { type: 'none' };
  if (layout === undefined || layout.itemLineByIndex.length === 0) return { type: 'none' };

  const geom = centerModalGeometry(terminal.columns, terminal.rows, layout);
  const x = mouseScreenX(mouse);
  const y = mouseScreenY(mouse);
  if (x < geom.x || x >= geom.x + geom.width) return { type: 'none' };
  if (y < geom.y || y >= geom.y + geom.height) return { type: 'none' };

  // Line inside the overlay content (breadcrumb + panel).
  const overlayLine = y - geom.y;
  if (overlayLine < layout.crumbLines) return { type: 'none' };
  const panelLine = overlayLine - layout.crumbLines;

  // Nearest item whose label line is at or above this panel line (handles desc lines).
  let hit = -1;
  for (let i = 0; i < layout.itemLineByIndex.length; i += 1) {
    const line = layout.itemLineByIndex[i]!;
    if (line <= panelLine) hit = i;
    else break;
  }
  if (hit < 0) return { type: 'none' };
  // If past the last item's following content, still count as last item only if close.
  if (hit === selectedIndex) return { type: 'activate', index: hit };
  return { type: 'highlight', index: hit };
}

function centerModalGeometry(
  terminalCols: number,
  terminalRows: number,
  layout: CenterListMouseLayout,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = Math.min(layout.panelWidth, centerModalContentWidth(terminalCols));
  const maxHeight = Math.max(4, terminalRows - CENTER_MODAL_MARGIN * 2);
  const contentLines = layout.panelLineCount + layout.crumbLines;
  const height = Math.min(contentLines, maxHeight);
  const x = Math.max(0, Math.floor((terminalCols - width) / 2));
  const y = Math.max(0, Math.floor((terminalRows - height) / 2));
  return { x, y, width, height };
}

export function mouseScreenY(event: NativeInputMouseEvent): number {
  return event.y > 0 ? event.y - 1 : event.y;
}

export function mouseScreenX(event: NativeInputMouseEvent): number {
  return event.x > 0 ? event.x - 1 : event.x;
}
