import type { VisualLine } from './text-input-layout';
import {
  computeHardLineVerticalMoveOffset,
  computePageMoveOffset,
  computeParagraphMoveOffset,
  computeVisualLineMoveOffset,
  type NavigationMoveResult,
} from './text-input-navigation';
import type { RendererTextInputCursor } from './text-input-types';

/**
 * Vertical, visual-line, paragraph, and page cursor moves for
 * `RendererTextInput`. The class supplies layout fields and applies the
 * returned navigation deltas through `applyNavigationMove`.
 */

export interface TextInputVerticalMoveActions {
  readonly lines: readonly string[];
  readonly cursor: RendererTextInputCursor;
  readonly layoutWidth: number | undefined;
  readonly layoutHeight: number | undefined;
  readonly preferredDisplayColumn: number | undefined;
  createVisualLines(width: number): readonly VisualLine[];
  visualLineIndexForCursor(visualLines: readonly VisualLine[]): number;
  textLength(): number;
  applyNavigationMove(move: NavigationMoveResult, extend: boolean): void;
}

export function moveTextInputVertical(
  direction: -1 | 1,
  extend: boolean,
  actions: TextInputVerticalMoveActions,
): void {
  if (moveTextInputVisualLine(direction, extend, actions)) return;
  const move = computeHardLineVerticalMoveOffset(
    actions.lines,
    actions.cursor,
    direction,
    actions.preferredDisplayColumn,
  );
  if (move === undefined) return;
  actions.applyNavigationMove(move, extend);
}

export function moveTextInputVisualLine(
  direction: -1 | 1,
  extend: boolean,
  actions: TextInputVerticalMoveActions,
): boolean {
  const width = actions.layoutWidth;
  if (width === undefined || width <= 0) return false;
  const visualLines = actions.createVisualLines(width);
  if (visualLines.length === 0) return false;
  const move = computeVisualLineMoveOffset(
    actions.lines,
    actions.cursor,
    visualLines,
    actions.visualLineIndexForCursor(visualLines),
    direction,
    actions.preferredDisplayColumn,
  );
  if (move === undefined) return false;
  actions.applyNavigationMove(move, extend);
  return true;
}

export function moveTextInputParagraph(
  direction: -1 | 1,
  extend: boolean,
  actions: TextInputVerticalMoveActions,
): void {
  const move = computeParagraphMoveOffset(
    actions.lines,
    actions.cursor,
    direction,
    actions.textLength(),
    actions.preferredDisplayColumn,
  );
  actions.applyNavigationMove(move, extend);
}

export function moveTextInputPage(
  direction: -1 | 1,
  extend: boolean,
  actions: TextInputVerticalMoveActions,
): void {
  const pageRows = Math.max(1, actions.layoutHeight ?? 1);
  const width = actions.layoutWidth;
  const visualLines = width === undefined ? [] : actions.createVisualLines(width);
  const move = computePageMoveOffset(
    actions.lines,
    actions.cursor,
    visualLines,
    width === undefined ? 0 : actions.visualLineIndexForCursor(visualLines),
    direction,
    pageRows,
    width,
    actions.preferredDisplayColumn,
  );
  actions.applyNavigationMove(move, extend);
}
