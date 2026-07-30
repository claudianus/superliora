import type { NativeInputMouseEvent } from '../input-events';
import {
  normalizeMouseCoordinate,
  normalizeRenderWidth,
  normalizeViewportRow,
  type VisualLine,
} from './layout';
import { computeMouseTextOffset } from './navigation';
import type { RendererTextInputMouseOptions } from './types';
import type { AtomicCursorBias } from './selection';

/**
 * Mouse press/drag/release handling for `RendererTextInput`. The class supplies
 * cursor/selection callbacks; this module resolves hit-tested offsets and
 * drives selection drags with plain values.
 */

export interface TextInputMouseActions {
  readonly textOffsetForMouse: (options: RendererTextInputMouseOptions) => number;
  readonly textOffsetForCursor: () => number;
  readonly selectionAnchor: () => number | undefined;
  moveCursorToOffset(
    offset: number,
    bias: AtomicCursorBias,
    extend: boolean,
    anchorOverride?: number,
  ): void;
  setCursorFromTextOffset(offset: number, bias: AtomicCursorBias): void;
  clearSelection(): void;
  clearPreferredDisplayColumn(): void;
  getDraggingSelectionAnchor(): number | undefined;
  setDraggingSelectionAnchor(anchor: number | undefined): void;
}

export function handleTextInputMouse(
  event: NativeInputMouseEvent,
  options: RendererTextInputMouseOptions,
  actions: TextInputMouseActions,
): boolean {
  if (event.button !== 'left' && event.button !== 'none') return false;
  if (event.action !== 'press' && event.action !== 'drag' && event.action !== 'release') return false;

  const offset = actions.textOffsetForMouse(options);
  if (event.action === 'release') {
    const draggingAnchor = actions.getDraggingSelectionAnchor();
    if (draggingAnchor === undefined) return false;
    actions.moveCursorToOffset(offset, 'nearest', true, draggingAnchor);
    actions.setDraggingSelectionAnchor(undefined);
    actions.clearPreferredDisplayColumn();
    return true;
  }

  if (event.action === 'press') {
    if (event.shift) {
      actions.moveCursorToOffset(offset, 'nearest', true);
    } else {
      actions.clearSelection();
      actions.setCursorFromTextOffset(offset, 'nearest');
    }
    actions.setDraggingSelectionAnchor(actions.selectionAnchor() ?? actions.textOffsetForCursor());
    actions.clearPreferredDisplayColumn();
    return true;
  }

  const draggingAnchor =
    actions.getDraggingSelectionAnchor() ?? actions.selectionAnchor() ?? actions.textOffsetForCursor();
  actions.setDraggingSelectionAnchor(draggingAnchor);
  actions.moveCursorToOffset(offset, 'nearest', true, draggingAnchor);
  actions.clearPreferredDisplayColumn();
  return true;
}

export function resolveTextInputMouseOffset(
  visualLines: readonly VisualLine[],
  options: RendererTextInputMouseOptions,
  layoutWidth: number | undefined,
  lineOffset: (logicalLine: number) => number,
): { readonly width: number; readonly offset: number } {
  const width = normalizeRenderWidth(options.width ?? layoutWidth ?? 1);
  const offset = computeMouseTextOffset(
    visualLines,
    normalizeViewportRow(options.viewportRow),
    normalizeMouseCoordinate(options.x),
    normalizeMouseCoordinate(options.y),
    lineOffset,
  );
  return { width, offset };
}
