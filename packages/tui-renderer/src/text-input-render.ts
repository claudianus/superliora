import type { RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { RendererCursorShape } from './terminal-output';
import {
  composeGhostLine,
  computeCursorVisualPosition,
  normalizeRenderHeight,
  normalizeRenderWidth,
  renderVisualLineCells,
  type VisualLine,
} from './text-input-layout';
import type {
  RendererTextInputCursor,
  RendererTextInputRenderOptions,
  RendererTextInputRenderResult,
  RendererTextInputSelectionRange,
} from './text-input-types';

/**
 * Pure render pipeline for `RendererTextInput`: viewport slicing, cursor
 * placement, selection styling, and optional ghost-text overlay.
 */

const DEFAULT_SELECTION_STYLE: RendererCellStyle = { inverse: true };

export interface TextInputRenderContext {
  readonly visualLines: readonly VisualLine[];
  readonly cursor: RendererTextInputCursor;
  readonly currentLine: string;
  readonly selection: RendererTextInputSelectionRange | undefined;
  readonly focused: boolean;
  readonly cursorShape: RendererCursorShape;
  readonly cursorBlinking: boolean | undefined;
  readonly style: RendererCellStyle | undefined;
  readonly placeholderStyle: RendererCellStyle | undefined;
  readonly selectionStyle: RendererCellStyle | undefined;
  readonly lineOffset: (logicalLine: number) => number;
}

export function renderTextInputFrame(
  options: RendererTextInputRenderOptions,
  context: TextInputRenderContext,
): RendererTextInputRenderResult {
  const width = normalizeRenderWidth(options.width);
  const focused = options.focused ?? context.focused;
  const style = options.style ?? context.style;
  const placeholderStyle = options.placeholderStyle ?? context.placeholderStyle;
  const selectionStyle = options.selectionStyle ?? context.selectionStyle ?? DEFAULT_SELECTION_STYLE;
  const absoluteCursor = computeCursorVisualPosition(context.cursor, context.currentLine, context.visualLines);
  const height = normalizeRenderHeight(options.height);
  const viewportRow = height === undefined
    ? 0
    : Math.min(
        Math.max(0, absoluteCursor.y - height + 1),
        Math.max(0, context.visualLines.length - height),
      );
  const visibleLines =
    height === undefined
      ? context.visualLines
      : context.visualLines.slice(viewportRow, viewportRow + height);

  const cursor: {
    x: number;
    y: number;
    visible: boolean;
    shape: RendererCursorShape;
    blinking?: boolean;
  } = {
    x: absoluteCursor.x,
    y: Math.max(0, absoluteCursor.y - viewportRow),
    visible: focused,
    shape: context.cursorShape,
  };
  if (context.cursorBlinking !== undefined) cursor.blinking = context.cursorBlinking;

  const lines: RendererRegionLine[] = visibleLines.map((line) =>
    renderVisualLineCells(line, context.lineOffset(line.logicalLine), {
      style,
      placeholderStyle,
      selectionStyle,
      selection: context.selection,
    }),
  );

  const ghostText = options.ghostText;
  if (ghostText !== undefined && ghostText.length > 0 && context.selection === undefined) {
    const ghostRow = absoluteCursor.y - viewportRow;
    if (ghostRow >= 0 && ghostRow < lines.length) {
      lines[ghostRow] = composeGhostLine(
        lines[ghostRow] ?? [],
        absoluteCursor.x,
        ghostText,
        options.ghostStyle,
        width,
      );
    }
  }

  return {
    lines,
    cursor,
    contentRows: context.visualLines.length,
    viewportRow,
  };
}
