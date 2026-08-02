import type { RendererCell } from '../cell-buffer/index';
import {
  createRendererEditorBlankLine,
  createRendererEditorBorderLine,
  normalizeEditorFrameCoordinate,
  normalizeEditorFrameGlyph,
  normalizeEditorFrameSize,
  projectRendererEditorFrameCursor,
  writeRendererRegionLineCells,
} from './internal';
import {
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_PROMPT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK,
  type RendererEditorFrameOptions,
  type RendererEditorFrameResult,
  type RendererEditorOverlayLinesOptions,
} from './types';
import { truncateToWidth } from '../text/component';

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
  const omitTop = options.omitTopBorder === true;
  const omitBottom = options.omitBottomBorder === true;
  const topBorderRows = omitTop ? 0 : 1;
  const bottomBorderRows = omitBottom ? 0 : 1;
  // When autocomplete overlays attach on one side, that border is deferred to
  // the overlay chrome. Content then uses height - remaining borders only —
  // e.g. frameRows=2 with omitTop (above placement) still paints the prompt.
  const contentRows = Math.max(0, height - topBorderRows - bottomBorderRows);

  if (!omitTop) {
    const topLeft = options.connectedAbove === true ? '├' : '╭';
    const topRight = options.connectedAbove === true ? '┤' : '╮';
    lines.push(createRendererEditorBorderLine({
      width,
      left: topLeft,
      right: topRight,
      style: options.borderStyle,
      label: options.topLabel,
    }));
  }

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

  if (height > 1 && !omitBottom) {
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
      contentYOffset: topBorderRows,
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
  const cap = options.cap === 'top' ? 'top' : 'bottom';
  const lines: RendererCell[][] = [];

  if (cap === 'top') {
    lines.push(createRendererEditorBorderLine({
      width,
      left: '╭',
      right: '╮',
      style: options.borderStyle,
    }));
  }

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

  if (cap === 'bottom') {
    lines.push(createRendererEditorBorderLine({
      width,
      left: '╰',
      right: '╯',
      style: options.borderStyle,
    }));
  }
  return lines;
}
