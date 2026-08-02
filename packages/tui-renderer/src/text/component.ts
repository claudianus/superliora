import { ANSI_RESET_STYLE } from '../terminal/output';
import {
  TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP,
  estimateTranscriptWrappedRowCount,
  isTranscriptMeasureMode,
  measurePlaceholderLines,
  shouldSkipExpensiveTranscriptFormat,
} from '../transcript/measure-mode';
import { measureDisplayWidth, splitDisplayClusters } from './metrics';

export interface RendererComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
  /**
   * Drop leaf paint caches only (no body rebuild, no geometry dirty, no
   * reallocation of child trees). Used when the transcript overflow cache
   * evicts an off-screen card so multi-k line arrays can leave the heap.
   * Prefer this over {@link invalidate} for eviction — full invalidate on
   * ToolCall/Assistant cards rebuilds bodies mid-paint.
   */
  softDropPaintCaches?(): void;
  /**
   * Optional windowed body: row count without materializing a full multi-k
   * `string[]`. Transcript viewport prefers this over `render(width).length`.
   */
  measureContentRows?(width: number): number;
  /**
   * Optional windowed body: paint only `[startRow, endRow)` without retaining
   * off-window line arrays. Viewport overflow path uses this so pure-scroll /
   * settle never pin full multi-k bodies for off-window rows.
   */
  paintContentRows?(width: number, startRow: number, endRow: number): string[];
}

/** True when a component can measure/paint without full multi-k line arrays. */
export function supportsWindowedBody(
  component: RendererComponent,
): component is RendererComponent & {
  measureContentRows: (width: number) => number;
  paintContentRows: (width: number, startRow: number, endRow: number) => string[];
} {
  return (
    typeof component.measureContentRows === 'function' &&
    typeof component.paintContentRows === 'function'
  );
}

export type Component = RendererComponent;

export type RendererTextBackgroundFn = (text: string) => string;

export interface RendererAnsiTextOptions {
  readonly tabWidth?: number;
}

/**
 * Bodies larger than this never pin a full wrapped `string[]` on {@link Text}
 * after windowed paint. Matches the multi-k measure/cheap threshold so geometry
 * and overflow share one working-set class.
 */
export const TEXT_WINDOWED_BODY_CHAR_CAP = TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP;

export class Text implements RendererComponent {
  private cachedText?: string;
  private cachedWidth?: number;
  private cachedLines?: string[];
  /** Row-count cache for windowed measure (never holds line strings). */
  private measuredText?: string;
  private measuredWidth?: number;
  private measuredRows?: number;
  private customBgFn?: RendererTextBackgroundFn;

  constructor(
    private text = '',
    private readonly paddingX = 1,
    private readonly paddingY = 1,
    customBgFn?: RendererTextBackgroundFn,
  ) {
    this.customBgFn = customBgFn;
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.invalidate();
  }

  setCustomBgFn(customBgFn?: RendererTextBackgroundFn): void {
    if (this.customBgFn === customBgFn) return;
    this.customBgFn = customBgFn;
    this.invalidate();
  }

  invalidate(): void {
    this.softDropPaintCaches();
  }

  softDropPaintCaches(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.measuredText = undefined;
    this.measuredWidth = undefined;
    this.measuredRows = undefined;
  }

  /**
   * Test/diagnostics: how many lines are pinned in the full paint cache.
   * Multi-k windowed bodies must stay 0 after measure/paintContentRows.
   */
  debugCachedLineCountForTest(): number {
    return this.cachedLines?.length ?? 0;
  }

