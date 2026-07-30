import { displayClusterWidth } from '../text/metrics';

/**
 * Pure text-geometry algorithms backing `RendererTextInput` cursor movement,
 * selection, and hit-testing: grapheme clustering, word/column boundary math,
 * and paragraph navigation. No mutable state lives here; `RendererTextInput`
 * (text-input.ts) owns the cursor/selection fields and calls into these
 * functions with plain values.
 */

export type AtomicCursorBias = 'backward' | 'forward' | 'nearest';

export interface TextCluster {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly width: number;
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

export function splitClusters(text: string): readonly TextCluster[] {
  if (graphemeSegmenter !== undefined) {
    return Array.from(graphemeSegmenter.segment(text), (segment) => ({
      text: segment.segment,
      start: segment.index,
      end: segment.index + segment.segment.length,
      width: displayClusterWidth(segment.segment),
    }));
  }

  const clusters: TextCluster[] = [];
  let index = 0;
  for (const char of Array.from(text)) {
    clusters.push({
      text: char,
      start: index,
      end: index + char.length,
      width: displayClusterWidth(char),
    });
    index += char.length;
  }
  return clusters;
}

export function previousClusterBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, column));
  let previous = 0;
  for (const cluster of splitClusters(text)) {
    if (cluster.end >= clamped) return cluster.start;
    previous = cluster.start;
  }
  return previous;
}

export function nextClusterBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, column));
  for (const cluster of splitClusters(text)) {
    if (cluster.end > clamped) return cluster.end;
  }
  return text.length;
}

function isWhitespaceCluster(text: string): boolean {
  return /^\s+$/u.test(text);
}

export function previousWordBoundary(text: string, offset: number): number {
  let cursor = Math.max(0, Math.min(text.length, offset));
  while (cursor > 0) {
    const previous = previousClusterBoundary(text, cursor);
    if (!isWhitespaceCluster(text.slice(previous, cursor))) break;
    cursor = previous;
  }
  while (cursor > 0) {
    const previous = previousClusterBoundary(text, cursor);
    if (isWhitespaceCluster(text.slice(previous, cursor))) break;
    cursor = previous;
  }
  return cursor;
}

export function nextWordBoundary(text: string, offset: number): number {
  let cursor = Math.max(0, Math.min(text.length, offset));
  while (cursor < text.length) {
    const next = nextClusterBoundary(text, cursor);
    if (!isWhitespaceCluster(text.slice(cursor, next))) break;
    cursor = next;
  }
  while (cursor < text.length) {
    const next = nextClusterBoundary(text, cursor);
    if (isWhitespaceCluster(text.slice(cursor, next))) break;
    cursor = next;
  }
  return cursor;
}

export function snapColumnToBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(column)));
  if (clamped === 0 || clamped === text.length) return clamped;
  let previous = 0;
  for (const cluster of splitClusters(text)) {
    if (cluster.start === clamped || cluster.end === clamped) return clamped;
    if (cluster.start > clamped) return previous;
    previous = cluster.end;
  }
  return previous;
}

export function columnAtDisplayWidth(text: string, targetWidth: number): number {
  let width = 0;
  for (const cluster of splitClusters(text)) {
    if (width + cluster.width > targetWidth) return cluster.start;
    width += cluster.width;
    if (width === targetWidth) return cluster.end;
  }
  return text.length;
}

export function snapTextOffsetToBoundary(
  text: string,
  offset: number,
  bias: AtomicCursorBias,
): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(offset)));
  if (clamped === 0 || clamped === text.length) return clamped;
  for (const cluster of splitClusters(text)) {
    if (cluster.start === clamped || cluster.end === clamped) return clamped;
    if (cluster.start < clamped && clamped < cluster.end) {
      if (bias === 'nearest') {
        return clamped - cluster.start <= cluster.end - clamped ? cluster.start : cluster.end;
      }
      return bias === 'backward' ? cluster.start : cluster.end;
    }
    if (cluster.start > clamped) return bias === 'backward' ? 0 : cluster.start;
  }
  return clamped;
}

export function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Blank-line paragraph navigation: skip empty lines, then land on the first
 * non-empty line of the next/previous block. Falls back to document edges.
 */
export function findParagraphTargetLine(
  lines: readonly string[],
  fromLine: number,
  direction: -1 | 1,
): number {
  if (lines.length === 0) return 0;
  const last = lines.length - 1;
  let line = clampInteger(fromLine, 0, last);

  const isBlank = (index: number): boolean => (lines[index] ?? '').trim().length === 0;

  if (direction < 0) {
    // Move to the start of the current paragraph, or the previous one.
    if (line > 0 && !isBlank(line) && !isBlank(line - 1)) {
      while (line > 0 && !isBlank(line - 1)) line -= 1;
      return line;
    }
    line = Math.max(0, line - 1);
    while (line > 0 && isBlank(line)) line -= 1;
    while (line > 0 && !isBlank(line - 1)) line -= 1;
    return line;
  }

  // direction > 0: jump past the current paragraph to the next non-empty block.
  if (line < last && !isBlank(line)) {
    while (line < last && !isBlank(line + 1)) line += 1;
    line = Math.min(last, line + 1);
  } else {
    line = Math.min(last, line + 1);
  }
  while (line < last && isBlank(line)) line += 1;
  return line;
}
