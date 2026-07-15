import { visibleWidth, type RendererRegionLine } from '#/tui/renderer';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

import {
  plainTextFromRegionLine,
  type TranscriptSelectionPoint,
  type TranscriptSelectionRange,
} from './transcript-selection-model';

export type { TranscriptSelectionPoint, TranscriptSelectionRange } from './transcript-selection-model';
export { plainTextFromRegionLine } from './transcript-selection-model';

import type { TUIState } from '../tui-state';
import { requestTUILayoutRender } from './frame-render';
import { CHROME_GUTTER } from '../constant/rendering';
export class TranscriptSelectionState {
  private anchor: TranscriptSelectionPoint | undefined;
  private head: TranscriptSelectionPoint | undefined;
  private pressPoint: TranscriptSelectionPoint | undefined;
  private dragged = false;

  isDragging = false;

  get hasSelection(): boolean {
    return this.normalizedRange() !== undefined;
  }

  clear(): void {
    this.anchor = undefined;
    this.head = undefined;
    this.pressPoint = undefined;
    this.dragged = false;
    this.isDragging = false;
  }

  beginPress(point: TranscriptSelectionPoint, extend: boolean): void {
    if (extend && this.anchor !== undefined) {
      this.head = point;
    } else {
      this.anchor = point;
      this.head = point;
    }
    this.pressPoint = point;
    this.dragged = false;
    this.isDragging = true;
  }

  updateDrag(point: TranscriptSelectionPoint): void {
    if (!this.isDragging || this.anchor === undefined) return;
    this.head = point;
    if (this.pressPoint !== undefined && !pointsEqual(this.pressPoint, point)) {
      this.dragged = true;
    }
  }

  endPress(): void {
    this.isDragging = false;
    if (!this.dragged) this.clear();
    this.pressPoint = undefined;
  }

  normalizedRange(): TranscriptSelectionRange | undefined {
    if (this.anchor === undefined || this.head === undefined) return undefined;
    if (pointsEqual(this.anchor, this.head)) return undefined;
    return comparePoints(this.anchor, this.head) <= 0
      ? { start: this.anchor, end: this.head }
      : { start: this.head, end: this.anchor };
  }

  rangeForRender(): TranscriptSelectionRange | undefined {
    if (this.anchor === undefined || this.head === undefined) return undefined;
    return comparePoints(this.anchor, this.head) <= 0
      ? { start: this.anchor, end: this.head }
      : { start: this.head, end: this.anchor };
  }
}

export function createTranscriptSelectionState(): TranscriptSelectionState {
  return new TranscriptSelectionState();
}

export function shouldHoldTranscriptAnimation(options: {
  readonly followOutput: boolean;
  readonly transcriptSelection: TranscriptSelectionState;
}): boolean {
  return (
    !options.followOutput
    || options.transcriptSelection.isDragging
    || options.transcriptSelection.hasSelection
  );
}

export function regionLineVisibleLength(line: RendererRegionLine): number {
  return visibleWidth(plainTextFromRegionLine(line));
}

export function extractTranscriptSelectionPlainText(
  range: TranscriptSelectionRange,
  visibleLines: readonly RendererRegionLine[],
  viewportStart: number,
  contentLeftPad = 0,
): string {
  const parts: string[] = [];
  for (let globalLine = range.start.globalLine; globalLine <= range.end.globalLine; globalLine += 1) {
    const localRow = globalLine - viewportStart;
    const line = visibleLines[localRow];
    if (line === undefined) continue;
    const content = contentPlainTextFromRegionLine(line, contentLeftPad);
    if (globalLine === range.start.globalLine && globalLine === range.end.globalLine) {
      parts.push(sliceByVisibleColumns(content, range.start.col, range.end.col));
      continue;
    }
    if (globalLine === range.start.globalLine) {
      parts.push(sliceFromVisibleColumn(content, range.start.col));
      continue;
    }
    if (globalLine === range.end.globalLine) {
      parts.push(sliceToVisibleColumn(content, range.end.col));
      continue;
    }
    parts.push(content);
  }
  return parts.join('\n');
}

function contentPlainTextFromRegionLine(
  line: RendererRegionLine,
  contentLeftPad: number,
): string {
  return sliceFromVisibleColumn(plainTextFromRegionLine(line), contentLeftPad);
}

export function lineOverlapsSelection(
  globalLine: number,
  range: TranscriptSelectionRange,
): boolean {
  return globalLine >= range.start.globalLine && globalLine <= range.end.globalLine;
}

export function cellSelectedAtColumn(
  globalLine: number,
  cellStartCol: number,
  cellEndCol: number,
  range: TranscriptSelectionRange,
  contentLeftPad = 0,
): boolean {
  const selectionStartCol = range.start.col + contentLeftPad;
  const selectionEndCol = range.end.col + contentLeftPad;
  if (!lineOverlapsSelection(globalLine, range)) return false;
  if (globalLine === range.start.globalLine && globalLine === range.end.globalLine) {
    return cellEndCol > selectionStartCol && cellStartCol < selectionEndCol;
  }
  if (globalLine === range.start.globalLine) return cellEndCol > selectionStartCol;
  if (globalLine === range.end.globalLine) return cellStartCol < selectionEndCol;
  return cellStartCol >= contentLeftPad;
}

function comparePoints(
  left: TranscriptSelectionPoint,
  right: TranscriptSelectionPoint,
): number {
  if (left.globalLine !== right.globalLine) return left.globalLine - right.globalLine;
  return left.col - right.col;
}

function pointsEqual(left: TranscriptSelectionPoint, right: TranscriptSelectionPoint): boolean {
  return left.globalLine === right.globalLine && left.col === right.col;
}

function sliceFromVisibleColumn(text: string, col: number): string {
  if (col <= 0) return text;
  let visible = 0;
  let index = 0;
  while (index < text.length && visible < col) {
    const char = text[index]!;
    visible += visibleWidth(char);
    index += char.length;
  }
  return text.slice(index);
}

function sliceToVisibleColumn(text: string, col: number): string {
  if (col <= 0) return '';
  let visible = 0;
  let index = 0;
  while (index < text.length && visible < col) {
    const char = text[index]!;
    visible += visibleWidth(char);
    index += char.length;
  }
  return text.slice(0, index);
}

function sliceByVisibleColumns(text: string, startCol: number, endCol: number): string {
  return sliceToVisibleColumn(sliceFromVisibleColumn(text, startCol), endCol - startCol);
}

export async function copyTranscriptSelectionToClipboard(state: TUIState): Promise<boolean> {
  const range = state.transcriptSelection.normalizedRange();
  if (range === undefined) return false;
  const { resolveTranscriptHitTestContext } = await import('./transcript-hit-test');
  const context = resolveTranscriptHitTestContext(state);
  if (context === undefined) return false;
  const text = extractTranscriptSelectionPlainText(
    range,
    context.visibleLines,
    context.viewportStart,
    CHROME_GUTTER,
  );
  if (text.length === 0) return false;
  await copyTextToClipboard(text);
  state.transcriptSelection.clear();
  requestTUILayoutRender(state);
  return true;
}
