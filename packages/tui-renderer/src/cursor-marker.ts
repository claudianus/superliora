import { ansiTextToCells } from './ansi-text';
import type { RendererCell, RendererCellStyle } from './cell-buffer';
import type { RendererRect, RendererRegionLine } from './compositor';
import { CURSOR_MARKER } from './component-primitives';
import type { RendererCursorState } from './terminal-output';

export interface RendererCursorMarkerLineProjectionOptions {
  readonly line: string;
  readonly x?: number;
  readonly y: number;
  readonly viewport?: RendererRect;
}

export interface RendererCursorMarkerLineProjectionResult {
  readonly cells: readonly RendererCell[];
  readonly cursor?: RendererCursorState;
}

export interface RendererCursorMarkerLinesProjectionOptions {
  readonly lines: readonly RendererRegionLine[];
  readonly rect?: RendererRect;
  readonly viewport?: RendererRect;
}

export interface RendererCursorMarkerLinesProjectionResult {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
}

export function projectRendererCursorMarkerLine(
  options: RendererCursorMarkerLineProjectionOptions,
): RendererCursorMarkerLineProjectionResult {
  const markerIndex = options.line.indexOf(CURSOR_MARKER);
  if (markerIndex === -1) return { cells: ansiTextToCells(options.line) };

  const cursorX = ansiTextToCells(options.line.slice(0, markerIndex)).length;
  const cleanedLine =
    options.line.slice(0, markerIndex) +
    options.line.slice(markerIndex + CURSOR_MARKER.length);
  const cells = stripRendererCursorMarkerInverseCell(ansiTextToCells(cleanedLine), cursorX);
  const x = Math.floor((options.x ?? 0) + cursorX);
  const y = Math.floor(options.y);
  const result: {
    readonly cells: readonly RendererCell[];
    cursor?: RendererCursorState;
  } = { cells };
  if (options.viewport === undefined || rendererRectContainsPoint(options.viewport, x, y)) {
    result.cursor = { x, y, visible: true };
  }
  return result;
}

export function projectRendererCursorMarkerLines(
  options: RendererCursorMarkerLinesProjectionOptions,
): RendererCursorMarkerLinesProjectionResult {
  let projected: RendererRegionLine[] | undefined;
  let cursor: RendererCursorState | undefined;

  for (let lineIndex = 0; lineIndex < options.lines.length; lineIndex++) {
    const line = options.lines[lineIndex] ?? '';
    if (typeof line !== 'string' || !line.includes(CURSOR_MARKER)) continue;

    const projection = projectRendererCursorMarkerLine({
      line,
      x: options.rect?.x ?? 0,
      y: (options.rect?.y ?? 0) + lineIndex,
      viewport: options.rect === undefined ? undefined : options.viewport,
    });
    projected ??= [...options.lines];
    projected[lineIndex] = projection.cells;
    cursor ??= projection.cursor;
  }

  const result: {
    readonly lines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = { lines: projected ?? options.lines };
  if (cursor !== undefined) result.cursor = cursor;
  return result;
}

export function stripRendererCursorMarkerInverseCell(
  cells: readonly RendererCell[],
  cursorX: number,
): readonly RendererCell[] {
  const target = cells[cursorX];
  if (target?.style?.inverse !== true) return cells;

  const out = [...cells];
  const cursorWidth = Math.max(1, target.width ?? 1);
  const end = Math.min(out.length, cursorX + cursorWidth);
  for (let index = cursorX; index < end; index++) {
    const cell = out[index];
    if (cell?.style?.inverse !== true) continue;
    out[index] = { ...cell, style: withoutInverseStyle(cell.style) };
  }
  return out;
}

function withoutInverseStyle(style: RendererCellStyle | undefined): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const { inverse: _inverse, ...rest } = style;
  return Object.values(rest).some((value) => value !== undefined) ? rest : undefined;
}

function rendererRectContainsPoint(rect: RendererRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
