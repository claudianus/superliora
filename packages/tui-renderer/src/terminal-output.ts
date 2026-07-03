import {
  cellsEqual,
  coalesceCellPatches,
  type RendererCellStyle,
  type RendererFrameDiff,
  type RendererRenderRun,
} from './cell-buffer';
import { splitDisplayClusters } from './text-metrics';

export const ANSI_BEGIN_SYNCHRONIZED_UPDATE = '\u001B[?2026h';
export const ANSI_END_SYNCHRONIZED_UPDATE = '\u001B[?2026l';
export const ANSI_HIDE_CURSOR = '\u001B[?25l';
export const ANSI_SHOW_CURSOR = '\u001B[?25h';
export const ANSI_RESET_STYLE = '\u001B[0m';
export const ANSI_END_HYPERLINK = '\u001B]8;;\u001B\\';
export const ANSI_ERASE_IN_LINE = '\u001B[K';

export type RendererColorMode = 'truecolor' | 'ansi256' | 'ansi16' | 'none';
export type RendererCursorShape = 'block' | 'underline' | 'bar';
export type RendererCursorMotionMode = 'absolute' | 'relative' | 'auto';

export interface RendererCursorState {
  readonly x: number;
  readonly y: number;
  readonly visible?: boolean;
  readonly shape?: RendererCursorShape;
  readonly blinking?: boolean;
}

export interface RendererTerminalOutputOptions {
  readonly synchronized?: boolean;
  readonly hideCursor?: boolean;
  readonly showCursor?: boolean;
  readonly resetStyle?: boolean;
  readonly originX?: number;
  readonly originY?: number;
  readonly cursor?: RendererCursorState;
  readonly eraseLine?: boolean;
  readonly frameWidth?: number;
  readonly colorMode?: RendererColorMode;
  readonly cursorMotion?: RendererCursorMotionMode;
  readonly previousCursor?: RendererCursorState;
}

export type RendererCursorMoveKind = 'absolute' | 'relative' | 'horizontal-absolute' | 'none';

export interface RendererCursorMotionMetrics {
  readonly absoluteMoves: number;
  readonly relativeMoves: number;
  readonly horizontalAbsoluteMoves: number;
  readonly moveBytes: number;
  readonly absoluteMoveBytes: number;
  readonly savedBytes: number;
}

export interface RendererTerminalEncodedOutput {
  readonly output: string;
  readonly cursorMotion: RendererCursorMotionMetrics;
}

interface MutableRendererCursorMotionMetrics {
  absoluteMoves: number;
  relativeMoves: number;
  horizontalAbsoluteMoves: number;
  moveBytes: number;
  absoluteMoveBytes: number;
  savedBytes: number;
}

interface RendererCursorMove {
  readonly output: string;
  readonly kind: RendererCursorMoveKind;
  readonly absoluteBytes: number;
}

const NO_CURSOR_MOVE: RendererCursorMove = { output: '', kind: 'none', absoluteBytes: 0 };

export function encodeTerminalFrame(
  diff: RendererFrameDiff,
  options: RendererTerminalOutputOptions = {},
): string {
  return encodeTerminalFrameWithMetrics(diff, options).output;
}

export function encodeTerminalFrameWithMetrics(
  diff: RendererFrameDiff,
  options: RendererTerminalOutputOptions = {},
): RendererTerminalEncodedOutput {
  return encodeTerminalRunsWithMetrics(diff.runs ?? coalesceCellPatches(diff.patches), options);
}

export function encodeTerminalRuns(
  runs: readonly RendererRenderRun[],
  options: RendererTerminalOutputOptions = {},
): string {
  return encodeTerminalRunsWithMetrics(runs, options).output;
}

