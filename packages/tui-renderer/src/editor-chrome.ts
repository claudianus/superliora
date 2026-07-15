import { ansiTextToCells } from './ansi-text';
import type { RendererCell, RendererCellStyle } from './cell-buffer';
import { renderRendererDividerRow } from './component-primitives';
import type { RendererRect, RendererRegionLine } from './compositor';
import type {
  RendererEditorCursor,
  RendererEditorTextInputGeometry,
} from './editor-text-input';
import { renderRendererVerticalScrollbar } from './scrollbar';
import type { RendererCursorState } from './terminal-output';
import type { RendererTextInputRenderResult } from './text-input';
import { truncateToWidth, visibleWidth } from './text-component';
import { measureDisplayWidth, textToCells } from './text-metrics';
import { rendererDarkTheme, type RendererTheme } from './theme';

export type RendererEditorPaint = (text: string) => string;

export const RENDERER_EDITOR_PROMPT_X = 2;
export const RENDERER_EDITOR_CONTENT_X = 4;
export const RENDERER_EDITOR_CONTENT_Y = 1;
export const RENDERER_EDITOR_CONTENT_RIGHT_INSET = 2;
export const RENDERER_EDITOR_SHELL_MODE_LABEL = ' ! shell mode ';
export const RENDERER_EDITOR_CONTENT_BOTTOM_INSET = 1;
export const RENDERER_EDITOR_SCROLLBAR_TRACK = '│';
export const RENDERER_EDITOR_SCROLLBAR_THUMB = '█';
export const RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY: Readonly<
  Required<RendererEditorTextInputGeometry>
> = Object.freeze({
  contentX: RENDERER_EDITOR_CONTENT_X,
  contentY: RENDERER_EDITOR_CONTENT_Y,
  contentRightInset: RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  contentBottomInset: RENDERER_EDITOR_CONTENT_BOTTOM_INSET,
});

export interface RendererEditorSideBorderOptions {
  readonly connectedAbove?: boolean;
  readonly label?: string;
}

export interface RendererEditorFrameOptions {
  readonly width: number;
  readonly height: number;
  readonly inputLines: readonly RendererRegionLine[];
  readonly inputCursor?: RendererCursorState;
  readonly prompt?: string;
  readonly connectedAbove?: boolean;
  readonly topLabel?: string;
  readonly promptX?: number;
  readonly contentX?: number;
  readonly borderStyle?: RendererCellStyle;
  readonly promptStyle?: RendererCellStyle;
  readonly surfaceStyle?: RendererCellStyle;
  readonly scrollbarLines?: readonly string[];
  readonly scrollbarTrackStyle?: RendererCellStyle;
  readonly scrollbarThumbStyle?: RendererCellStyle;
  readonly scrollbarTrackChar?: string;
  readonly scrollbarThumbChar?: string;
  readonly omitBottomBorder?: boolean;
}

export interface RendererEditorOverlayLinesOptions {
  readonly width: number;
  readonly lines: readonly RendererRegionLine[];
  readonly borderStyle?: RendererCellStyle;
  readonly surfaceStyle?: RendererCellStyle;
  readonly textStyle?: RendererCellStyle;
  readonly contentX?: number;
}

export interface RendererEditorFrameResult {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
}

export interface RendererEditorSurfaceArgumentHintOptions
  extends RendererEditorArgumentHintOptions {
  readonly enabled?: boolean;
  readonly width?: number;
  readonly style?: RendererCellStyle;
}

export interface RendererEditorSurfaceOptions
  extends Omit<RendererEditorFrameOptions, 'height' | 'inputLines' | 'inputCursor'> {
  readonly content: RendererTextInputRenderResult;
  readonly frameRows?: number;
  readonly argumentHint?: RendererEditorSurfaceArgumentHintOptions;
  readonly overlays?: readonly RendererRegionLine[];
  readonly scrollbar?: RendererEditorSurfaceScrollbarOptions | false;
  readonly slashTokenStyle?: RendererCellStyle;
  readonly textStyle?: RendererCellStyle;
}

