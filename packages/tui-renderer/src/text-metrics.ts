import type { RendererCell, RendererCellStyle } from './cell-buffer';

export interface RendererTextCluster {
  readonly text: string;
  readonly width: number;
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

const COMBINING_MARK_RE = /\p{Mark}/u;
const EMOJI_CLUSTER_RE =
  /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator})/u;

export function splitDisplayClusters(text: string): readonly RendererTextCluster[] {
  return segmentText(text).map((cluster) => ({
    text: cluster,
    width: displayClusterWidth(cluster),
  }));
}

export function measureDisplayWidth(text: string): number {
  return splitDisplayClusters(text).reduce((width, cluster) => width + cluster.width, 0);
}

export function textToCells(text: string, style?: RendererCellStyle): readonly RendererCell[] {
  const cells: RendererCell[] = [];
  for (const cluster of splitDisplayClusters(text)) {
    if (cluster.width <= 0) continue;
    if (cluster.width === 1) {
      cells.push(makeCell(cluster.text, style));
      continue;
    }
    cells.push(makeCell(cluster.text, style, 2));
    cells.push(makeCell('', style, 0, true));
  }
  return cells;
}

export function truncateDisplayText(
  text: string,
  maxWidth: number,
  ellipsis = '',
): string {
  const width = normalizeWidth(maxWidth);
  if (width <= 0) return '';
  if (measureDisplayWidth(text) <= width) return text;

  const ellipsisWidth = measureDisplayWidth(ellipsis);
  const contentWidth = ellipsisWidth >= width ? width : width - ellipsisWidth;
  let used = 0;
  const out: string[] = [];
  for (const cluster of splitDisplayClusters(text)) {
    if (cluster.width <= 0) {
      out.push(cluster.text);
      continue;
    }
    if (used + cluster.width > contentWidth) break;
    out.push(cluster.text);
    used += cluster.width;
  }
  return out.join('') + truncateEllipsis(ellipsis, width - used);
}

export function wrapDisplayText(text: string, width: number): readonly string[] {
  const maxWidth = normalizeWidth(width);
  if (maxWidth <= 0) return [''];

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const cluster of splitDisplayClusters(text)) {
    if (cluster.text === '\n') {
      lines.push(current);
      current = '';
      currentWidth = 0;
      continue;
    }
    if (cluster.width <= 0) {
      current += cluster.text;
      continue;
    }
    if (currentWidth > 0 && currentWidth + cluster.width > maxWidth) {
      lines.push(current);
      current = '';
      currentWidth = 0;
    }
    if (cluster.width > maxWidth) continue;
    current += cluster.text;
    currentWidth += cluster.width;
  }

  lines.push(current);
  return lines;
}

export function displayClusterWidth(cluster: string): number {
  if (cluster.length === 0) return 0;
  if (cluster === '\t') return 4;
  if (cluster === '\n' || cluster === '\r') return 0;
  if (isControlCluster(cluster)) return 0;
  if (isZeroWidthCluster(cluster)) return 0;
  if (EMOJI_CLUSTER_RE.test(cluster)) return 2;

  let width = 0;
  for (const char of Array.from(cluster)) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isCombiningOrFormat(char)) continue;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return Math.min(2, width);
}

function segmentText(text: string): readonly string[] {
  if (graphemeSegmenter === undefined) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}

function makeCell(
  char: string,
  style: RendererCellStyle | undefined,
  width?: number,
  continuation?: true,
): RendererCell {
  return {
    char,
    style,
    width,
    continuation,
  };
}

function truncateEllipsis(ellipsis: string, width: number): string {
  if (ellipsis.length === 0) return '';
  if (measureDisplayWidth(ellipsis) <= width) return ellipsis;
  let used = 0;
  const out: string[] = [];
  for (const cluster of splitDisplayClusters(ellipsis)) {
    if (cluster.width <= 0) continue;
    if (used + cluster.width > width) break;
    out.push(cluster.text);
    used += cluster.width;
  }
  return out.join('');
}

function normalizeWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function isControlCluster(cluster: string): boolean {
  return Array.from(cluster).every((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
}

function isZeroWidthCluster(cluster: string): boolean {
  return Array.from(cluster).every((char) => isCombiningOrFormat(char));
}

function isCombiningOrFormat(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return (
    COMBINING_MARK_RE.test(char) ||
    codePoint === 0x200d ||
    (codePoint !== undefined && codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  );
}