  /**
   * Row count without retaining a full multi-k line array. Preferred by the
   * transcript viewport geometry path when present.
   */
  measureContentRows(width: number): number {
    const safeWidth = normalizeTextWidth(width);
    if (
      this.measuredRows !== undefined &&
      this.measuredText === this.text &&
      this.measuredWidth === safeWidth
    ) {
      return this.measuredRows;
    }
    if (
      this.cachedLines !== undefined &&
      this.cachedText === this.text &&
      this.cachedWidth === safeWidth
    ) {
      this.measuredText = this.text;
      this.measuredWidth = safeWidth;
      this.measuredRows = this.cachedLines.length;
      return this.cachedLines.length;
    }

    if (safeWidth <= 0 || this.text.length === 0 || this.text.trim() === '') {
      this.measuredText = this.text;
      this.measuredWidth = safeWidth;
      this.measuredRows = 0;
      return 0;
    }

    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const contentWidth = Math.max(1, safeWidth - paddingX * 2);

    // Geometry / pure-scroll multi-k: O(source) estimate, no line array.
    if (
      this.text.length > TEXT_WINDOWED_BODY_CHAR_CAP &&
      (isTranscriptMeasureMode() || shouldSkipExpensiveTranscriptFormat())
    ) {
      const rows = estimateTranscriptWrappedRowCount(this.text, contentWidth, paddingY);
      this.measuredText = this.text;
      this.measuredWidth = safeWidth;
      this.measuredRows = rows;
      return rows;
    }

    const normalizedText = this.text.replaceAll('\t', '   ');
    const contentRows = countAnsiDisplayWrappedRows(normalizedText, contentWidth, { tabWidth: 3 });
    const rows = contentRows + paddingY * 2;
    this.measuredText = this.text;
    this.measuredWidth = safeWidth;
    this.measuredRows = rows;
    return rows;
  }

  /**
   * Paint only `[startRow, endRow)`. Multi-k bodies never write a full-line
   * array into the component paint cache — only the returned window exists.
   */
  paintContentRows(width: number, startRow: number, endRow: number): string[] {
    const safeWidth = normalizeTextWidth(width);
    const start = Math.max(0, Math.floor(startRow));
    const end = Math.max(start, Math.floor(endRow));
    if (end <= start) return [];

    // Warm full cache (small bodies only): slice without re-wrap.
    if (
      this.cachedLines !== undefined &&
      this.cachedText === this.text &&
      this.cachedWidth === safeWidth
    ) {
      return this.cachedLines.slice(start, end);
    }

    if (safeWidth <= 0 || this.text.length === 0 || this.text.trim() === '') return [];

    // Pure-scroll multi-k: plain window only — never pin full stand-in arrays.
    if (
      shouldSkipExpensiveTranscriptFormat() &&
      this.text.length > TEXT_WINDOWED_BODY_CHAR_CAP
    ) {
      return this.paintPlainCheapWindow(safeWidth, start, end);
    }

    // Multi-k ambient/content: windowed wrap, do not pin full body on `this`.
    if (this.text.length > TEXT_WINDOWED_BODY_CHAR_CAP) {
      return this.paintWindowUncached(safeWidth, start, end);
    }

    // Small bodies: full layout + cache, then slice (legacy render path share).
    const full = this.render(safeWidth);
    return full.slice(start, end);
  }

  render(width: number): string[] {
    const safeWidth = normalizeTextWidth(width);
    if (this.cachedLines !== undefined && this.cachedText === this.text && this.cachedWidth === safeWidth) {
      return this.cachedLines;
    }

    // Geometry probes of multi-k bodies: never run full ANSI wrap. Permanent
    // freezes came from contentRowCount → child.render → wrap of every cold
    // historical message in one stack with no yield.
    if (
      isTranscriptMeasureMode() &&
      this.text.length > TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP
    ) {
      const rows = this.measureContentRows(safeWidth);
      return measurePlaceholderLines(rows);
    }

    // Pure-scroll cold paint of multi-k Text: short plain stand-in, no cache
    // pin (overflow cache + eviction owns retention). Full wrap on ambient.
    if (
      shouldSkipExpensiveTranscriptFormat() &&
      this.text.length > TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP
    ) {
      return this.renderPlainCheap(safeWidth);
    }

    // Multi-k ambient/content via legacy render(): still materializes full
    // array for callers that have not adopted paintContentRows. Prefer the
    // windowed path in the transcript viewport so this is rarely hit for tall
    // history cards. Do not leave multi-k arrays pinned on the component —
    // callers that need retention must keep their own slice.
    if (this.text.length > TEXT_WINDOWED_BODY_CHAR_CAP) {
      const result = this.renderUncached(safeWidth);
      // Intentionally do not assign cachedLines for multi-k (windowed working set).
      this.measuredText = this.text;
      this.measuredWidth = safeWidth;
      this.measuredRows = result.length;
      return result;
    }

    const result = this.renderUncached(safeWidth);
    this.cachedText = this.text;
    this.cachedWidth = safeWidth;
    this.cachedLines = result;
    this.measuredText = this.text;
    this.measuredWidth = safeWidth;
    this.measuredRows = result.length;
    return result;
  }