export interface RendererEditorSurfaceResult {
  readonly lines: readonly RendererRegionLine[];
  readonly frameLines: readonly RendererRegionLine[];
  readonly overlayLines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
}

export interface RendererEditorSurfaceCursorProjectionOptions {
  readonly surface: RendererEditorSurfaceResult;
  readonly rect: RendererRect;
  readonly viewport?: RendererRect;
}

export interface RendererEditorSurfaceStylePalette {
  readonly text: string;
  readonly textMuted: string;
  readonly textStrong: string;
  readonly border: string;
  readonly borderFocus: string;
  readonly command: string;
  readonly surfaceSunken: string;
  /** Root canvas color; used for editor fill when `canvasBackground` is enabled. */
  readonly background?: string;
  readonly selectionBg: string;
  readonly selectionText: string;
}

export interface RendererEditorSurfaceStyleOptions {
  readonly palette?: RendererEditorSurfaceStylePalette;
  readonly theme?: RendererTheme;
  readonly commandMode?: boolean;
  readonly focused?: boolean;
  readonly canvasBackground?: boolean;
}

export interface RendererEditorSurfaceStyles {
  readonly borderStyle: RendererCellStyle;
  readonly textStyle: RendererCellStyle;
  readonly promptStyle: RendererCellStyle;
  readonly surfaceStyle: RendererCellStyle;
  readonly scrollbarTrackStyle: RendererCellStyle;
  readonly scrollbarThumbStyle: RendererCellStyle;
  readonly placeholderStyle: RendererCellStyle;
  readonly selectionStyle: RendererCellStyle;
  readonly autocompleteSelectedStyle: RendererCellStyle;
  readonly autocompleteDescriptionStyle: RendererCellStyle;
  readonly autocompleteScrollStyle: RendererCellStyle;
  readonly slashTokenStyle: RendererCellStyle;
}

export interface RendererEditorSurfaceLayoutOptions {
  readonly height: number;
  readonly overlays?: readonly RendererRegionLine[];
  readonly minFrameRows?: number;
}

export interface RendererEditorSurfaceLayoutResult {
  readonly rows: number;
  readonly frameRows: number;
  readonly contentRows: number;
  readonly overlayRows: number;
  readonly overlayLines: readonly RendererRegionLine[];
}

export interface RendererEditorSurfaceScrollbarOptions {
  readonly minThumbRows?: number;
  readonly trackChar?: string;
  readonly thumbChar?: string;
}

export interface RendererEditorArgumentHintOptions {
  readonly text: string;
  readonly cursor: RendererEditorCursor;
  readonly hints: ReadonlyMap<string, string>;
}

export interface RendererEditorArgumentHintProjectionOptions
  extends RendererEditorArgumentHintOptions {
  readonly width: number;
  readonly style?: RendererCellStyle;
}

// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences.
const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const DEFAULT_EDITOR_LEFT_PADDING = 4;
// Legacy string editor output renders the end-of-input cursor as an inverse-video space.
const CURSOR_BLOCK = '\u001B[7m \u001B[0m';

export function mapRendererEditorVisibleIndexToRaw(line: string, visibleIndex: number): number {
  let visibleCount = 0;
  let rawIndex = 0;
  const re = new RegExp(ANSI_SGR.source, 'y');
  while (rawIndex < line.length && visibleCount < visibleIndex) {
    re.lastIndex = rawIndex;
    const match = re.exec(line);
    if (match !== null && match.index === rawIndex) {
      rawIndex += match[0].length;
    } else {
      visibleCount++;
      rawIndex++;
    }
  }
  return rawIndex;
}

export function stripRendererEditorSgr(text: string): string {
  return text.replace(ANSI_SGR, '');
}

