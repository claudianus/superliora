import { displayClusterWidth, splitDisplayClusters } from '../text/metrics';
import type { RendererCell, RendererCellStyle } from './types';

export const EMPTY_CELL: RendererCell = { char: ' ' };

export function normalizeSize(value: number): number {
  if (!Number.isFinite(value) || value < 0) return -1;
  return Math.floor(value);
}

export function cellsEqual(a: RendererCell, b: RendererCell): boolean {
  if (a === b) return true;
  if (a.char !== b.char) return false;
  if (a.continuation !== b.continuation) return false;
  if (normalizedCellWidth(a) !== normalizedCellWidth(b)) return false;
  if (normalizeLink(a.link) !== normalizeLink(b.link)) return false;
  return stylesEqual(a.style, b.style);
}

/**
 * Allocation-free equality for cells that are already normalized — i.e. every
 * cell stored inside a {@link RendererCellBuffer} (constructor, setCell,
 * fillRect, copyFrom all normalize on write). Skips re-normalization, object
 * allocation, and `Object.keys`, comparing fields directly with reference
 * shortcuts. This is the hot path for per-cell diff scans.
 *
 * Must NOT be used for arbitrary/unnormalized cells (e.g. VFX output or
 * terminal-output style probes); use the public {@link cellsEqual} there.
 */
export function normalizedCellsEqual(a: RendererCell, b: RendererCell): boolean {
  if (a === b) return true;
  return (
    a.char === b.char &&
    a.link === b.link &&
    a.width === b.width &&
    a.continuation === b.continuation &&
    normalizedStylesEqual(a.style, b.style)
  );
}

/**
 * Position-dependent cell hash for XOR-based row checksums.
 *
 * Combines x-coordinate, character code point, width/continuation flags, and
 * style field hashes into a single uint32. The hash is deterministic for
 * normalized cells and position-sensitive (same cell at different columns
 * produces different hashes) so that column-shifted content is detected.
 *
 * Uses Math.imul for 32-bit multiply to avoid floating-point rounding.
 */
export function cellPositionHash(x: number, cell: RendererCell): number {
  // Mix position with golden ratio constant for good distribution.
  // `pos` is unique per column and feeds into the character hash below so
  // that the same character change at different columns produces different
  // XOR deltas — preventing even-count cancellation in the row checksum.
  const pos = Math.imul(x + 1, 0x9e3779b9);
  let h = pos;
  // Character code point mixed with position (BMP fast path).
  const code = cell.char.length === 1 ? cell.char.codePointAt(0) : (cell.char.codePointAt(0) ?? 0);
  h ^= Math.imul(code + 1, pos);
  // Width and continuation flags.
  h ^= (cell.width ?? 1) << 16;
  if (cell.continuation === true) h ^= 0x40000000;
  // Style content hash (field-based, not reference-based). Mixed with position
  // so a style-only change at different columns yields different XOR deltas —
  // otherwise an even number of identical style edits in one row cancels out of
  // the row checksum and the diff skips the row (cell VFX such as pulse/shimmer
  // would not re-encode). The character term above already guards char changes.
  const styleHash = normalizedStyleHash(cell.style);
  if (styleHash !== 0) h ^= Math.imul(styleHash, pos | 1);
  // Link presence hash.
  if (cell.link !== undefined) {
    h ^= Math.imul(cell.link.length + 1, 0xc2b2ae35);
    // Sample first/last char codes for cheap discrimination.
    h ^= cell.link.codePointAt(0) << 8;
    if (cell.link.length > 1) h ^= cell.link.codePointAt(cell.link.length - 1);
  }
  return h >>> 0;
}