  private renderUncached(width: number): string[] {
    if (width <= 0 || this.text.length === 0 || this.text.trim() === '') return [];

    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const normalizedText = this.text.replaceAll('\t', '   ');
    const contentWidth = Math.max(1, width - paddingX * 2);
    const wrappedLines = wrapAnsiDisplayText(normalizedText, contentWidth, { tabWidth: 3 });
    const leftMargin = ' '.repeat(paddingX);
    const rightMargin = ' '.repeat(paddingX);
    const contentLines = wrappedLines.map((line) =>
      padAnsiDisplayLine(leftMargin + line + rightMargin, width, this.customBgFn),
    );

    const emptyLine = padAnsiDisplayLine('', width, this.customBgFn);
    const emptyLines = Array.from({ length: paddingY }, () => emptyLine);
    return [...emptyLines, ...contentLines, ...emptyLines];
  }

  private paintWindowUncached(width: number, startRow: number, endRow: number): string[] {
    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const leftMargin = ' '.repeat(paddingX);
    const rightMargin = ' '.repeat(paddingX);
    const emptyLine = padAnsiDisplayLine('', width, this.customBgFn);
    const out: string[] = [];

    // Map absolute rows → content wrap range (skip top pad).
    const contentStart = Math.max(0, startRow - paddingY);
    const contentEnd = Math.max(contentStart, endRow - paddingY);
    const normalizedText = this.text.replaceAll('\t', '   ');
    const contentSlice = wrapAnsiDisplayTextRange(
      normalizedText,
      contentWidth,
      contentStart,
      contentEnd,
      { tabWidth: 3 },
    );

    let contentCursor = 0;
    for (let row = startRow; row < endRow; row++) {
      if (row < paddingY) {
        out.push(emptyLine);
        continue;
      }
      if (contentCursor < contentSlice.length) {
        const line = contentSlice[contentCursor]!;
        contentCursor += 1;
        out.push(padAnsiDisplayLine(leftMargin + line + rightMargin, width, this.customBgFn));
        continue;
      }
      // Past content (bottom pad or short body): empty pad lines.
      out.push(emptyLine);
    }

    if (
      this.measuredRows === undefined ||
      this.measuredText !== this.text ||
      this.measuredWidth !== width
    ) {
      this.measuredText = this.text;
      this.measuredWidth = width;
      this.measuredRows = estimateTranscriptWrappedRowCount(this.text, contentWidth, paddingY);
    }
    return out;
  }

  /** Pure-scroll multi-k stand-in: simple char wrap, hard cap on materialised rows. */
  private renderPlainCheap(width: number): string[] {
    if (width <= 0 || this.text.length === 0 || this.text.trim() === '') return [];
    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const leftMargin = ' '.repeat(paddingX);
    const rightMargin = ' '.repeat(paddingX);
    const emptyLine = padAnsiDisplayLine('', width, this.customBgFn);
    const out: string[] = Array.from({ length: paddingY }, () => emptyLine);
    // Keep short: component-level stand-ins must not pin multi-k heaps.
    const MAX_PLAIN_LINES = 240;
    let produced = 0;
    for (const raw of this.text.replaceAll('\t', '   ').split('\n')) {
      if (produced >= MAX_PLAIN_LINES) break;
      if (raw.length === 0) {
        out.push(padAnsiDisplayLine(leftMargin + rightMargin, width, this.customBgFn));
        produced += 1;
        continue;
      }
      let offset = 0;
      while (offset < raw.length && produced < MAX_PLAIN_LINES) {
        const chunk = raw.slice(offset, offset + contentWidth);
        out.push(padAnsiDisplayLine(leftMargin + chunk + rightMargin, width, this.customBgFn));
        offset += contentWidth;
        produced += 1;
      }
    }
    for (let i = 0; i < paddingY; i++) out.push(emptyLine);
    return out;
  }

