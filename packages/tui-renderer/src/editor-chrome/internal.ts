import { ansiTextToCells } from '../text/ansi-text';
import type { RendererCell, RendererCellStyle } from '../cell-buffer/index';
import type { RendererRect, RendererRegionLine } from '../render/compositor';
import type { RendererCursorState } from '../terminal/output';
import { visibleWidth } from '../text/component';
import { measureDisplayWidth } from '../text/metrics';

export function normalizeEditorFrameSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeEditorFrameCoordinate(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeEditorFrameGlyph(value: string | undefined, fallback: string): string {
  return value === undefined || value.length === 0 ? fallback : Array.from(value)[0] ?? fallback;
}

export function rendererCellWidth(cell: RendererCell): number {
  if (cell.continuation === true) return 0;
  if (cell.width !== undefined) return Math.max(0, Math.floor(cell.width));
  return measureDisplayWidth(cell.char);
}

export function rendererRegionLineWidth(line: RendererRegionLine): number {
  if (typeof line === 'string') return visibleWidth(line);
  return line.reduce((width, cell) => width + rendererCellWidth(cell), 0);
}

export function createRendererEditorBorderLine(options: {
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

export function createRendererEditorBlankLine(
  width: number,
  style: RendererCellStyle | undefined,
): RendererCell[] {
  return Array.from({ length: normalizeEditorFrameSize(width) }, () => ({ char: ' ', style }));
}

export function writeRendererRegionLineCells(
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

export function rendererRectContainsPoint(rect: RendererRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function projectRendererEditorFrameCursor(options: {
  readonly width: number;
  readonly height: number;
  readonly contentX: number;
  readonly contentRows: number;
  readonly inputCursor: RendererCursorState | undefined;
  readonly hasScrollbar: boolean;
}): RendererCursorState | undefined {
  const cursor = options.inputCursor;
  if (cursor === undefined || cursor.visible === false) return undefined;
  if (options.contentRows <= 0) return undefined;
  const maxX = Math.max(0, options.width - (options.hasScrollbar ? 3 : 2));
  const x = Math.min(maxX, Math.floor(options.contentX + cursor.x));
  const y = Math.floor(1 + cursor.y);
  // Keep the caret inside painted content rows (not the deferred overlay area).
  if (x < 0 || y < 1 || y > options.contentRows || x >= options.width || y >= options.height) {
    return undefined;
  }
  return { ...cursor, x, y };
}
