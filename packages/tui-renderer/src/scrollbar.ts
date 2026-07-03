import { truncateToWidth, visibleWidth } from './text-component';

export interface RendererScrollbarOptions {
  readonly contentRows: number;
  readonly viewportRows: number;
  readonly offsetFromBottom?: number;
  readonly trackRows?: number;
  readonly minThumbRows?: number;
}

export interface RendererScrollbarMetrics {
  readonly visible: boolean;
  readonly contentRows: number;
  readonly viewportRows: number;
  readonly trackRows: number;
  readonly start: number;
  readonly maxStart: number;
  readonly thumbStart: number;
  readonly thumbRows: number;
  readonly progress: number;
  readonly atTop: boolean;
  readonly atBottom: boolean;
}

export interface RendererScrollbarRenderOptions extends RendererScrollbarOptions {
  readonly trackChar?: string;
  readonly thumbChar?: string;
}

export interface RendererRightGutterLinesOptions {
  readonly lines: readonly string[];
  readonly width: number;
  readonly glyphs: readonly string[];
  readonly emptyGlyph?: string;
}

const DEFAULT_TRACK_CHAR = '│';
const DEFAULT_THUMB_CHAR = '█';
const DEFAULT_EMPTY_GUTTER_GLYPH = ' ';

export function measureRendererScrollbar(
  options: RendererScrollbarOptions,
): RendererScrollbarMetrics {
  const contentRows = normalizeRows(options.contentRows);
  const viewportRows = normalizeRows(options.viewportRows);
  const trackRows = normalizeTrackRows(options.trackRows ?? viewportRows);
  const minThumbRows = normalizeMinThumbRows(options.minThumbRows, trackRows);
  const maxStart = Math.max(0, contentRows - viewportRows);
  const offsetFromBottom = normalizeOffset(options.offsetFromBottom);
  const start = Math.max(0, maxStart - Math.min(offsetFromBottom, maxStart));
  const visible = contentRows > viewportRows && trackRows > 0;

  if (!visible) {
    return {
      visible: false,
      contentRows,
      viewportRows,
      trackRows,
      start: 0,
      maxStart,
      thumbStart: 0,
      thumbRows: 0,
      progress: 1,
      atTop: true,
      atBottom: true,
    };
  }

  const proportionalThumbRows = Math.round(trackRows * (viewportRows / contentRows));
  const thumbRows = clamp(proportionalThumbRows, minThumbRows, trackRows);
  const travelRows = trackRows - thumbRows;
  const progress = maxStart === 0 ? 1 : start / maxStart;
  const thumbStart = travelRows === 0 ? 0 : Math.round(progress * travelRows);

  return {
    visible,
    contentRows,
    viewportRows,
    trackRows,
    start,
    maxStart,
    thumbStart,
    thumbRows,
    progress,
    atTop: start === 0,
    atBottom: start === maxStart,
  };
}

export function renderRendererVerticalScrollbar(
  options: RendererScrollbarRenderOptions,
): readonly string[] {
  const metrics = measureRendererScrollbar(options);
  if (!metrics.visible) return [];

  const trackChar = firstDisplayChar(options.trackChar, DEFAULT_TRACK_CHAR);
  const thumbChar = firstDisplayChar(options.thumbChar, DEFAULT_THUMB_CHAR);
  return Array.from({ length: metrics.trackRows }, (_, y) =>
    y >= metrics.thumbStart && y < metrics.thumbStart + metrics.thumbRows
      ? thumbChar
      : trackChar,
  );
}

export function renderRendererRightGutterLines(
  options: RendererRightGutterLinesOptions,
): string[] {
  const width = normalizeTrackRows(options.width);
  if (width <= 0) return options.lines.map(() => '');
  const emptyGlyph = firstDisplayChar(options.emptyGlyph, DEFAULT_EMPTY_GUTTER_GLYPH);
  return options.lines.map((line, index) =>
    renderRendererRightGutterLine(line, width, options.glyphs[index] ?? emptyGlyph),
  );
}

function renderRendererRightGutterLine(line: string, width: number, glyph: string): string {
  const safeGlyph = firstDisplayChar(glyph, DEFAULT_EMPTY_GUTTER_GLYPH);
  const visible = visibleWidth(line);
  if (visible >= width) return `${truncateToWidth(line, width - 1, '')}${safeGlyph}`;
  return `${line}${' '.repeat(Math.max(0, width - visible - 1))}${safeGlyph}`;
}

function normalizeRows(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeTrackRows(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeMinThumbRows(value: number | undefined, trackRows: number): number {
  if (trackRows <= 0) return 0;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 1;
  return clamp(Math.floor(value), 1, trackRows);
}

function normalizeOffset(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function firstDisplayChar(value: string | undefined, fallback: string): string {
  const char = Array.from(value ?? '')[0];
  return char === undefined || char.length === 0 ? fallback : char;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