  /** Visible window of the plain cheap stand-in — O(window), no multi-k pin. */
  private paintPlainCheapWindow(width: number, startRow: number, endRow: number): string[] {
    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const leftMargin = ' '.repeat(paddingX);
    const rightMargin = ' '.repeat(paddingX);
    const emptyLine = padAnsiDisplayLine('', width, this.customBgFn);
    const out: string[] = [];
    const MAX_PLAIN_LINES = 240;

    // Walk plain rows; emit only those in [startRow, endRow).
    let row = 0;
    const emit = (line: string): boolean => {
      if (row >= endRow) return false;
      if (row >= startRow) out.push(line);
      row += 1;
      return row < endRow;
    };

    for (let p = 0; p < paddingY; p++) {
      if (!emit(emptyLine)) return out;
    }

    let produced = 0;
    for (const raw of this.text.replaceAll('\t', '   ').split('\n')) {
      if (produced >= MAX_PLAIN_LINES) break;
      if (raw.length === 0) {
        produced += 1;
        if (!emit(padAnsiDisplayLine(leftMargin + rightMargin, width, this.customBgFn))) return out;
        continue;
      }
      let offset = 0;
      while (offset < raw.length && produced < MAX_PLAIN_LINES) {
        const chunk = raw.slice(offset, offset + contentWidth);
        produced += 1;
        if (!emit(padAnsiDisplayLine(leftMargin + chunk + rightMargin, width, this.customBgFn))) {
          return out;
        }
        offset += contentWidth;
      }
    }
    for (let p = 0; p < paddingY && row < endRow; p++) {
      if (!emit(emptyLine)) return out;
    }
    // If start is past the short stand-in, pad with empties so slice length matches.
    while (row < startRow && row < endRow) {
      row += 1;
    }
    while (out.length < endRow - startRow) {
      out.push(emptyLine);
    }
    return out;
  }
}

export function measureAnsiDisplayWidth(
  text: string,
  options: RendererAnsiTextOptions = {},
): number {
  let width = 0;
  for (const segment of scanAnsiText(text, normalizeTabWidth(options.tabWidth))) {
    if (segment.kind === 'text') width += segment.width;
  }
  return width;
}

export function visibleWidth(text: string): number {
  return measureAnsiDisplayWidth(text, { tabWidth: 3 });
}

export function stripAnsiControls(text: string): string {
  let out = '';
  for (const segment of scanAnsiText(text, 3)) {
    if (segment.kind === 'text') out += segment.text;
  }
  return out;
}

export function wrapAnsiDisplayText(
  text: string,
  width: number,
  options: RendererAnsiTextOptions = {},
): string[] {
  return wrapAnsiDisplayTextRange(text, width, 0, Number.POSITIVE_INFINITY, options);
}

/**
 * Count wrapped display rows without allocating line strings. Used by
 * {@link Text.measureContentRows} so multi-k geometry stays O(source) in
 * working-set (not O(rows) retained arrays).
 */
export function countAnsiDisplayWrappedRows(
  text: string,
  width: number,
  options: RendererAnsiTextOptions = {},
): number {
  const maxWidth = normalizeTextWidth(width);
  if (maxWidth <= 0) return 1;
  if (text.length === 0) return 1;

  let rows = 0;
  let currentWidth = 0;
  const tabWidth = normalizeTabWidth(options.tabWidth);
  let hasContent = false;

  const endLine = (): void => {
    rows += 1;
    currentWidth = 0;
    hasContent = false;
  };

  for (const token of tokenizeAnsiWrapText(text, tabWidth)) {
    if (token.kind === 'newline') {
      endLine();
      continue;
    }
    if (token.width <= 0) {
      hasContent = true;
      continue;
    }
    if (token.width > maxWidth && !token.whitespace) {
      if (currentWidth > 0) endLine();
      // Long token breaks into ceil(width/max) rows; approximate by cluster walk.
      let remaining = token.width;
      while (remaining > maxWidth) {
        rows += 1;
        remaining -= maxWidth;
      }
      currentWidth = remaining;
      hasContent = remaining > 0;
      continue;
    }
    if (currentWidth > 0 && currentWidth + token.width > maxWidth) {
      endLine();
      if (token.whitespace) continue;
    }
    currentWidth += token.width;
    hasContent = true;
  }

  if (hasContent || currentWidth > 0 || rows === 0) {
    rows += 1;
  }
  return rows;
}