export function encodeTerminalRunsWithMetrics(
  runs: readonly RendererRenderRun[],
  options: RendererTerminalOutputOptions = {},
): RendererTerminalEncodedOutput {
  if (!hasTerminalOutput(runs, options)) {
    return { output: '', cursorMotion: snapshotCursorMotionMetrics(createCursorMotionMetrics()) };
  }

  const out: string[] = [];
  const cursorMotionMetrics = createCursorMotionMetrics();
  if (options.synchronized === true) out.push(ANSI_BEGIN_SYNCHRONIZED_UPDATE);
  if (options.hideCursor === true) out.push(ANSI_HIDE_CURSOR);

  let activeStyle: RendererCellStyle | undefined;
  let activeLink: string | undefined;
  const originX = normalizeOrigin(options.originX);
  const originY = normalizeOrigin(options.originY);
  const cursorMotion = options.cursorMotion ?? 'absolute';
  let cursorX: number | undefined;
  let cursorY: number | undefined;

  for (const run of runs) {
    const targetX = originX + run.x;
    const targetY = originY + run.y;
    const cursorMove = cursorMoveTo(targetX, targetY, { x: cursorX, y: cursorY }, cursorMotion);
    recordCursorMoveMetrics(cursorMotionMetrics, cursorMove);
    out.push(cursorMove.output);
    const eraseStartIndex = resolveEraseLineStartIndex(run, options);
    const cells = eraseStartIndex === undefined ? run.cells : run.cells.slice(0, eraseStartIndex);
    for (const cell of cells) {
      if (cell.continuation === true || cell.width === 0) continue;
      const link = normalizeHyperlink(cell.link);
      if (activeLink !== link) {
        activeLink = link;
        out.push(hyperlinkToAnsi(activeLink));
      }
      if (!stylesEqual(activeStyle, cell.style)) {
        activeStyle = cell.style;
        out.push(styleToAnsi(activeStyle, { colorMode: options.colorMode }));
      }
      out.push(escapeTerminalText(cell.char));
    }
    cursorX = targetX + rendererRunCellWidth(cells);
    cursorY = targetY;
    if (eraseStartIndex !== undefined) {
      if (activeLink !== undefined) {
        activeLink = undefined;
        out.push(ANSI_END_HYPERLINK);
      }
      if (activeStyle !== undefined) {
        activeStyle = undefined;
        out.push(ANSI_RESET_STYLE);
      }
      out.push(ANSI_ERASE_IN_LINE);
    }
  }

  if (activeLink !== undefined) out.push(ANSI_END_HYPERLINK);
  if (options.resetStyle !== false && activeStyle !== undefined) out.push(ANSI_RESET_STYLE);
  if (options.cursor !== undefined) {
    const cursorOutput = cursorStateToAnsiFromPosition(
      options.cursor,
      originX,
      originY,
      cursorPositionForManagedCursor(options.previousCursor, originX, originY, cursorX, cursorY),
      cursorMotion,
    );
    recordCursorMoveMetrics(cursorMotionMetrics, cursorOutput.cursorMove);
    out.push(cursorOutput.output);
  }
  if (options.showCursor === true && options.cursor === undefined) out.push(ANSI_SHOW_CURSOR);
  if (options.synchronized === true) out.push(ANSI_END_SYNCHRONIZED_UPDATE);
  return { output: out.join(''), cursorMotion: snapshotCursorMotionMetrics(cursorMotionMetrics) };
}

export function hyperlinkToAnsi(link: string | undefined): string {
  const normalized = normalizeHyperlink(link);
  if (normalized === undefined) return ANSI_END_HYPERLINK;
  return `\u001B]8;;${normalized}\u001B\\`;
}

export function cursorTo(x: number, y: number): string {
  return `\u001B[${String(Math.max(1, Math.floor(y) + 1))};${String(
    Math.max(1, Math.floor(x) + 1),
)}H`;
}

export function cursorForward(cells: number): string {
  const count = Math.floor(cells);
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '\u001B[C' : `\u001B[${String(count)}C`;
}

export function cursorBackward(cells: number): string {
  const count = Math.floor(cells);
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '\u001B[D' : `\u001B[${String(count)}D`;
}

export function cursorDown(rows: number): string {
  const count = Math.floor(rows);
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '\u001B[B' : `\u001B[${String(count)}B`;
}

