import type { RendererCell, RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { RendererTextInputCursor, RendererTextInputSelectionRange } from './text-input-types';
import { rangesOverlap, splitClusters } from './text-input-selection';
import { measureDisplayWidth, textToCells } from './text-metrics';

/**
 * Pure render/layout algorithms backing `RendererTextInput`: soft-wrap line
 * breaking, visual-position/index lookup for the cursor, cell-style merging
 * for selection overlays, ghost-text compositing, and render-option value
 * normalization. No mutable state lives here; `RendererTextInput`
 * (text-input.ts) owns the lines/cursor/layout fields and calls into these
 * functions with plain values.
 */

export interface VisualLine {
  readonly text: string;
  readonly logicalLine: number;
  readonly start: number;
  readonly end: number;
  readonly width: number;
  readonly placeholder?: boolean;
}

export function wrapLogicalLine(
  line: string,
  logicalLine: number,
  width: number,
  placeholder: boolean,
): readonly VisualLine[] {
  if (line.length === 0) return [{ text: '', logicalLine, start: 0, end: 0, width: 0, placeholder }];

  const clusters = splitClusters(line);
  const out: VisualLine[] = [];
  let current = '';
  let currentWidth = 0;
  let start = clusters[0]?.start ?? 0;
  let end = start;

  for (const cluster of clusters) {
    if (currentWidth > 0 && currentWidth + cluster.width > width) {
      out.push({ text: current, logicalLine, start, end, width: currentWidth, placeholder });
      current = '';
      currentWidth = 0;
      start = cluster.start;
      end = cluster.start;
    }
    current += cluster.text;
    currentWidth += cluster.width;
    end = cluster.end;
  }

  out.push({ text: current, logicalLine, start, end, width: currentWidth, placeholder });
  return out;
}

export function buildVisualLines(
  lines: readonly string[],
  placeholder: string | undefined,
  width: number,
): readonly VisualLine[] {
  const isEmpty = lines.length === 1 && (lines[0]?.length ?? 0) === 0;
  if (isEmpty && placeholder !== undefined) {
    return wrapLogicalLine(placeholder, 0, width, true);
  }
  return lines.flatMap((line, index) => wrapLogicalLine(line, index, width, false));
}

export function computeCursorVisualPosition(
  cursor: RendererTextInputCursor,
  currentLineText: string,
  visualLines: readonly VisualLine[],
): { readonly x: number; readonly y: number } {
  const fallbackY = Math.max(0, visualLines.length - 1);
  for (let y = 0; y < visualLines.length; y++) {
    const visual = visualLines[y]!;
    if (visual.logicalLine !== cursor.line) continue;
    if (cursor.column < visual.start || cursor.column > visual.end) continue;
    if (
      cursor.column === visual.end &&
      y + 1 < visualLines.length &&
      visualLines[y + 1]?.logicalLine === cursor.line &&
      visualLines[y + 1]?.start === visual.end
    ) {
      continue;
    }
    return {
      x: measureDisplayWidth(currentLineText.slice(visual.start, cursor.column)),
      y,
    };
  }
  return { x: 0, y: fallbackY };
}

export function computeVisualLineIndexForCursor(
  cursor: RendererTextInputCursor,
  visualLines: readonly VisualLine[],
): number {
  for (let index = 0; index < visualLines.length; index++) {
    const visual = visualLines[index]!;
    if (visual.logicalLine !== cursor.line) continue;
    if (cursor.column < visual.start || cursor.column > visual.end) continue;
    if (
      cursor.column === visual.end &&
      index + 1 < visualLines.length &&
      visualLines[index + 1]?.logicalLine === cursor.line &&
      visualLines[index + 1]?.start === visual.end
    ) {
      continue;
    }
    return index;
  }
  return Math.max(0, visualLines.length - 1);
}

export function mergeCellStyles(
  base: RendererCellStyle | undefined,
  overlay: RendererCellStyle,
): RendererCellStyle {
  if (base === undefined) return overlay;
  return { ...base, ...overlay };
}

export function renderVisualLineCells(
  line: VisualLine,
  lineStartOffset: number,
  options: {
    readonly style: RendererCellStyle | undefined;
    readonly placeholderStyle: RendererCellStyle | undefined;
    readonly selectionStyle: RendererCellStyle;
    readonly selection: RendererTextInputSelectionRange | undefined;
  },
): RendererRegionLine {
  if (line.placeholder === true || options.selection === undefined) {
    return textToCells(line.text, line.placeholder === true ? options.placeholderStyle : options.style);
  }

  const cells: RendererCell[] = [];
  for (const cluster of splitClusters(line.text)) {
    const clusterStart = lineStartOffset + line.start + cluster.start;
    const clusterEnd = lineStartOffset + line.start + cluster.end;
    const selected = rangesOverlap(
      clusterStart,
      clusterEnd,
      options.selection.start,
      options.selection.end,
    );
    const style = selected ? mergeCellStyles(options.style, options.selectionStyle) : options.style;
    cells.push(...textToCells(cluster.text, style));
  }
  return cells;
}

/**
 * Overlay dimmed ghost cells onto the cursor's visual line starting at the
 * cursor column. Cells already typed before the cursor are preserved; the
 * ghost replaces whatever follows the cursor and is truncated so the combined
 * display width never exceeds the line `width` (wide/CJK chars stay intact).
 */
export function composeGhostLine(
  line: RendererRegionLine,
  cursorX: number,
  ghostText: string,
  ghostStyle: RendererCellStyle | undefined,
  width: number,
): RendererRegionLine {
  const available = width - cursorX;
  if (available <= 0) return line;
  const lineCells: readonly RendererCell[] =
    typeof line === 'string' ? textToCells(line, undefined) : line;
  const before: RendererCell[] = [];
  let column = 0;
  for (const cell of lineCells) {
    if (column >= cursorX) break;
    before.push(cell);
    column += cell.width ?? 1;
  }
  const ghostCells: RendererCell[] = [];
  let ghostWidth = 0;
  for (const cell of textToCells(ghostText, ghostStyle)) {
    const cellWidth = cell.width ?? 1;
    if (ghostWidth + cellWidth > available) break;
    ghostCells.push(cell);
    ghostWidth += cellWidth;
  }
  return [...before, ...ghostCells];
}

export function normalizeInputText(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  return lines.length === 0 ? [''] : lines;
}

export function normalizeMaxLength(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

export function normalizeHistoryLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function normalizeRenderWidth(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function normalizeViewportRow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function normalizeMouseCoordinate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function normalizeOptionalLayoutWidth(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

export function normalizeRenderHeight(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}