/**
 * Wrap only rows in `[startRow, endRow)`. Off-window lines are not retained —
 * the primary memory contract for windowed large-body paint.
 */
export function wrapAnsiDisplayTextRange(
  text: string,
  width: number,
  startRow: number,
  endRow: number,
  options: RendererAnsiTextOptions = {},
): string[] {
  const maxWidth = normalizeTextWidth(width);
  const start = Math.max(0, Math.floor(startRow));
  const end =
    endRow === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(start, Math.floor(endRow));
  if (end <= start) return [];
  if (maxWidth <= 0) return start === 0 ? [''] : [];
  if (text.length === 0) return start === 0 ? [''] : [];

  const state = new RendererAnsiState();
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  let row = 0;
  const tabWidth = normalizeTabWidth(options.tabWidth);

  const pushLine = (line: string): boolean => {
    if (row >= end) return false;
    if (row >= start) lines.push(line);
    row += 1;
    return row < end;
  };

  for (const token of tokenizeAnsiWrapText(text, tabWidth)) {
    if (row >= end) break;

    if (token.kind === 'newline') {
      if (!pushLine(state.closeLine(current.trimEnd()))) break;
      current = state.prefix();
      currentWidth = 0;
      continue;
    }

    if (token.width <= 0) {
      current += token.text;
      state.processText(token.text);
      continue;
    }

    if (token.width > maxWidth && !token.whitespace) {
      if (currentWidth > 0) {
        if (!pushLine(state.closeLine(current.trimEnd()))) break;
      }
      const broken = breakLongAnsiToken(token.text, maxWidth, state, tabWidth);
      let stopped = false;
      for (const brokenLine of broken.lines) {
        if (!pushLine(brokenLine)) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      current = broken.current;
      currentWidth = broken.width;
      continue;
    }

    if (currentWidth > 0 && currentWidth + token.width > maxWidth) {
      if (!pushLine(state.closeLine(current.trimEnd()))) break;
      current = state.prefix();
      currentWidth = 0;
      if (token.whitespace) continue;
    }

    current += token.text;
    currentWidth += token.width;
    state.processText(token.text);
  }

  if (row < end && (current.length > 0 || row === 0)) {
    pushLine(state.closeLine(current.trimEnd()));
  }
  return lines;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
  return wrapAnsiDisplayText(text, width, { tabWidth: 3 });
}

export function truncateAnsiDisplayText(
  text: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false,
  options: RendererAnsiTextOptions = {},
): string {
  const width = normalizeTextWidth(maxWidth);
  if (width <= 0) return '';
  if (text.length === 0) return pad ? ' '.repeat(width) : '';

  const ellipsisWidth = measureAnsiDisplayWidth(ellipsis, options);
  if (ellipsisWidth >= width) {
    const textWidth = measureAnsiDisplayWidth(text, options);
    if (textWidth <= width) return pad ? text + ' '.repeat(width - textWidth) : text;

    const clippedEllipsis = truncatePlainDisplayText(
      ellipsis,
      width,
      normalizeTabWidth(options.tabWidth),
    );
    return pad
      ? clippedEllipsis + ' '.repeat(Math.max(0, width - measureDisplayWidth(clippedEllipsis)))
      : clippedEllipsis;
  }

  const contentWidth = Math.max(0, width - ellipsisWidth);
  const textWidth = measureAnsiDisplayWidth(text, options);
  if (textWidth <= width) {
    return pad ? text + ' '.repeat(width - textWidth) : text;
  }

  const state = new RendererAnsiState();
  let out = '';
  let used = 0;
  const tabWidth = normalizeTabWidth(options.tabWidth);

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      out += segment.text;
      state.process(segment.text);
      continue;
    }

    if (segment.width <= 0) {
      out += segment.text;
      continue;
    }

    if (used + segment.width > contentWidth) break;
    out += segment.text;
    used += segment.width;
  }

  const clippedEllipsis = truncatePlainDisplayText(ellipsis, width - used, tabWidth);
  const result = state.closeLine(out) + clippedEllipsis;
  return pad ? result + ' '.repeat(Math.max(0, width - used - measureDisplayWidth(clippedEllipsis))) : result;
}

