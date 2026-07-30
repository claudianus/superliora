import type { RendererCell, RendererCellStyle } from '../cell-buffer';
import type { RendererRegionLine } from '../compositor';
import {
  normalizeEditorFrameSize,
  rendererCellWidth,
  rendererRegionLineWidth,
} from './internal';
import type {
  RendererEditorArgumentHintOptions,
  RendererEditorArgumentHintProjectionOptions,
  RendererEditorPaint,
} from './types';
import { truncateToWidth, visibleWidth } from '../text-component';
import { textToCells } from '../text-metrics';

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