export function highlightRendererEditorSlashToken(
  line: string,
  paint: RendererEditorPaint,
): string | undefined {
  const visible = stripRendererEditorSgr(line);
  const ranges = resolveRendererEditorSlashTokenRanges(visible);
  if (ranges === undefined) return undefined;
  return highlightVisibleRanges(line, ranges, paint);
}

export function projectRendererEditorSlashToken(
  lines: readonly RendererRegionLine[],
  style: RendererCellStyle,
): readonly RendererRegionLine[] {
  const first = lines[0];
  if (first === undefined || typeof first === 'string') return lines;
  const visible = first.map((cell) => cell.char).join('');
  const ranges = resolveRendererEditorSlashTokenRanges(visible);
  if (ranges === undefined) return lines;
  return [applyRendererEditorVisibleRangeStyle(first, ranges, style), ...lines.slice(1)];
}

export function injectRendererEditorArgumentHint(
  line: string,
  hint: string,
  realTextLength: number,
  width: number,
  paint: RendererEditorPaint,
  leftPadding = DEFAULT_EDITOR_LEFT_PADDING,
): string {
  const cursorIndex = line.indexOf(CURSOR_BLOCK);
  const cursorPresent = cursorIndex !== -1;
  const contentWidth = Math.max(1, width - leftPadding * 2);
  const available = contentWidth - realTextLength - (cursorPresent ? 1 : 0);
  const trimmed = truncateHint(hint, available);
  if (trimmed.length === 0) return line;

  const colored = paint(trimmed);
  const insertAt = cursorPresent
    ? cursorIndex + CURSOR_BLOCK.length
    : mapRendererEditorVisibleIndexToRaw(line, leftPadding + realTextLength);
  const trailing = line.length - insertAt;
  return line.slice(0, insertAt) + colored + ' '.repeat(Math.max(0, trailing - trimmed.length));
}

export function injectRendererEditorPromptSymbol(
  line: string,
  symbol = '>',
  paint?: RendererEditorPaint,
): string | undefined {
  if (line.length < 4) return undefined;
  for (let i = 0; i < 4; i++) {
    if (line[i] !== ' ') return undefined;
  }
  const rendered = paint ? paint(symbol) : symbol;
  return '  ' + rendered + ' ' + line.slice(4);
}

export function resolveRendererEditorArgumentHint(
  options: RendererEditorArgumentHintOptions,
): string | undefined {
  const match = /^\/(\S+)( ?)$/.exec(options.text);
  if (match === null) return undefined;
  const command = match[1];
  if (command === undefined) return undefined;
  if (options.cursor.line !== 0 || options.cursor.col !== options.text.length) {
    return undefined;
  }
  const hint = options.hints.get(command);
  if (hint === undefined) return undefined;
  return (match[2] ?? '').length > 0 ? hint : ` ${hint}`;
}

export function projectRendererEditorArgumentHint(
  lines: readonly RendererRegionLine[],
  options: RendererEditorArgumentHintProjectionOptions,
): readonly RendererRegionLine[] {
  const hint = resolveRendererEditorArgumentHint(options);
  if (hint === undefined) return lines;
  const first = lines[0];
  if (first === undefined) return lines;

  const contentWidth = normalizeEditorFrameSize(options.width);
  const available = contentWidth - rendererRegionLineWidth(first);
  const projected = truncateToWidth(hint, available, '');
  if (projected.length === 0) return lines;

  const projectedFirst = typeof first === 'string'
    ? first + projected
    : [...first, ...textToCells(projected, options.style)];
  return [projectedFirst, ...lines.slice(1)];
}

