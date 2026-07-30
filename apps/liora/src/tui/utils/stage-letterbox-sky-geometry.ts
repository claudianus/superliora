import type { StageFrameBand } from '#/tui/utils/stage-frame';

export interface StageLetterboxSkyCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly fg: string;
  readonly bold?: boolean;
}

export interface LetterboxSideGutter {
  /** Inclusive left column. */
  readonly x0: number;
  /** Exclusive right column. */
  readonly x1: number;
}

/** Stage outer hole (letterbox-exclusive). Half-open: [x0,x1) × [y0,y1). */
export interface StageHole {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function bandContains(band: StageFrameBand, x: number, y: number): boolean {
  return (
    x >= band.x &&
    x < band.x + band.width &&
    y >= band.y &&
    y < band.y + band.height
  );
}

export function pointInLetterboxBands(
  bands: readonly StageFrameBand[],
  x: number,
  y: number,
): boolean {
  for (const band of bands) {
    if (bandContains(band, x, y)) return true;
  }
  return false;
}

export function letterboxArea(bands: readonly StageFrameBand[]): number {
  return bands.reduce((sum, b) => sum + b.width * b.height, 0);
}

/**
 * Full-height corridors beside the stage: columns that stay letterbox for every row.
 * Top/bottom-only letterbox (no side gutters) yields an empty list.
 */
export function resolveLetterboxSideGutters(
  bands: readonly StageFrameBand[],
  cols: number,
): readonly LetterboxSideGutter[] {
  if (cols <= 0 || bands.length === 0) return [];
  const gutters: LetterboxSideGutter[] = [];
  for (const band of bands) {
    if (band.x === 0 && band.width > 0 && band.width < cols) {
      gutters.push({ x0: 0, x1: band.width });
      break;
    }
  }
  for (const band of bands) {
    const right = band.x + band.width;
    if (band.x > 0 && right === cols && band.width > 0) {
      gutters.push({ x0: band.x, x1: cols });
      break;
    }
  }
  return gutters;
}

/**
 * Infer the stage outer rect (the hole in the letterbox) from full-edge bands.
 */
export function resolveStageHoleFromBands(
  bands: readonly StageFrameBand[],
  cols: number,
  rows: number,
): StageHole | undefined {
  if (cols <= 0 || rows <= 0 || bands.length === 0) return undefined;
  let y0 = 0;
  let y1 = rows;
  let x0 = 0;
  let x1 = cols;
  let sawTop = false;
  let sawBottom = false;
  let sawLeft = false;
  let sawRight = false;
  for (const band of bands) {
    if (band.y === 0 && band.x === 0 && band.width === cols && band.height > 0) {
      y0 = band.height;
      sawTop = true;
    }
    if (band.x === 0 && band.width === cols && band.y > 0 && band.y + band.height === rows) {
      y1 = band.y;
      sawBottom = true;
    }
    if (band.x === 0 && band.width > 0 && band.width < cols && band.y > 0) {
      x0 = band.width;
      sawLeft = true;
    }
    if (band.x > 0 && band.x + band.width === cols && band.width > 0 && band.y > 0) {
      x1 = band.x;
      sawRight = true;
    }
  }
  if (!(sawTop || sawBottom || sawLeft || sawRight)) return undefined;
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x0, y0, x1, y1 };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function insideHole(x: number, y: number, hole: StageHole): boolean {
  return x >= hole.x0 && x < hole.x1 && y >= hole.y0 && y < hole.y1;
}

export function skyCellKey(x: number, y: number): number {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}