export function truncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false,
): string {
  return truncateAnsiDisplayText(text, maxWidth, ellipsis, pad, { tabWidth: 3 });
}

function padAnsiDisplayLine(
  line: string,
  width: number,
  customBgFn: RendererTextBackgroundFn | undefined,
): string {
  const safeWidth = normalizeTextWidth(width);
  const clipped = measureAnsiDisplayWidth(line, { tabWidth: 3 }) > safeWidth
    ? truncateAnsiDisplayText(line, safeWidth, '', false, { tabWidth: 3 })
    : line;
  const padding = ' '.repeat(Math.max(0, safeWidth - measureAnsiDisplayWidth(clipped, { tabWidth: 3 })));
  const padded = clipped + padding;
  return customBgFn === undefined ? padded : customBgFn(padded);
}

type RendererAnsiSegment =
  | { readonly kind: 'control'; readonly text: string; readonly width: 0 }
  | { readonly kind: 'text'; readonly text: string; readonly width: number };

type RendererAnsiWrapToken =
  | { readonly kind: 'newline' }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly width: number;
      readonly whitespace: boolean;
    };

function tokenizeAnsiWrapText(text: string, tabWidth: number): RendererAnsiWrapToken[] {
  const tokens: RendererAnsiWrapToken[] = [];
  let tokenText = '';
  let tokenWidth = 0;
  let tokenWhitespace: boolean | undefined;

  const flush = (): void => {
    if (tokenText.length === 0) return;
    tokens.push({
      kind: 'text',
      text: tokenText,
      width: tokenWidth,
      whitespace: tokenWhitespace === true,
    });
    tokenText = '';
    tokenWidth = 0;
    tokenWhitespace = undefined;
  };

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      tokenText += segment.text;
      continue;
    }
    if (segment.text === '\n') {
      flush();
      tokens.push({ kind: 'newline' });
      continue;
    }

    const whitespace = segment.width > 0 && segment.text.trim() === '';
    if (tokenWhitespace !== undefined && whitespace !== tokenWhitespace) {
      flush();
    }
    tokenWhitespace = whitespace;
    tokenText += segment.text;
    tokenWidth += segment.width;
  }

  flush();
  return tokens;
}

function breakLongAnsiToken(
  text: string,
  maxWidth: number,
  state: RendererAnsiState,
  tabWidth: number,
): { readonly lines: readonly string[]; readonly current: string; readonly width: number } {
  const lines: string[] = [];
  let current = state.prefix();
  let currentWidth = 0;

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      current += segment.text;
      state.process(segment.text);
      continue;
    }
    if (segment.width <= 0) {
      current += segment.text;
      continue;
    }
    if (segment.width > maxWidth) continue;
    if (currentWidth > 0 && currentWidth + segment.width > maxWidth) {
      lines.push(state.closeLine(current.trimEnd()));
      current = state.prefix();
      currentWidth = 0;
    }
    current += segment.text;
    currentWidth += segment.width;
  }

  return { lines, current, width: currentWidth };
}

function* scanAnsiText(text: string, tabWidth: number): Generator<RendererAnsiSegment> {
  let cursor = 0;
  while (cursor < text.length) {
    const control = readAnsiControlAt(text, cursor);
    if (control !== undefined) {
      yield { kind: 'control', text: control.text, width: 0 };
      cursor += control.length;
      continue;
    }

    const nextEscape = text.indexOf('\u001B', cursor + 1);
    const end = nextEscape === -1 ? text.length : nextEscape;
    for (const cluster of splitDisplayClusters(text.slice(cursor, end))) {
      if (cluster.text === '\t') {
        yield { kind: 'text', text: ' '.repeat(tabWidth), width: tabWidth };
      } else {
        yield { kind: 'text', text: cluster.text, width: cluster.width };
      }
    }
    cursor = end;
  }
}