export function cursorUp(rows: number): string {
  const count = Math.floor(rows);
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '\u001B[A' : `\u001B[${String(count)}A`;
}

export function cursorHorizontalAbsolute(x: number): string {
  const column = Math.max(1, Math.floor(x) + 1);
  return column === 1 ? '\u001B[G' : `\u001B[${String(column)}G`;
}

export function cursorStateToAnsi(
  cursor: RendererCursorState,
  originX = 0,
  originY = 0,
): string {
  if (cursor.visible === false) return ANSI_HIDE_CURSOR;
  return [
    cursorShapeToAnsi(cursor.shape, cursor.blinking),
    cursorTo(originX + cursor.x, originY + cursor.y),
    ANSI_SHOW_CURSOR,
  ].join('');
}

function cursorStateToAnsiFromPosition(
  cursor: RendererCursorState,
  originX: number,
  originY: number,
  previous: { readonly x?: number; readonly y?: number },
  mode: RendererCursorMotionMode,
): { readonly output: string; readonly cursorMove: RendererCursorMove } {
  if (cursor.visible === false) {
    return { output: ANSI_HIDE_CURSOR, cursorMove: NO_CURSOR_MOVE };
  }
  const cursorMove = cursorMoveTo(originX + cursor.x, originY + cursor.y, previous, mode);
  return {
    output: [
    cursorShapeToAnsi(cursor.shape, cursor.blinking),
    cursorMove.output,
    ANSI_SHOW_CURSOR,
    ].join(''),
    cursorMove,
  };
}

export function cursorShapeToAnsi(
  shape: RendererCursorShape | undefined,
  blinking: boolean | undefined,
): string {
  if (shape === undefined) return '';
  const isBlinking = blinking !== false;
  const code = shape === 'block'
    ? isBlinking ? 1 : 2
    : shape === 'underline'
      ? isBlinking ? 3 : 4
      : isBlinking ? 5 : 6;
  return `\u001B[${String(code)} q`;
}

export function styleToAnsi(
  style: RendererCellStyle | undefined,
  options: { readonly colorMode?: RendererColorMode } = {},
): string {
  if (style === undefined) return ANSI_RESET_STYLE;

  const params = ['0'];
  if (style.bold === true) params.push('1');
  if (style.dim === true) params.push('2');
  if (style.italic === true) params.push('3');
  if (style.underline === true) params.push('4');
  if (style.inverse === true) params.push('7');

  const fg = parseHexColor(style.fg);
  const colorMode = options.colorMode ?? 'truecolor';
  if (fg !== undefined) pushColorParams(params, 'fg', fg, colorMode);
  const bg = parseHexColor(style.bg);
  if (bg !== undefined) pushColorParams(params, 'bg', bg, colorMode);

  return `\u001B[${params.join(';')}m`;
}

export function escapeTerminalText(text: string): string {
  return splitDisplayClusters(text)
    .map((cluster) => (isSafePrintableCluster(cluster.text) ? cluster.text : ' '))
    .join('');
}