/** @deprecated Prefer {@link renderRendererEditorFrame} with `topLabel` for cell-native chrome. */
export function wrapRendererEditorSideBorders(
  lines: string[],
  paint: RendererEditorPaint,
  options: RendererEditorSideBorderOptions = {},
): string[] {
  let seenTop = false;
  return lines.map((line) => {
    const plain = stripRendererEditorSgr(line);
    if (plain.length > 0 && plain[0] === '─') {
      const isTop = !seenTop;
      const leftCorner = seenTop ? '╰' : options.connectedAbove === true ? '├' : '╭';
      const rightCorner = seenTop ? '╯' : options.connectedAbove === true ? '┤' : '╮';
      seenTop = true;
      if (plain.length === 1) return paint(leftCorner);
      const middle = plain.slice(1, -1);
      if (isTop && options.label !== undefined && /^─+$/.test(middle)) {
        const labelWidth = visibleWidth(options.label);
        if (labelWidth <= middle.length) {
          return (
            paint(leftCorner) +
            options.label +
            paint(renderRendererDividerRow({ width: middle.length - labelWidth })) +
            paint(rightCorner)
          );
        }
      }
      return paint(leftCorner + middle + rightCorner);
    }
    if (line.length === 0) return line;
    const firstChar = line[0];
    const lastChar = line.at(-1);
    const head = firstChar === ' ' ? paint('│') : (firstChar ?? '');
    const tail = line.length > 1 && lastChar === ' ' ? paint('│') : (lastChar ?? '');
    if (line.length === 1) return head;
    return head + line.slice(1, -1) + tail;
  });
}

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

  for (let row = 0; row < height - 2; row++) {
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
      inputCursor: options.inputCursor,
      hasScrollbar: scrollbarLines.length > 0,
    }),
  };
}

export function renderRendererEditorSurface(
  options: RendererEditorSurfaceOptions,
): RendererEditorSurfaceResult {
  const frameRows = normalizeEditorFrameSize(
    options.frameRows ?? options.content.lines.length + 2,
  );
  const viewportRows = Math.max(0, frameRows - 2);
  const contentX = normalizeEditorFrameCoordinate(
    options.contentX,
    RENDERER_EDITOR_CONTENT_X,
  );
  const contentWidth = normalizeEditorFrameSize(
    options.argumentHint?.width ?? options.width - contentX - 2,
  );
  const argumentHint = options.argumentHint;
  let inputLines =
    argumentHint === undefined || argumentHint.enabled === false
      ? options.content.lines
      : projectRendererEditorArgumentHint(options.content.lines, {
          text: argumentHint.text,
          cursor: argumentHint.cursor,
          hints: argumentHint.hints,
          width: contentWidth,
          style: argumentHint.style,
        });
  if (options.slashTokenStyle !== undefined && inputLines.length > 0) {
    inputLines = projectRendererEditorSlashToken(inputLines, options.slashTokenStyle);
  }
  const scrollbarLines = options.scrollbarLines ?? renderRendererEditorSurfaceScrollbar(
    options.content,
    viewportRows,
    options.scrollbar,
  );
  const scrollbarOptions =
    options.scrollbar !== false && options.scrollbar !== undefined
      ? options.scrollbar
      : undefined;
  const overlayLines = options.overlays ?? [];
  const hasOverlays = overlayLines.length > 0;
  const frame = renderRendererEditorFrame({
    ...options,
    height: frameRows,
    inputLines,
    inputCursor: options.content.cursor,
    scrollbarLines,
    scrollbarTrackChar: scrollbarOptions?.trackChar ?? options.scrollbarTrackChar,
    scrollbarThumbChar: scrollbarOptions?.thumbChar ?? options.scrollbarThumbChar,
    omitBottomBorder: hasOverlays,
  });
  const renderedOverlays = hasOverlays
    ? renderRendererEditorOverlayLines({
        width: options.width,
        lines: overlayLines,
        borderStyle: options.borderStyle,
        surfaceStyle: options.surfaceStyle,
        textStyle: options.textStyle,
      })
    : [];
  const surface: {
    readonly lines: readonly RendererRegionLine[];
    readonly frameLines: readonly RendererRegionLine[];
    readonly overlayLines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines: [...frame.lines, ...renderedOverlays],
    frameLines: frame.lines,
    overlayLines,
  };
  if (frame.cursor !== undefined) surface.cursor = frame.cursor;
  return surface;
}

