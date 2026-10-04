import type { RendererCell, RendererCellStyle } from '../cell-buffer/index';

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
  // Fast path: when every code unit is a standalone cluster (ASCII, Latin,
  // CJK, Hangul syllables, box drawing, …) grapheme segmentation is the
  // identity — skip Intl.Segmenter, which dominated frame time on non-ASCII
  // transcripts (every Korean/Japanese line took the slow path).
  if (isStandaloneClusterRun(text, 0, text.length)) {
    const clusters: RendererTextCluster[] = [];
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      clusters.push({ text: char, width: standaloneCodeUnitWidth(text.codePointAt(i) ?? 0, char) });
    }
    return clusters;
  }
  return segmentText(text).map((cluster) => ({
    text: cluster,
    width: displayClusterWidth(cluster),
  }));
}

export function measureDisplayWidth(text: string): number {
  return measureDisplayRunWidth(text, 0, text.length, 4);
}

/**
 * Display width of `text[start, end)` without allocating clusters. Tabs count
 * as `tabWidth`. Same result as summing {@link splitDisplayClusters} widths
 * (with tabs mapped to `tabWidth`).
 */
export function measureDisplayRunWidth(
  text: string,
  start: number,
  end: number,
  tabWidth: number,
): number {
  if (isStandaloneClusterRun(text, start, end)) {
    let width = 0;
    for (let i = start; i < end; i++) {
      const code = text.codePointAt(i) ?? 0;
      if (code >= 0x20 && code <= 0x7e) {
        width += 1;
      } else if (code === 0x09) {
        width += tabWidth;
      } else {
        width += standaloneCodeUnitWidth(code, text[i]!);
      }
    }
    return width;
  }
  let width = 0;
  for (const cluster of segmentText(start === 0 && end === text.length ? text : text.slice(start, end))) {
    width += cluster === '\t' ? tabWidth : displayClusterWidth(cluster);
  }
  return width;
}

/**
 * Width cache for standalone BMP code units: 0 = unknown, else width + 1.
 * `displayClusterWidth` runs two Unicode-property regexes per non-ASCII char;
 * memoizing per code point makes repeat measurement of CJK text a table read.
 */
const standaloneWidthCache = new Uint8Array(0x10000);

function standaloneCodeUnitWidth(code: number, char: string): number {
  const cached = standaloneWidthCache[code]!;
  if (cached !== 0) return cached - 1;
  const width = displayClusterWidth(char);
  standaloneWidthCache[code] = width + 1;
  return width;
}

/**
 * True when every code unit in `text[start, end)` forms its own grapheme
 * cluster regardless of neighbours. Conservative allow-list: anything that can
 * extend, join, or pair with a neighbour (combining marks, ZWJ, variation
 * selectors, Hangul jamo, surrogates, CR, Indic/Thai scripts, …) is excluded
 * and sends the run through Intl.Segmenter.
 */
function isStandaloneClusterRun(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (!isStandaloneClusterCodeUnit(text.codePointAt(i) ?? 0)) return false;
  }
  return true;
}

function isStandaloneClusterCodeUnit(code: number): boolean {
  if (code < 0x80) return code !== 0x0d;
  if (code < 0x300) return true; // Latin-1 supplement, Latin extended, IPA, modifiers
  if (code < 0x370) return false; // combining diacritics
  if (code < 0x483) return true; // Greek, Cyrillic
  if (code < 0x48a) return false; // Cyrillic combining marks
  if (code < 0x530) return true;
  if (code < 0x2000) return false; // scripts with marks: Hebrew, Arabic, Indic, Thai, jamo, …
  if (code < 0x200b) return true; // spaces
  if (code < 0x2010) return false; // ZWSP, ZWNJ, ZWJ, LRM, RLM
  if (code < 0x2028) return true;
  if (code < 0x202f) return false; // line/paragraph separators, bidi embeddings
  if (code < 0x2060) return true;
  if (code < 0x2070) return false; // word joiner, invisible operators, bidi isolates
  if (code < 0x20d0) return true; // super/subscripts, currency
  if (code < 0x2100) return false; // combining marks for symbols
  if (code < 0x2c00) return true; // arrows, math, technical, box drawing, blocks, shapes, symbols, dingbats
  if (code < 0x2e80) return false;
  if (code < 0x302a) return true; // CJK radicals, punctuation
  if (code < 0x3030) return false; // ideographic tone marks
  if (code < 0x3099) return true; // kana
  if (code < 0x309b) return false; // combining kana voiced marks
  if (code < 0xa000) return true; // kana, CJK unified ideographs
  if (code < 0xac00) return false;
  if (code < 0xd7a4) return true; // Hangul syllables (jamo that could extend them are excluded)
  if (code < 0xf900) return false; // jamo extended-B, surrogates, private use
  if (code < 0xfb00) return true; // CJK compatibility ideographs
  if (code < 0xfe10) return false; // presentation forms, variation selectors
  if (code < 0xfe20) return true; // vertical forms
  if (code < 0xfe30) return false; // combining half marks
  if (code < 0xfe50) return true; // CJK compatibility forms
  if (code < 0xff00) return false;
  if (code < 0xff9e) return true; // fullwidth / halfwidth forms
  if (code < 0xffa0) return false; // halfwidth voiced marks
  return code < 0xfff0;
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
    if (cluster.text === '\n' || cluster.text === '\r\n') {
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
  // Fast path: a single printable ASCII char is always exactly width 1, so
  // bypass the emoji/combining-mark regexes and code-point loop.
  if (cluster.length === 1) {
    const code = cluster.codePointAt(0);
    if (code !== undefined && code >= 0x20 && code <= 0x7e) return 1;
  }
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
