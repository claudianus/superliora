import type { RendererCell } from './cell-buffer';
import {
  createRendererEditorBlankLine,
  createRendererEditorBorderLine,
  normalizeEditorFrameCoordinate,
  normalizeEditorFrameGlyph,
  normalizeEditorFrameSize,
  projectRendererEditorFrameCursor,
  writeRendererRegionLineCells,
} from './editor-chrome-internal';
import {
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_PROMPT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK,
  type RendererEditorFrameOptions,
  type RendererEditorFrameResult,
  type RendererEditorOverlayLinesOptions,
} from './editor-chrome-types';
import { truncateToWidth } from './text-component';

export function renderRendererEditorFrame(
  options: RendererEditorFrameOptions,
): RendererEditorFrameResult {
  const width = normalizeEditorFrameSize(options.width);
  const height = normalizeEditorFrameSize(options.height);
  if (height === 0 || width === 0) return { lines: [] };

  const promptX = normalizeEditorFrameCoordinate(options.promptX, RENDERER_EDITOR_PROMPT_X);
  const contentX = normalizeEditorFrameCoordinate(
    options.contentX,
    RENDERER_EDITOR_CONTENT_X,
  );
  const scrollbarLines = options.scrollbarLines ?? [];
  const trackChar = normalizeEditorFrameGlyph(
    options.scrollbarTrackChar,
    RENDERER_EDITOR_SCROLLBAR_TRACK,
  );
  const thumbChar = normalizeEditorFrameGlyph(
    options.scrollbarThumbChar,
    RENDERER_EDITOR_SCROLLBAR_THUMB,
  );
  const lines: RendererCell[][] = [];
  const topLeft = options.connectedAbove === true ? '├' : '╭';
  const topRight = options.connectedAbove === true ? '┤' : '╮';
  lines.push(createRendererEditorBorderLine({
    width,
    left: topLeft,
    right: topRight,
    style: options.borderStyle,
    label: options.topLabel,
  }));

  // When autocomplete overlays attach below the input, the bottom border is
  // deferred to the overlay chrome. Content must then use height - 1 (top only),
  // not height - 2 — otherwise frameRows=2 paints only the top edge and the
  // prompt/`/` line vanishes the moment slash suggestions open.
  const bottomBorderRows = options.omitBottomBorder === true ? 0 : 1;
  const contentRows = Math.max(0, height - 1 - bottomBorderRows);

  for (let row = 0; row < contentRows; row++) {
    const cells = createRendererEditorBlankLine(width, options.surfaceStyle);
    cells[0] = { char: '│', style: options.borderStyle };
    cells[width - 1] = { char: '│', style: options.borderStyle };
    if (row === 0 && promptX >= 0 && promptX < width) {
      cells[promptX] = {
        char: normalizeEditorFrameGlyph(options.prompt, '>'),
        style: options.promptStyle,
      };
    }
    writeRendererRegionLineCells(
      cells,
      contentX,
      options.inputLines[row],
      width - contentX - 2,
    );
    const scrollbarGlyph = scrollbarLines[row];
    if (scrollbarGlyph !== undefined && width >= 3) {
      cells[width - 2] = {
        char: scrollbarGlyph,
        style: scrollbarGlyph === thumbChar
          ? options.scrollbarThumbStyle
          : options.scrollbarTrackStyle,
      };
    } else if (scrollbarLines.length > 0 && width >= 3) {
      cells[width - 2] = {
        char: trackChar,
        style: options.scrollbarTrackStyle,
      };
    }
    lines.push(cells);
  }

  if (height > 1 && options.omitBottomBorder !== true) {
    lines.push(createRendererEditorBorderLine({
      width,
      left: '╰',
      right: '╯',
      style: options.borderStyle,
    }));
  }

  return {
    lines,
    cursor: projectRendererEditorFrameCursor({
      width,
      height,
      contentX,
      contentRows,
      inputCursor: options.inputCursor,
      hasScrollbar: scrollbarLines.length > 0,
    }),
  };
}

export function renderRendererEditorOverlayLines(
  options: RendererEditorOverlayLinesOptions,
): readonly RendererCell[][] {
  const width = normalizeEditorFrameSize(options.width);
  if (width === 0 || options.lines.length === 0) return [];

  const contentX = normalizeEditorFrameCoordinate(
    options.contentX,
    RENDERER_EDITOR_CONTENT_X,
  );
  const contentWidth = Math.max(1, width - contentX - 1);
  const lines: RendererCell[][] = [];
  for (const line of options.lines) {
    const cells = createRendererEditorBlankLine(width, options.surfaceStyle);
    cells[0] = { char: '│', style: options.borderStyle };
    cells[width - 1] = { char: '│', style: options.borderStyle };
    if (typeof line === 'string') {
      writeRendererRegionLineCells(
        cells,
        contentX,
        truncateToWidth(line, contentWidth, ''),
        contentWidth,
        options.textStyle,
      );
    } else {
      writeRendererRegionLineCells(cells, contentX, line, contentWidth);
    }
    lines.push(cells);
  }
  lines.push(createRendererEditorBorderLine({
    width,
    left: '╰',
    right: '╯',
    style: options.borderStyle,
  }));
  return lines;
}
