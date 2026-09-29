import type { RendererCell } from './types';

export interface RendererBufferBackgroundTarget {
  readonly width: number;
  readonly height: number;
  getCell(x: number, y: number): RendererCell;
  setCell(x: number, y: number, cell: RendererCell): void;
}

/**
 * Per-row dirty intervals, keyed by row. `undefined` means the caller cannot
 * vouch for damage tracking (e.g. a structural mock), which forces the full
 * walk. Callers that do track damage pass the live map so the seal never
 * allocates a span array.
 */
export type RendererSealRowScopes = ReadonlyMap<number, { x: number; endX: number }[]>;

/** True when a cell would encode as the terminal default background. */
export function cellLacksBackground(cell: RendererCell): boolean {
  return cell.style?.bg === undefined;
}

export function inheritCellBackground(cell: RendererCell, bg: string): RendererCell {
  if (cell.style?.bg !== undefined) return cell;
  return cell.style === undefined
    ? { ...cell, style: { bg } }
    : { ...cell, style: { ...cell.style, bg } };
}

/**
 * Paint canvas background onto every cell that still has none.
 *
 * After compose, short content rows and unstyled pads otherwise stay
 * EMPTY_CELL. The encoder can then emit CSI K after SGR reset, which
 * ConPTY fills with the terminal default (often black) — a flashing band.
 *
 * `rowScopes` restricts the walk to rows the caller knows were rewritten since
 * the last damage reset. That is sound because a cell can only *lose* its
 * background by being rewritten, and every write path (`setCell` /
 * `setRowSpan` / `fillRect`) marks damage — so an untouched row is still
 * sealed from an earlier frame. An empty scope means the caller cannot vouch
 * for that (a cleared buffer carries no damage yet every cell needs sealing),
 * so it falls back to the full walk.
 */
export function sealRendererBufferBackground(
  buffer: RendererBufferBackgroundTarget,
  fill: RendererCell | undefined,
  rowScopes?: RendererSealRowScopes,
): number {
  const bg = fill?.style?.bg;
  if (bg === undefined) return 0;
  if (rowScopes === undefined || rowScopes.size === 0) {
    return sealFullFrame(buffer, bg);
  }
  let sealed = 0;
  for (const [y, intervals] of rowScopes) {
    for (const interval of intervals) {
      const startX = Math.max(0, interval.x);
      const endX = Math.min(buffer.width, interval.endX);
      for (let x = startX; x < endX; x++) {
        const cell = buffer.getCell(x, y);
        if (!cellLacksBackground(cell)) continue;
        buffer.setCell(x, y, inheritCellBackground(cell, bg));
        sealed++;
      }
    }
  }
  return sealed;
}

function sealFullFrame(buffer: RendererBufferBackgroundTarget, bg: string): number {
  let sealed = 0;
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.getCell(x, y);
      if (!cellLacksBackground(cell)) continue;
      buffer.setCell(x, y, inheritCellBackground(cell, bg));
      sealed++;
    }
  }
  return sealed;
}

export function countCellsMissingBackground(buffer: RendererBufferBackgroundTarget): number {
  let missing = 0;
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (cellLacksBackground(buffer.getCell(x, y))) missing++;
    }
  }
  return missing;
}
