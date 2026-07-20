import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodePng } from '#/utils/image/png-decode';

interface MakePngOptions {
  readonly colorType?: number;
  readonly interlace?: number;
  readonly corruptCrc?: boolean;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return Math.trunc(crc ^ 0xffff_ffff);
}

function chunk(type: string, data: Uint8Array, corruptCrc = false): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.codePointAt(i)!;
  out.set(data, 8);
  let crc = crc32(out, 4, 8 + data.length);
  if (corruptCrc) crc = Math.trunc(crc ^ 0xffff_ffff);
  view.setUint32(8 + data.length, crc);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Assemble a PNG from already-filtered scanline bytes (filter byte per row). */
function assemblePng(
  width: number,
  height: number,
  colorType: number,
  filteredScanlines: Uint8Array,
  extraChunks: Uint8Array[] = [],
  options: MakePngOptions = {},
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = options.interlace ?? 0;
  return concatBytes([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extraChunks,
    chunk('IDAT', deflateSync(filteredScanlines), options.corruptCrc ?? false),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Build filter-0 scanlines for the given color type from RGBA input pixels. */
function makePng(
  width: number,
  height: number,
  rgbaPixels: Uint8Array,
  options: MakePngOptions = {},
): Uint8Array {
  const colorType = options.colorType ?? 6;
  const count = width * height;
  if (colorType === 6) {
    const scanlines = new Uint8Array(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
      const row = y * (1 + width * 4);
      scanlines[row] = 0;
      scanlines.set(rgbaPixels.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
    }
    return assemblePng(width, height, colorType, scanlines, [], options);
  }
  if (colorType === 2) {
    const scanlines = new Uint8Array(height * (1 + width * 3));
    let dst = 0;
    for (let i = 0; i < count; i++) {
      if (i % width === 0) scanlines[dst++] = 0;
      scanlines[dst++] = rgbaPixels[i * 4]!;
      scanlines[dst++] = rgbaPixels[i * 4 + 1]!;
      scanlines[dst++] = rgbaPixels[i * 4 + 2]!;
    }
    return assemblePng(width, height, colorType, scanlines, [], options);
  }
  if (colorType === 0) {
    const scanlines = new Uint8Array(height * (1 + width));
    let dst = 0;
    for (let i = 0; i < count; i++) {
      if (i % width === 0) scanlines[dst++] = 0;
      scanlines[dst++] = rgbaPixels[i * 4]!;
    }
    return assemblePng(width, height, colorType, scanlines, [], options);
  }
  if (colorType === 3) {
    const indexByKey = new Map<number, number>();
    const paletteRgb: number[] = [];
    const paletteAlpha: number[] = [];
    const indices = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const r = rgbaPixels[i * 4]!;
      const g = rgbaPixels[i * 4 + 1]!;
      const b = rgbaPixels[i * 4 + 2]!;
      const a = rgbaPixels[i * 4 + 3]!;
      const key = (r << 16) | (g << 8) | b;
      let index = indexByKey.get(key);
      if (index === undefined) {
        index = indexByKey.size;
        indexByKey.set(key, index);
        paletteRgb.push(r, g, b);
        paletteAlpha.push(a);
      }
      indices[i] = index;
    }
    const scanlines = new Uint8Array(height * (1 + width));
    for (let y = 0; y < height; y++) {
      const row = y * (1 + width);
      scanlines[row] = 0;
      scanlines.set(indices.subarray(y * width, (y + 1) * width), row + 1);
    }
    const extras = [
      chunk('PLTE', Uint8Array.from(paletteRgb)),
      chunk('tRNS', Uint8Array.from(paletteAlpha)),
    ];
    return assemblePng(width, height, colorType, scanlines, extras, options);
  }
  throw new Error(`test helper: unsupported color type ${String(colorType)}`);
}

describe('decodePng', () => {
  it('decodes a 2×2 RGBA image to exact pixels', () => {
    const pixels = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 128,
    ]);

    const decoded = decodePng(makePng(2, 2, pixels));

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  it('decodes RGB (color type 2) with alpha filled to 255', () => {
    // Input alpha (99/9) must be discarded by the type-2 encoder path.
    const pixels = Uint8Array.from([10, 20, 30, 99, 40, 50, 60, 9]);

    const decoded = decodePng(makePng(2, 1, pixels, { colorType: 2 }));

    expect(Array.from(decoded.pixels)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('decodes palette (color type 3) with tRNS alpha', () => {
    const pixels = Uint8Array.from([255, 0, 0, 128, 0, 0, 255, 255]);

    const decoded = decodePng(makePng(2, 1, pixels, { colorType: 3 }));

    expect(Array.from(decoded.pixels)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });

  it('decodes grayscale (color type 0) into r=g=b', () => {
    const pixels = Uint8Array.from([64, 64, 64, 255, 200, 200, 200, 255]);

    const decoded = decodePng(makePng(2, 1, pixels, { colorType: 0 }));

    expect(Array.from(decoded.pixels)).toEqual([64, 64, 64, 255, 200, 200, 200, 255]);
  });

  it('unfilters Sub (filter type 1) scanlines', () => {
    // 2×1 RGBA row: filter byte 1, first pixel literal, second stored as
    // the delta from its left neighbor.
    const scanline = Uint8Array.from([1, 10, 20, 30, 40, 5, 6, 7, 8]);

    const decoded = decodePng(assemblePng(2, 1, 6, scanline));

    expect(Array.from(decoded.pixels)).toEqual([10, 20, 30, 40, 15, 26, 37, 48]);
  });

  it('throws on a bad signature', () => {
    const png = makePng(2, 2, new Uint8Array(16));
    const bad = Uint8Array.from(png);
    bad[0] = 0x00;

    expect(() => decodePng(bad)).toThrow(/not a PNG/);
  });

  it('throws on interlaced PNGs', () => {
    const png = makePng(2, 2, new Uint8Array(16), { interlace: 1 });

    expect(() => decodePng(png)).toThrow(/interlaced PNGs are not supported/);
  });

  it('throws on truncated IDAT', () => {
    const png = makePng(4, 4, new Uint8Array(64));
    // Chop IEND plus the tail of the IDAT payload/CRC.
    const truncated = png.subarray(0, png.length - 15);

    expect(() => decodePng(truncated)).toThrow(/PNG/);
  });

  it('throws on oversized dimensions', () => {
    const png = makePng(5000, 1, new Uint8Array(5000 * 4));

    expect(() => decodePng(png)).toThrow(/invalid PNG dimensions/);
  });

  it('throws on a corrupt chunk CRC', () => {
    const png = makePng(2, 2, new Uint8Array(16), { corruptCrc: true });

    expect(() => decodePng(png)).toThrow(/CRC/);
  });
});
