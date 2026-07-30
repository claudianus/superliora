import type { RendererTextInputCursor } from './types';
import type { VisualLine } from './layout';
import { computeOffsetForLine } from './offsets';
import {
  clampInteger,
  columnAtDisplayWidth,
  findParagraphTargetLine,
  type AtomicCursorBias,
} from './selection';
import { measureDisplayWidth } from '../text-metrics';

/**
 * Pure cursor-navigation algorithms backing `RendererTextInput` vertical,
 * visual-line, paragraph, and page movement. No mutable state lives here;
 * `RendererTextInput` (text-input.ts) owns the cursor/layout fields and calls
 * into these functions with plain values.
 */

export interface NavigationMoveResult {
  readonly offset: number;
  readonly bias: AtomicCursorBias;
  readonly clearPreferred?: boolean;
  readonly preferredColumn?: number;
}

export function resolvePreferredColumn(
  lineText: string,
  cursorColumn: number,
  preferredDisplayColumn: number | undefined,
): number {
  return preferredDisplayColumn ?? measureDisplayWidth(lineText.slice(0, cursorColumn));
}

export function resolvePreferredVisualColumn(
  lineText: string,
  visualLine: VisualLine,
  cursorColumn: number,
  preferredDisplayColumn: number | undefined,
): number {
  return preferredDisplayColumn ?? measureDisplayWidth(lineText.slice(visualLine.start, cursorColumn));
}

export function computeHardLineVerticalMoveOffset(
  lines: readonly string[],
  cursor: RendererTextInputCursor,
  direction: -1 | 1,
  preferredDisplayColumn: number | undefined,
): NavigationMoveResult | undefined {
  const nextLine = cursor.line + direction;
  if (nextLine < 0 || nextLine >= lines.length) return undefined;
  const targetColumn = resolvePreferredColumn(lines[cursor.line] ?? '', cursor.column, preferredDisplayColumn);
  const offset =
    computeOffsetForLine(lines, nextLine) + columnAtDisplayWidth(lines[nextLine] ?? '', targetColumn);
  return { offset, bias: direction > 0 ? 'forward' : 'backward', preferredColumn: targetColumn };
}

export function computeVisualLineMoveOffset(
  lines: readonly string[],
  cursor: RendererTextInputCursor,
  visualLines: readonly VisualLine[],
  visualLineIndex: number,
  direction: -1 | 1,
  preferredDisplayColumn: number | undefined,
): NavigationMoveResult | undefined {
  const next = visualLines[visualLineIndex + direction];
  if (next === undefined) return undefined;
  const current = visualLines[visualLineIndex]!;
  const lineText = lines[cursor.line] ?? '';
  const targetColumn = resolvePreferredVisualColumn(lineText, current, cursor.column, preferredDisplayColumn);
  const columnInNext = columnAtDisplayWidth(next.text, targetColumn);
  const nextColumn = Math.min(next.end, next.start + columnInNext);
  return {
    offset: computeOffsetForLine(lines, next.logicalLine) + nextColumn,
    bias: direction > 0 ? 'forward' : 'backward',
    preferredColumn: targetColumn,
  };
}

export function computeParagraphMoveOffset(
  lines: readonly string[],
  cursor: RendererTextInputCursor,
  direction: -1 | 1,
  textLength: number,
  preferredDisplayColumn: number | undefined,
): NavigationMoveResult {
  const targetLine = findParagraphTargetLine(lines, cursor.line, direction);
  if (targetLine === cursor.line && direction < 0 && cursor.line === 0) {
    return { offset: 0, bias: 'forward', clearPreferred: true };
  }
  if (
    targetLine === cursor.line &&
    direction > 0 &&
    cursor.line === lines.length - 1
  ) {
    return { offset: textLength, bias: 'backward', clearPreferred: true };
  }
  const targetColumn = resolvePreferredColumn(lines[cursor.line] ?? '', cursor.column, preferredDisplayColumn);
  const offset =
    computeOffsetForLine(lines, targetLine) + columnAtDisplayWidth(lines[targetLine] ?? '', targetColumn);
  return { offset, bias: direction > 0 ? 'forward' : 'backward', preferredColumn: targetColumn };
}

export function computePageMoveOffset(
  lines: readonly string[],
  cursor: RendererTextInputCursor,
  visualLines: readonly VisualLine[],
  visualLineIndex: number,
  direction: -1 | 1,
  pageRows: number,
  layoutWidth: number | undefined,
  preferredDisplayColumn: number | undefined,
): NavigationMoveResult {
  if (layoutWidth === undefined) {
    const targetLine = clampInteger(cursor.line + direction * pageRows, 0, lines.length - 1);
    const targetColumn = resolvePreferredColumn(lines[cursor.line] ?? '', cursor.column, preferredDisplayColumn);
    const offset =
      computeOffsetForLine(lines, targetLine) + columnAtDisplayWidth(lines[targetLine] ?? '', targetColumn);
    return { offset, bias: direction > 0 ? 'forward' : 'backward', preferredColumn: targetColumn };
  }
  const targetIndex = clampInteger(visualLineIndex + direction * pageRows, 0, visualLines.length - 1);
  const current = visualLines[visualLineIndex]!;
  const target = visualLines[targetIndex]!;
  const lineText = lines[cursor.line] ?? '';
  const targetColumn = resolvePreferredVisualColumn(lineText, current, cursor.column, preferredDisplayColumn);
  const targetOffset = target.start + columnAtDisplayWidth(target.text, targetColumn);
  return {
    offset: computeOffsetForLine(lines, target.logicalLine) + Math.min(target.end, targetOffset),
    bias: direction > 0 ? 'forward' : 'backward',
    preferredColumn: targetColumn,
  };
}

export function computeMouseTextOffset(
  visualLines: readonly VisualLine[],
  viewportRow: number,
  mouseX: number,
  mouseY: number,
  lineOffset: (logicalLine: number) => number,
): number {
  const visualIndex = Math.max(0, Math.min(visualLines.length - 1, viewportRow + mouseY));
  const visualLine = visualLines[visualIndex] ?? visualLines.at(-1);
  if (visualLine === undefined || visualLine.placeholder === true) return 0;
  const column = columnAtDisplayWidth(visualLine.text, mouseX);
  return lineOffset(visualLine.logicalLine) + Math.min(visualLine.end, visualLine.start + column);
}