export function projectRendererEditorSurfaceCursor(
  options: RendererEditorSurfaceCursorProjectionOptions,
): RendererCursorState | undefined {
  const localCursor = options.surface.cursor;
  if (localCursor === undefined || localCursor.visible === false) return undefined;

  const cursor = {
    ...localCursor,
    x: Math.floor(options.rect.x + localCursor.x),
    y: Math.floor(options.rect.y + localCursor.y),
  };
  if (options.viewport !== undefined && !rendererRectContainsPoint(options.viewport, cursor.x, cursor.y)) {
    return undefined;
  }
  return cursor;
}

export function resolveRendererEditorSurfaceStyles(
  options: RendererEditorSurfaceStyleOptions = {},
): RendererEditorSurfaceStyles {
  const palette = options.palette ?? editorSurfacePaletteFromTheme(options.theme ?? rendererDarkTheme);
  const commandMode = options.commandMode === true;
  const focused = options.focused === true;
  return {
    borderStyle: { fg: commandMode ? palette.command : focused ? palette.borderFocus : palette.border },
    textStyle: { fg: palette.text },
    promptStyle: { fg: commandMode ? palette.command : palette.textStrong, bold: true },
    surfaceStyle: options.canvasBackground === true
      ? { fg: palette.text, bg: palette.background ?? palette.surfaceSunken }
      : { fg: palette.text },
    scrollbarTrackStyle: { fg: palette.textMuted, dim: true },
    scrollbarThumbStyle: { fg: palette.textStrong },
    placeholderStyle: { fg: palette.textMuted, dim: true },
    selectionStyle: { fg: palette.selectionText, bg: palette.selectionBg },
    autocompleteSelectedStyle: { fg: palette.textStrong, bold: true },
    autocompleteDescriptionStyle: { fg: palette.textMuted, dim: true },
    autocompleteScrollStyle: { fg: palette.textMuted, dim: true },
    slashTokenStyle: { fg: palette.textStrong, bold: true },
  };
}

export function measureRendererEditorSurfaceNaturalRows(
  overlays: readonly RendererRegionLine[] = [],
  contentRows = 1,
): number {
  if (overlays.length > 0) {
    return 2 + overlays.length + 1;
  }
  const normalizedContentRows = Math.max(1, Math.floor(contentRows));
  return Math.max(3, 2 + normalizedContentRows);
}

