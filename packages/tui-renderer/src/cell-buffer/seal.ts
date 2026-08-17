import type { RendererCell } from './types';

export interface RendererBufferBackgroundTarget {
  readonly width: number;
  readonly height: number;
  getCell(x: number, y: number): RendererCell;
  setCell(x: number, y: number, cell: RendererCell): void;
}

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
 */
export function sealRendererBufferBackground(
  buffer: RendererBufferBackgroundTarget,
  fill: RendererCell | undefined,
): number {
  const bg = fill?.style?.bg;
  if (bg === undefined) return 0;
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
