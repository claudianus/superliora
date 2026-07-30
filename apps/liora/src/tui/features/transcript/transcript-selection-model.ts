import { visibleWidth, type RendererRegionLine } from '#/tui/renderer';

export interface TranscriptSelectionPoint {
  readonly globalLine: number;
  readonly col: number;
}

export interface TranscriptSelectionRange {
  readonly start: TranscriptSelectionPoint;
  readonly end: TranscriptSelectionPoint;
}

export function plainTextFromRegionLine(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

export function regionLineVisibleWidth(line: RendererRegionLine): number {
  return visibleWidth(plainTextFromRegionLine(line));
}
