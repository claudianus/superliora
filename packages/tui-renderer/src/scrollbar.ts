import { ansiTextToCells } from './ansi-text';
import type { RendererRegionLine } from './compositor';
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

/** Visual recipe for vertical scrollbar glyphs. */
export type RendererScrollbarVariant = 'plain' | 'capsule';

/** Role of a single track cell — callers can recolor by role. */
export type RendererScrollbarGlyphRole =
  | 'track'
  | 'thumb'
  | 'thumb-top'
  | 'thumb-mid'
  | 'thumb-bottom'
  | 'thumb-only'
  | 'cap-top'
  | 'cap-bottom';

export interface RendererScrollbarRenderOptions extends RendererScrollbarOptions {
  readonly trackChar?: string;
  readonly thumbChar?: string;
  /**
   * `plain` — uniform track/thumb chars (legacy default).
   * `capsule` — rounded thumb ends + soft track; optional edge cues when not
   * at top/bottom so the gutter reads as a living control, not a block stick.
   */
  readonly variant?: RendererScrollbarVariant;
  /** Capsule track glyph (default `┊`). Ignored for plain. */
  readonly capsuleTrackChar?: string;
  /** Optional top-edge cue when content continues above (default `▴`). */
  readonly topCueChar?: string;
  /** Optional bottom-edge cue when content continues below (default `▾`). */
  readonly bottomCueChar?: string;
  /**
   * When true (default for capsule), paint edge cues on the first/last track
   * row when not at that edge. Plain variant ignores this.
   */
  readonly edgeCues?: boolean;
  /** Rewrite a role/glyph pair (e.g. theme color). Applied after variant paint. */
  readonly paintGlyph?: (role: RendererScrollbarGlyphRole, glyph: string) => string;
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
const DEFAULT_CAPSULE_TRACK = '┊';
const DEFAULT_THUMB_TOP = '▀';
const DEFAULT_THUMB_MID = '█';
const DEFAULT_THUMB_BOTTOM = '▄';
const DEFAULT_TOP_CUE = '▴';
const DEFAULT_BOTTOM_CUE = '▾';

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

/**
 * Build per-row glyphs for a vertical scrollbar.
 * Metrics are shared with `measureRendererScrollbar`; only paint differs.
 */
export function renderRendererVerticalScrollbar(
  options: RendererScrollbarRenderOptions,
): readonly string[] {
  const metrics = measureRendererScrollbar(options);
  if (!metrics.visible) return [];

  const variant = options.variant ?? 'plain';
  const paint = options.paintGlyph ?? ((_: RendererScrollbarGlyphRole, glyph: string) => glyph);

  if (variant === 'plain') {
    const trackChar = firstDisplayChar(options.trackChar, DEFAULT_TRACK_CHAR);
    const thumbChar = firstDisplayChar(options.thumbChar, DEFAULT_THUMB_CHAR);
    return Array.from({ length: metrics.trackRows }, (_, y) => {
      const inThumb = y >= metrics.thumbStart && y < metrics.thumbStart + metrics.thumbRows;
      return paint(inThumb ? 'thumb' : 'track', inThumb ? thumbChar : trackChar);
    });
  }

  return renderCapsuleScrollbar(metrics, options, paint);
}

function renderCapsuleScrollbar(
  metrics: RendererScrollbarMetrics,
  options: RendererScrollbarRenderOptions,
  paint: (role: RendererScrollbarGlyphRole, glyph: string) => string,
): readonly string[] {
  const trackChar = firstDisplayChar(options.capsuleTrackChar ?? options.trackChar, DEFAULT_CAPSULE_TRACK);
  const thumbBody = firstDisplayChar(options.thumbChar, DEFAULT_THUMB_MID);
  const thumbTop = DEFAULT_THUMB_TOP;
  const thumbBottom = DEFAULT_THUMB_BOTTOM;
  const edgeCues = options.edgeCues !== false;
  const topCue = firstDisplayChar(options.topCueChar, DEFAULT_TOP_CUE);
  const bottomCue = firstDisplayChar(options.bottomCueChar, DEFAULT_BOTTOM_CUE);

  const thumbEnd = metrics.thumbStart + metrics.thumbRows;

  return Array.from({ length: metrics.trackRows }, (_, y) => {
    const inThumb = y >= metrics.thumbStart && y < thumbEnd;
    if (inThumb) {
      if (metrics.thumbRows === 1) {
        return paint('thumb-only', thumbBody);
      }
      if (y === metrics.thumbStart) {
        return paint('thumb-top', thumbTop);
      }
      if (y === thumbEnd - 1) {
        return paint('thumb-bottom', thumbBottom);
      }
      return paint('thumb-mid', thumbBody);
    }

    // Edge cues sit on the track ends when more content exists that way,
    // and only when those rows are not occupied by the thumb.
    if (edgeCues && y === 0 && !metrics.atTop) {
      return paint('cap-top', topCue);
    }
    if (edgeCues && y === metrics.trackRows - 1 && !metrics.atBottom) {
      return paint('cap-bottom', bottomCue);
    }
    return paint('track', trackChar);
  });
}

export function renderRendererRightGutterLines(
  options: RendererRightGutterLinesOptions,
): string[] {
  const width = normalizeTrackRows(options.width);
  if (width <= 0) return options.lines.map(() => '');
  const emptyGlyph = resolveGutterGlyph(options.emptyGlyph, DEFAULT_EMPTY_GUTTER_GLYPH);
  return options.lines.map((line, index) =>
    renderRendererRightGutterLine(line, width, options.glyphs[index] ?? emptyGlyph),
  );
}

export function renderRendererRightGutterRegionLines(
  options: RendererRightGutterRegionLinesOptions,
): RendererRegionLine[] {
  const width = normalizeTrackRows(options.width);
  if (width <= 0) return options.lines.map((line) => line);
  const emptyGlyph = resolveGutterGlyph(options.emptyGlyph, DEFAULT_EMPTY_GUTTER_GLYPH);
  return options.lines.map((line, index) =>
    appendRendererRegionLineRightGutter(line, width, options.glyphs[index] ?? emptyGlyph),
  );
}

export interface RendererRightGutterRegionLinesOptions {
  readonly lines: readonly RendererRegionLine[];
  readonly width: number;
  readonly glyphs: readonly string[];
  readonly emptyGlyph?: string;
}

export function appendRendererRegionLineRightGutter(
  line: RendererRegionLine,
  width: number,
  glyph: string,
): RendererRegionLine {
  const plain = typeof line === 'string' ? line : line.map((cell) => cell.char).join('');
  return ansiTextToCells(renderRendererRightGutterLine(plain, width, glyph));
}

function renderRendererRightGutterLine(line: string, width: number, glyph: string): string {
  const safeGlyph = resolveGutterGlyph(glyph, DEFAULT_EMPTY_GUTTER_GLYPH);
  const glyphWidth = Math.max(1, visibleWidth(stripAnsi(safeGlyph)));
  const visible = visibleWidth(line);
  if (visible >= width) {
    return `${truncateToWidth(line, Math.max(0, width - glyphWidth), '')}${safeGlyph}`;
  }
  return `${line}${' '.repeat(Math.max(0, width - visible - glyphWidth))}${safeGlyph}`;
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

/**
 * Accept a plain single-width char, or an ANSI-styled single display cell
 * (theme-colored scrollbar glyphs from the host app).
 */
function resolveGutterGlyph(value: string | undefined, fallback: string): string {
  if (value === undefined || value.length === 0) return fallback;
  if (value.includes('\u001B')) {
    const plain = stripAnsi(value);
    if (plain.length === 0) return fallback;
    if (visibleWidth(plain) <= 1) return value;
    // Multi-width styled run: keep first display char, drop styling.
    return firstDisplayChar(plain, fallback);
  }
  return firstDisplayChar(value, fallback);
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