function readAnsiControlAt(
  text: string,
  index: number,
): { readonly text: string; readonly length: number } | undefined {
  if (text.codePointAt(index) !== 0x1b) return undefined;
  const next = text.codePointAt(index + 1);
  if (next === undefined) return undefined;

  if (next === 0x5b) return readAnsiUntilFinalByte(text, index, 0x40, 0x7e);
  if (next === 0x5d || next === 0x50 || next === 0x5e || next === 0x5f) {
    return readAnsiStringControl(text, index);
  }
  if (next >= 0x40 && next <= 0x5f) {
    return { text: text.slice(index, index + 2), length: 2 };
  }
  return undefined;
}

function readAnsiUntilFinalByte(
  text: string,
  index: number,
  minFinalByte: number,
  maxFinalByte: number,
): { readonly text: string; readonly length: number } | undefined {
  for (let cursor = index + 2; cursor < text.length; cursor++) {
    const code = text.codePointAt(cursor);
    if (code === undefined) continue;
    if (code >= minFinalByte && code <= maxFinalByte) {
      return { text: text.slice(index, cursor + 1), length: cursor + 1 - index };
    }
  }
  return { text: text.slice(index), length: text.length - index };
}

function readAnsiStringControl(
  text: string,
  index: number,
): { readonly text: string; readonly length: number } {
  for (let cursor = index + 2; cursor < text.length; cursor++) {
    const code = text.codePointAt(cursor);
    if (code === 0x07) {
      return { text: text.slice(index, cursor + 1), length: cursor + 1 - index };
    }
    if (code === 0x1b && text.codePointAt(cursor + 1) === 0x5c) {
      return { text: text.slice(index, cursor + 2), length: cursor + 2 - index };
    }
  }
  return { text: text.slice(index), length: text.length - index };
}

class RendererAnsiState {
  private activeSgr = '';
  private fg = false;
  private bg = false;
  private bold = false;
  private dim = false;
  private italic = false;
  private underline = false;
  private inverse = false;

  process(control: string): void {
    const sgr = parseSgrControl(control);
    if (sgr === undefined) return;

    for (let index = 0; index < sgr.length; index++) {
      const code = sgr[index] ?? 0;
      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 38:
          this.fg = true;
          index += sgr[index + 1] === 2 ? 4 : sgr[index + 1] === 5 ? 2 : 0;
          break;
        case 39:
          this.fg = false;
          break;
        case 48:
          this.bg = true;
          index += sgr[index + 1] === 2 ? 4 : sgr[index + 1] === 5 ? 2 : 0;
          break;
        case 49:
          this.bg = false;
          break;
        default:
          if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) this.fg = true;
          if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) this.bg = true;
          break;
      }
    }

    if (sgr.some((code) => code !== 0)) {
      this.activeSgr += control;
    }
    if (!this.hasActiveStyle()) this.activeSgr = '';
  }

  processText(text: string): void {
    for (const segment of scanAnsiText(text, 3)) {
      if (segment.kind === 'control') this.process(segment.text);
    }
  }

  prefix(): string {
    return this.activeSgr;
  }

  closeLine(line: string): string {
    return this.hasActiveStyle() && line.length > 0 ? line + ANSI_RESET_STYLE : line;
  }

  private reset(): void {
    this.activeSgr = '';
    this.fg = false;
    this.bg = false;
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.inverse = false;
  }

  private hasActiveStyle(): boolean {
    return (
      this.fg ||
      this.bg ||
      this.bold ||
      this.dim ||
      this.italic ||
      this.underline ||
      this.inverse
    );
  }
}

function parseSgrControl(control: string): readonly number[] | undefined {
  if (!control.startsWith('\u001B[') || !control.endsWith('m')) return undefined;
  const raw = control.slice(2, -1);
  if (raw.length === 0) return [0];
  return raw.split(';').map((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  });
}

function truncatePlainDisplayText(text: string, maxWidth: number, tabWidth: number): string {
  let out = '';
  let used = 0;
  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control' || segment.width <= 0) continue;
    if (used + segment.width > maxWidth) break;
    out += segment.text;
    used += segment.width;
  }
  return out;
}

function normalizeTextWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
}

function normalizePadding(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTabWidth(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? 3 : Math.floor(value);
}
