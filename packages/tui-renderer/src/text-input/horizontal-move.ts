import type { RendererTextInputSelectionRange } from './types';

/**
 * Pure horizontal cursor-move offsets for `RendererTextInput`: character and
 * word steps, including collapsing an active selection when not extending.
 */

export function computeMoveLeftOffset(
  selection: RendererTextInputSelectionRange | undefined,
  extend: boolean,
  cursorOffset: number,
  previousEditableOffset: (offset: number) => number,
): number {
  if (!extend && selection !== undefined) return selection.start;
  return previousEditableOffset(cursorOffset);
}

export function computeMoveRightOffset(
  selection: RendererTextInputSelectionRange | undefined,
  extend: boolean,
  cursorOffset: number,
  nextEditableOffset: (offset: number) => number,
): number {
  if (!extend && selection !== undefined) return selection.end;
  return nextEditableOffset(cursorOffset);
}

export function computeMoveWordLeftOffset(
  selection: RendererTextInputSelectionRange | undefined,
  extend: boolean,
  cursorOffset: number,
  previousWordOffset: (offset: number) => number,
): number {
  if (!extend && selection !== undefined) return selection.start;
  return previousWordOffset(cursorOffset);
}

export function computeMoveWordRightOffset(
  selection: RendererTextInputSelectionRange | undefined,
  extend: boolean,
  cursorOffset: number,
  nextWordOffset: (offset: number) => number,
): number {
  if (!extend && selection !== undefined) return selection.end;
  return nextWordOffset(cursorOffset);
}