function normalizeOrigin(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeFrameWidth(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function createCursorMotionMetrics(): MutableRendererCursorMotionMetrics {
  return {
    absoluteMoves: 0,
    relativeMoves: 0,
    horizontalAbsoluteMoves: 0,
    moveBytes: 0,
    absoluteMoveBytes: 0,
    savedBytes: 0,
  };
}

function snapshotCursorMotionMetrics(
  metrics: MutableRendererCursorMotionMetrics,
): RendererCursorMotionMetrics {
  return { ...metrics };
}

function recordCursorMoveMetrics(
  metrics: MutableRendererCursorMotionMetrics,
  move: RendererCursorMove,
): void {
  if (move.kind === 'none') return;
  switch (move.kind) {
    case 'absolute':
      metrics.absoluteMoves++;
      break;
    case 'relative':
      metrics.relativeMoves++;
      break;
    case 'horizontal-absolute':
      metrics.horizontalAbsoluteMoves++;
      break;
  }
  metrics.moveBytes += move.output.length;
  metrics.absoluteMoveBytes += move.absoluteBytes;
  metrics.savedBytes += Math.max(0, move.absoluteBytes - move.output.length);
}

function cursorPositionForManagedCursor(
  previousCursor: RendererCursorState | undefined,
  originX: number,
  originY: number,
  cursorX: number | undefined,
  cursorY: number | undefined,
): { readonly x?: number; readonly y?: number } {
  if (cursorX !== undefined && cursorY !== undefined) return { x: cursorX, y: cursorY };
  if (previousCursor === undefined || previousCursor.visible === false) return {};
  return {
    x: originX + previousCursor.x,
    y: originY + previousCursor.y,
  };
}

function cursorMoveTo(
  x: number,
  y: number,
  previous: { readonly x?: number; readonly y?: number },
  mode: RendererCursorMotionMode,
): RendererCursorMove {
  const absolute = cursorTo(x, y);
  const absoluteMove: RendererCursorMove = {
    output: absolute,
    kind: 'absolute',
    absoluteBytes: absolute.length,
  };
  if (mode === 'absolute') return absoluteMove;
  if (previous.x === undefined || previous.y === undefined) return absoluteMove;

  const relative = relativeCursorMoveTo(x, y, { x: previous.x, y: previous.y });
  const relativeMove = relative === undefined
    ? undefined
    : {
      output: relative,
      kind: relative.length === 0 ? 'none' : 'relative',
      absoluteBytes: absolute.length,
    } satisfies RendererCursorMove;
  if (mode === 'relative') return relativeMove ?? absoluteMove;

  const horizontalAbsolute = previous.y === y ? cursorHorizontalAbsolute(x) : undefined;
  const horizontalAbsoluteMove = horizontalAbsolute === undefined
    ? undefined
    : {
      output: horizontalAbsolute,
      kind: 'horizontal-absolute',
      absoluteBytes: absolute.length,
    } satisfies RendererCursorMove;

  const candidates = [
    absoluteMove,
    relativeMove,
    horizontalAbsoluteMove,
  ].filter((candidate): candidate is RendererCursorMove => candidate !== undefined);
  return candidates.reduce(
    (best, candidate) => candidate.output.length < best.output.length ? candidate : best,
  );
}

function relativeCursorMoveTo(
  x: number,
  y: number,
  previous: { readonly x: number; readonly y: number },
): string | undefined {
  if (previous.x === x && previous.y === y) return '';
  if (previous.y === y) {
    return x > previous.x ? cursorForward(x - previous.x) : cursorBackward(previous.x - x);
  }
  if (previous.x === x) {
    return y > previous.y ? cursorDown(y - previous.y) : cursorUp(previous.y - y);
  }
  return undefined;
}

function resolveEraseLineStartIndex(
  run: RendererRenderRun,
  options: RendererTerminalOutputOptions,
): number | undefined {
  if (options.eraseLine !== true) return undefined;

  const frameWidth = normalizeFrameWidth(options.frameWidth);
  if (frameWidth === undefined || run.x < 0 || run.x >= frameWidth) return undefined;

  const runWidth = rendererRunCellWidth(run.cells);
  if (run.x + runWidth < frameWidth) return undefined;

  let trailingBlankWidth = 0;
  let eraseStartIndex = run.cells.length;
  for (let index = run.cells.length - 1; index >= 0; index--) {
    const cell = run.cells[index]!;
    if (!isEraseLineBlankCell(cell)) break;
    trailingBlankWidth++;
    eraseStartIndex = index;
  }

  if (trailingBlankWidth <= ANSI_ERASE_IN_LINE.length) return undefined;
  return eraseStartIndex;
}

function rendererRunCellWidth(cells: readonly { readonly width?: number; readonly continuation?: boolean }[]): number {
  return cells.reduce((width, cell) => {
    if (cell.continuation === true || cell.width === 0) return width;
    return width + Math.max(1, Math.floor(cell.width ?? 1));
  }, 0);
}

function isEraseLineBlankCell(cell: {
  readonly char: string;
  readonly style?: RendererCellStyle;
  readonly link?: string;
  readonly width?: number;
  readonly continuation?: boolean;
}): boolean {
  return (
    cell.char === ' ' &&
    cell.style === undefined &&
    cell.link === undefined &&
    cell.continuation !== true &&
    (cell.width === undefined || cell.width === 1)
  );
}

function hasTerminalOutput(
  runs: readonly RendererRenderRun[],
  options: RendererTerminalOutputOptions,
): boolean {
  return (
    runs.length > 0 ||
    options.cursor !== undefined
  );
}

function stylesEqual(
  a: RendererCellStyle | undefined,
  b: RendererCellStyle | undefined,
): boolean {
  return cellsEqual({ char: 'x', style: a }, { char: 'x', style: b });
}

function normalizeHyperlink(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  const normalized = link.replaceAll(/[\u0000-\u001F\u007F]/g, '');
  return normalized.length === 0 ? undefined : normalized;
}

function isSafePrintableCluster(cluster: string): boolean {
  if (cluster.length === 0) return false;
  return Array.from(cluster).every((char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return false;
    return codePoint >= 0x20 && codePoint !== 0x7f && codePoint !== 0x1b;
  });
}

function parseHexColor(color: string | undefined): { r: number; g: number; b: number } | undefined {
  if (color === undefined) return undefined;
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: Number.parseInt(hex[0]! + hex[0]!, 16),
      g: Number.parseInt(hex[1]! + hex[1]!, 16),
      b: Number.parseInt(hex[2]! + hex[2]!, 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return undefined;
}

function pushColorParams(
  params: string[],
  target: 'fg' | 'bg',
  color: { readonly r: number; readonly g: number; readonly b: number },
  mode: RendererColorMode,
): void {
  switch (mode) {
    case 'truecolor':
      params.push(target === 'fg' ? '38' : '48', '2', String(color.r), String(color.g), String(color.b));
      return;
    case 'ansi256':
      params.push(target === 'fg' ? '38' : '48', '5', String(rgbToAnsi256(color)));
      return;
    case 'ansi16':
      params.push(String(rgbToAnsi16(color, target)));
      return;
    case 'none':
      return;
  }
}

function rgbToAnsi256(color: { readonly r: number; readonly g: number; readonly b: number }): number {
  const cubeLevels = [0, 95, 135, 175, 215, 255] as const;
  const cube = {
    r: nearestIndex(cubeLevels, color.r),
    g: nearestIndex(cubeLevels, color.g),
    b: nearestIndex(cubeLevels, color.b),
  };
  const cubeColor = {
    r: cubeLevels[cube.r]!,
    g: cubeLevels[cube.g]!,
    b: cubeLevels[cube.b]!,
  };
  const cubeIndex = 16 + 36 * cube.r + 6 * cube.g + cube.b;
  const grayIndex = Math.min(23, Math.max(0, Math.round((luma(color) - 8) / 10)));
  const grayValue = 8 + grayIndex * 10;
  const grayColor = { r: grayValue, g: grayValue, b: grayValue };
  return colorDistance(color, grayColor) < colorDistance(color, cubeColor)
    ? 232 + grayIndex
    : cubeIndex;
}

function rgbToAnsi16(
  color: { readonly r: number; readonly g: number; readonly b: number },
  target: 'fg' | 'bg',
): number {
  const palette = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ] as const;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index++) {
    const [r, g, b] = palette[index]!;
    const distance = colorDistance(color, { r, g, b });
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  if (bestIndex < 8) return (target === 'fg' ? 30 : 40) + bestIndex;
  return (target === 'fg' ? 90 : 100) + bestIndex - 8;
}

function nearestIndex(values: readonly number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index++) {
    const distance = Math.abs(values[index]! - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function luma(color: { readonly r: number; readonly g: number; readonly b: number }): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

function colorDistance(
  a: { readonly r: number; readonly g: number; readonly b: number },
  b: { readonly r: number; readonly g: number; readonly b: number },
): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}
