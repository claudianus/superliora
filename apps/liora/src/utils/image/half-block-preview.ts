/**
 * Render a decoded PNG as terminal half-block (`▀`) cells.
 *
 * Each output cell covers two vertical pixels: the top pixel is drawn
 * with the SGR foreground color, the bottom pixel with the background
 * color, doubling vertical resolution. Truecolor terminals get 24-bit
 * SGR; everything else falls back to the 6×6×6 256-color cube.
 */

import type { DecodedPng } from '#/utils/image/png-decode';

export interface HalfBlockPreviewOptions {
  readonly maxWidth: number;
  readonly maxHeightRows: number;
  readonly truecolor: boolean;
}

const HALF_BLOCK = '▀';

export function renderHalfBlockPreview(
  png: DecodedPng,
  options: HalfBlockPreviewOptions,
): string[] {
  const maxWidth = Math.max(1, options.maxWidth);
  const maxHeightRows = Math.max(1, options.maxHeightRows);
  const scale = Math.min(maxWidth / png.width, (maxHeightRows * 2) / png.height);
  const outW = clamp(Math.round(png.width * scale), 1, maxWidth);
  let outH = clamp(Math.round(png.height * scale), 2, maxHeightRows * 2);
  if (outH % 2 === 1) outH -= 1;

  const cells = resample(png, outW, outH);

  const lines: string[] = [];
  for (let row = 0; row < outH; row += 2) {
    let line = '';
    let prevFg = -1;
    let prevBg = -1;
    for (let ox = 0; ox < outW; ox++) {
      const top = (row * outW + ox) * 3;
      const bottom = ((row + 1) * outW + ox) * 3;
      const fg = colorKey(cells, top);
      const bg = colorKey(cells, bottom);
      // Skip re-emitting an SGR pair identical to the previous cell.
      if (fg !== prevFg) line += foregroundSgr(cells, top, options.truecolor);
      if (bg !== prevBg) line += backgroundSgr(cells, bottom, options.truecolor);
      line += HALF_BLOCK;
      prevFg = fg;
      prevBg = bg;
    }
    lines.push(`${line}\u001B[0m`);
  }
  return lines;
}

/**
 * Area-average resample into outW × outH cells (flat r,g,b triples).
 *
 * Alpha is deliberately ignored: pasted screenshots are opaque, and
 * compositing translucent pixels needs the terminal background color,
 * which varies by theme and is not known here.
 */
function resample(png: DecodedPng, outW: number, outH: number): Uint8Array {
  const { width, height, pixels } = png;
  const out = new Uint8Array(outW * outH * 3);
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * height) / outH);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * width) / outW);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outW));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let src = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += pixels[src]!;
          g += pixels[src + 1]!;
          b += pixels[src + 2]!;
          n += 1;
          src += 4;
        }
      }
      const dst = (oy * outW + ox) * 3;
      out[dst] = Math.round(r / n);
      out[dst + 1] = Math.round(g / n);
      out[dst + 2] = Math.round(b / n);
    }
  }
  return out;
}

function colorKey(cells: Uint8Array, offset: number): number {
  return (cells[offset]! << 16) | (cells[offset + 1]! << 8) | cells[offset + 2]!;
}

function foregroundSgr(cells: Uint8Array, offset: number, truecolor: boolean): string {
  return truecolor
    ? `\u001B[38;2;${cells[offset]!};${cells[offset + 1]!};${cells[offset + 2]!}m`
    : `\u001B[38;5;${cubeIndex(cells, offset)}m`;
}

function backgroundSgr(cells: Uint8Array, offset: number, truecolor: boolean): string {
  return truecolor
    ? `\u001B[48;2;${cells[offset]!};${cells[offset + 1]!};${cells[offset + 2]!}m`
    : `\u001B[48;5;${cubeIndex(cells, offset)}m`;
}

/** Quantize to the 6×6×6 color cube (indices 16–231). */
function cubeIndex(cells: Uint8Array, offset: number): number {
  const r5 = Math.round((cells[offset]! / 255) * 5);
  const g5 = Math.round((cells[offset + 1]! / 255) * 5);
  const b5 = Math.round((cells[offset + 2]! / 255) * 5);
  return 16 + 36 * r5 + 6 * g5 + b5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