export function normalizeCell(cell: RendererCell): RendererCell {
  const link = normalizeLink(cell.link);
  if (cell.continuation === true || cell.width === 0) {
    const style = normalizeStyle(cell.style);
    return applyCellMetadata({ char: '', width: 0, continuation: true }, style, link);
  }
  // Ambient paints mostly single printable BMP glyphs — skip grapheme split.
  // A single UTF-16 code unit that is a printable BMP char (including wide
  // chars like 한글) is its own cluster, so only control/DEL chars and
  // multi-unit strings need the segmenter. Width is still measured below
  // (displayClusterWidth has its own ASCII fast path).
  const raw = cell.char;
  let char: string;
  if (raw.length === 1) {
    const code = raw.codePointAt(0);
    char =
      code !== undefined && code >= 0x20 && code !== 0x7f
        ? raw
        : (splitDisplayClusters(raw)[0]?.text ?? ' ');
  } else if (raw.length === 0) {
    char = ' ';
  } else {
    char = splitDisplayClusters(raw)[0]?.text ?? ' ';
  }
  const style = normalizeStyle(cell.style);
  const width = Math.max(1, Math.min(2, cell.width ?? displayClusterWidth(char)));
  return applyCellMetadata(width === 1 ? { char } : { char, width }, style, link);
}

export function normalizeStyle(style: RendererCellStyle | undefined): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const normalized: {
    fg?: string;
    bg?: string;
    bold?: true;
    dim?: true;
    italic?: true;
    underline?: true;
    inverse?: true;
  } = {};
  if (style.fg !== undefined) normalized.fg = style.fg;
  if (style.bg !== undefined) normalized.bg = style.bg;
  if (style.bold === true) normalized.bold = true;
  if (style.dim === true) normalized.dim = true;
  if (style.italic === true) normalized.italic = true;
  if (style.underline === true) normalized.underline = true;
  if (style.inverse === true) normalized.inverse = true;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizedCellWidth(cell: RendererCell): number | undefined {
  if (cell.continuation === true || cell.width === 0) return 0;
  const width = cell.width ?? displayClusterWidth(cell.char);
  return width === 1 ? undefined : width;
}

function normalizeLink(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  const normalized = link.replaceAll(/[\u0000-\u001F\u007F]/g, '');
  return normalized.length === 0 ? undefined : normalized;
}

function applyCellMetadata(
  cell: RendererCell,
  style: RendererCellStyle | undefined,
  link: string | undefined,
): RendererCell {
  if (style === undefined && link === undefined) return cell;
  const normalized: {
    char: string;
    style?: RendererCellStyle;
    link?: string;
    width?: number;
    continuation?: boolean;
  } = { char: cell.char };
  if (cell.width !== undefined) normalized.width = cell.width;
  if (cell.continuation !== undefined) normalized.continuation = cell.continuation;
  if (style !== undefined) normalized.style = style;
  if (link !== undefined) normalized.link = link;
  return normalized;
}

/**
 * Numeric hash of a normalized style's fields. Returns 0 for undefined.
 * Field-based (not reference-based) so logically equal styles hash equally.
 */
function normalizedStyleHash(style: RendererCellStyle | undefined): number {
  if (style === undefined) return 0;
  let h = 0x12345678;
  if (style.fg !== undefined) h ^= Math.imul(style.fg.length + 1, 0x27d4eb2f) ^ hashShortString(style.fg);
  if (style.bg !== undefined) h ^= Math.imul(style.bg.length + 1, 0x165667b1) ^ hashShortString(style.bg);
  let flags = 0;
  if (style.bold === true) flags |= 1;
  if (style.dim === true) flags |= 2;
  if (style.italic === true) flags |= 4;
  if (style.underline === true) flags |= 8;
  if (style.inverse === true) flags |= 16;
  h ^= flags << 24;
  return h >>> 0;
}

/** FNV-1a inspired hash for short strings (color hex values, typically 4-7 chars). */
function hashShortString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Allocation-free style equality for normalized styles (flags are `true` or
 * absent, never `false`). Reference-equal styles short-circuit immediately,
 * which is the common case when a run of cells shares one style object.
 */
function normalizedStylesEqual(
  a: RendererCellStyle | undefined,
  b: RendererCellStyle | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

function stylesEqual(
  a: RendererCellStyle | undefined,
  b: RendererCellStyle | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Buffer cells store normalizeStyle() results — compare fields directly
  // instead of re-normalizing on every ambient scan.
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}