export function measureRendererEditorSurfaceLayout(
  options: RendererEditorSurfaceLayoutOptions,
): RendererEditorSurfaceLayoutResult {
  const rows = normalizeEditorFrameSize(options.height);
  const overlays = options.overlays ?? [];
  if (overlays.length === 0) {
    const minFrameRows = Math.min(
      rows,
      normalizeEditorFrameSize(options.minFrameRows ?? 3),
    );
    const frameRows = rows === 0 ? 0 : Math.max(minFrameRows, rows);
    return {
      rows,
      frameRows,
      contentRows: Math.max(0, frameRows - 2),
      overlayRows: 0,
      overlayLines: [],
    };
  }

  const minFrameRows = Math.min(
    rows,
    normalizeEditorFrameSize(options.minFrameRows ?? 2),
  );
  const overlayBottomRows = 1;
  const overlayRows = Math.min(
    overlays.length,
    Math.max(0, rows - minFrameRows - overlayBottomRows),
  );
  const frameRows = rows === 0 ? 0 : minFrameRows;
  return {
    rows,
    frameRows,
    contentRows: Math.max(0, frameRows - 1),
    overlayRows,
    overlayLines: overlays.slice(0, overlayRows),
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

function renderRendererEditorSurfaceScrollbar(
  content: RendererTextInputRenderResult,
  viewportRows: number,
  options: RendererEditorSurfaceScrollbarOptions | false | undefined,
): readonly string[] {
  if (options === false || viewportRows <= 0) return [];
  const maxViewportRow = Math.max(0, content.contentRows - viewportRows);
  return renderRendererVerticalScrollbar({
    contentRows: content.contentRows,
    viewportRows,
    offsetFromBottom: maxViewportRow - Math.min(content.viewportRow, maxViewportRow),
    trackRows: viewportRows,
    minThumbRows: options?.minThumbRows ?? 1,
    trackChar: options?.trackChar ?? RENDERER_EDITOR_SCROLLBAR_TRACK,
    thumbChar: options?.thumbChar ?? RENDERER_EDITOR_SCROLLBAR_THUMB,
  });
}

function editorSurfacePaletteFromTheme(theme: RendererTheme): RendererEditorSurfaceStylePalette {
  return {
    text: theme.palette.text,
    textMuted: theme.palette.textMuted,
    textStrong: theme.palette.text,
    border: theme.palette.border,
    borderFocus: theme.palette.borderFocus,
    command: theme.palette.accent,
    surfaceSunken: theme.palette.surfaceMuted,
    selectionBg: theme.palette.selection,
    selectionText: theme.palette.text,
  };
}

function projectRendererEditorFrameCursor(options: {
  readonly width: number;
  readonly height: number;
  readonly contentX: number;
  readonly inputCursor: RendererCursorState | undefined;
  readonly hasScrollbar: boolean;
}): RendererCursorState | undefined {
  const cursor = options.inputCursor;
  if (cursor === undefined || cursor.visible === false) return undefined;
  const maxX = Math.max(0, options.width - (options.hasScrollbar ? 3 : 2));
  const x = Math.min(maxX, Math.floor(options.contentX + cursor.x));
  const y = Math.floor(1 + cursor.y);
  if (x < 0 || y < 0 || x >= options.width || y >= options.height) return undefined;
  return { ...cursor, x, y };
}

function rendererRectContainsPoint(rect: RendererRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function createRendererEditorBorderLine(options: {
  readonly width: number;
  readonly left: string;
  readonly right: string;
  readonly style: RendererCellStyle | undefined;
  readonly label?: string;
}): RendererCell[] {
  const width = normalizeEditorFrameSize(options.width);
  if (width <= 1) return [{ char: options.left, style: options.style }];
  const cells: RendererCell[] = [
    { char: options.left, style: options.style },
    ...Array.from({ length: Math.max(0, width - 2) }, () => ({
      char: '─',
      style: options.style,
    })),
    { char: options.right, style: options.style },
  ];
  const label = options.label;
  if (label === undefined || label.length === 0) return cells;
  const labelCells = ansiTextToCells(label);
  const maxLabelCells = Math.min(labelCells.length, Math.max(0, width - 2));
  for (let i = 0; i < maxLabelCells; i++) {
    const cell = labelCells[i];
    if (cell !== undefined) cells[1 + i] = cell;
  }
  return cells;
}

function createRendererEditorBlankLine(
  width: number,
  style: RendererCellStyle | undefined,
): RendererCell[] {
  return Array.from({ length: normalizeEditorFrameSize(width) }, () => ({ char: ' ', style }));
}

function writeRendererRegionLineCells(
  target: RendererCell[],
  x: number,
  line: RendererRegionLine | undefined,
  maxWidth: number,
  style: RendererCellStyle | undefined = undefined,
): void {
  if (line === undefined || maxWidth <= 0 || x < 0 || x >= target.length) return;
  const cells = typeof line === 'string' ? ansiTextToCells(line) : line;
  for (let i = 0; i < maxWidth; i++) {
    const cell = cells[i];
    if (cell === undefined || x + i >= target.length) break;
    target[x + i] = style === undefined
      ? cell
      : { ...cell, style: { ...style, ...cell.style } };
  }
}

function rendererRegionLinePlainText(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

function normalizeEditorFrameSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeEditorFrameCoordinate(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeEditorFrameGlyph(value: string | undefined, fallback: string): string {
  return value === undefined || value.length === 0 ? fallback : Array.from(value)[0] ?? fallback;
}

function rendererRegionLineWidth(line: RendererRegionLine): number {
  if (typeof line === 'string') return visibleWidth(line);
  return line.reduce((width, cell) => width + rendererCellWidth(cell), 0);
}

function rendererCellWidth(cell: RendererCell): number {
  if (cell.continuation === true) return 0;
  if (cell.width !== undefined) return Math.max(0, Math.floor(cell.width));
  return measureDisplayWidth(cell.char);
}

function goalCommandPathRanges(
  visible: string,
  commandEnd: number,
): Array<{ start: number; end: number }> {
  const nextRange = readTokenRange(visible, commandEnd);
  if (nextRange === null || visible.slice(nextRange.start, nextRange.end) !== 'next') {
    return [];
  }
  const ranges = [nextRange];
  const manageRange = readTokenRange(visible, nextRange.end);
  if (manageRange !== null && visible.slice(manageRange.start, manageRange.end) === 'manage') {
    ranges.push(manageRange);
  }
  return ranges;
}

function readTokenRange(
  visible: string,
  start: number,
): { start: number; end: number } | null {
  let tokenStart = start;
  while (tokenStart < visible.length && isTokenSpace(visible[tokenStart])) tokenStart++;
  if (tokenStart >= visible.length) return null;
  let tokenEnd = tokenStart;
  while (tokenEnd < visible.length && !isTokenSpace(visible[tokenEnd])) tokenEnd++;
  return { start: tokenStart, end: tokenEnd };
}

function isTokenSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function resolveRendererEditorSlashTokenRanges(
  visible: string,
): Array<{ start: number; end: number }> | undefined {
  const slashIndex = visible.indexOf('/');
  if (slashIndex < 0) return undefined;
  for (let i = 0; i < slashIndex; i++) {
    if (visible[i] !== ' ' && visible[i] !== '\t') return undefined;
  }

  let endVisible = slashIndex + 1;
  while (endVisible < visible.length) {
    const ch = visible[endVisible];
    if (ch === ' ' || ch === '\t') break;
    endVisible++;
  }

  const visibleToken = visible.slice(slashIndex, endVisible);
  if (visibleToken.slice(1).includes('/')) return undefined;
  const ranges = [{ start: slashIndex, end: endVisible }];
  if (visibleToken === '/goal') {
    ranges.push(...goalCommandPathRanges(visible, endVisible));
  }
  return ranges;
}

function applyRendererEditorVisibleRangeStyle(
  cells: readonly RendererCell[],
  ranges: Array<{ start: number; end: number }>,
  style: RendererCellStyle,
): RendererCell[] {
  const styled = cells.map((cell) => ({ ...cell }));
  let visible = 0;
  for (let i = 0; i < styled.length; i++) {
    const cell = styled[i];
    if (cell === undefined) continue;
    const width = rendererCellWidth(cell);
    const start = visible;
    const end = visible + width;
    if (ranges.some((range) => start < range.end && end > range.start)) {
      styled[i] = { ...cell, style: { ...cell.style, ...style } };
    }
    visible = end;
  }
  return styled;
}

function highlightVisibleRanges(
  line: string,
  ranges: Array<{ start: number; end: number }>,
  paint: RendererEditorPaint,
): string {
  let out = '';
  let rawCursor = 0;
  for (const range of ranges) {
    const rawStart = mapRendererEditorVisibleIndexToRaw(line, range.start);
    const rawEnd = mapRendererEditorVisibleIndexToRaw(line, range.end);
    out += line.slice(rawCursor, rawStart);
    out += paint(line.slice(rawStart, rawEnd));
    rawCursor = rawEnd;
  }
  return out + line.slice(rawCursor);
}

function truncateHint(hint: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (hint.length <= maxLen) return hint;
  if (maxLen === 1) return '…';
  return `${hint.slice(0, maxLen - 1)}…`;
}
