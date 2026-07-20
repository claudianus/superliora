/**
 * Minimal dependency-free PNG decoder for transcript image previews.
 *
 * Supports 8-bit non-interlaced images in the five standard color types
 * (gray, RGB, palette, gray+alpha, RGBA), multiple IDAT chunks, and all
 * five scanline filters. Output is top-down RGBA. Any invalid input
 * throws an `Error` with a short message; callers (e.g. `ImageThumbnail`)
 * fall back to a text marker on failure.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, top-down. */
  readonly pixels: Uint8ClampedArray;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_777_216;

// CRC32 (IEEE 802.3, reflected polynomial 0xedb88320), table-driven.
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
  // Signed int32; compared against `getInt32` of the stored CRC.
  return Math.trunc(crc ^ 0xffff_ffff);
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('not a PNG');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  let colorType = -1;
  let sawHeader = false;
  let palette: Uint8Array | undefined;
  let paletteAlpha: Uint8Array | undefined;
  const idatChunks: Uint8Array[] = [];

  let offset = 8;
  let done = false;
  while (!done) {
    // Every chunk needs length (4) + type (4) + at least CRC (4).
    if (offset + 12 > bytes.length) throw new Error('truncated PNG');
    const length = view.getUint32(offset);
    const type = String.fromCodePoint(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('truncated PNG');
    const storedCrc = view.getInt32(dataEnd);
    if (crc32(bytes, offset + 4, dataEnd) !== storedCrc) {
      throw new Error('invalid PNG chunk CRC');
    }

    switch (type) {
      case 'IHDR': {
        if (length !== 13) throw new Error('invalid PNG IHDR');
        width = view.getUint32(dataStart);
        height = view.getUint32(dataStart + 4);
        const bitDepth = bytes[dataStart + 8]!;
        colorType = bytes[dataStart + 9]!;
        const compression = bytes[dataStart + 10]!;
        const filterMethod = bytes[dataStart + 11]!;
        const interlace = bytes[dataStart + 12]!;
        if (
          width < 1 ||
          height < 1 ||
          width > MAX_DIMENSION ||
          height > MAX_DIMENSION ||
          width * height > MAX_PIXELS
        ) {
          throw new Error('invalid PNG dimensions');
        }
        if (bitDepth !== 8) throw new Error('unsupported PNG bit depth');
        if (compression !== 0 || filterMethod !== 0) {
          throw new Error('unsupported PNG compression');
        }
        if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
        channels = channelsForColorType(colorType);
        sawHeader = true;
        break;
      }
      case 'PLTE': {
        if (length % 3 !== 0) throw new Error('invalid PNG PLTE');
        palette = bytes.subarray(dataStart, dataEnd);
        break;
      }
      case 'tRNS': {
        // Only palette alpha is needed here; color-key transparency for
        // gray/RGB is ignored (previews do not composite against a bg).
        paletteAlpha = bytes.subarray(dataStart, dataEnd);
        break;
      }
      case 'IDAT': {
        idatChunks.push(bytes.subarray(dataStart, dataEnd));
        break;
      }
      case 'IEND': {
        done = true;
        break;
      }
      default: {
        // Unknown ancillary chunks are skipped.
        break;
      }
    }
    offset = dataEnd + 4;
  }

  if (!sawHeader) throw new Error('missing PNG IHDR');
  if (idatChunks.length === 0) throw new Error('missing PNG IDAT');
  if (colorType === 3 && palette === undefined) throw new Error('missing PNG PLTE');

  let raw: Uint8Array;
  try {
    raw = inflateSync(concat(idatChunks));
  } catch {
    throw new Error('invalid PNG image data');
  }
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error('invalid PNG image data');

  const unfiltered = unfilter(raw, width, height, channels);
  const pixels = expandToRgba(unfiltered, width, height, colorType, palette, paletteAlpha);
  return { width, height, pixels };
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0: // gray
      return 1;
    case 2: // RGB
      return 3;
    case 3: // palette
      return 1;
    case 4: // gray + alpha
      return 2;
    case 6: // RGBA
      return 4;
    default:
      throw new Error('unsupported PNG color type');
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

/** Reverse the per-scanline PNG filters (0=None 1=Sub 2=Up 3=Average 4=Paeth). */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]!;
    pos += 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const current = raw[pos]!;
      pos += 1;
      const left = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const up = y > 0 ? out[prevStart + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp]! : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = current;
          break;
        case 1:
          value = current + left;
          break;
        case 2:
          value = current + up;
          break;
        case 3:
          value = current + ((left + up) >> 1);
          break;
        case 4:
          value = current + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter: ${String(filter)}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function expandToRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | undefined,
  paletteAlpha: Uint8Array | undefined,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let src = 0;
  let dst = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    switch (colorType) {
      case 0: {
        const v = raw[src]!;
        pixels[dst] = v;
        pixels[dst + 1] = v;
        pixels[dst + 2] = v;
        pixels[dst + 3] = 255;
        src += 1;
        break;
      }
      case 2: {
        pixels[dst] = raw[src]!;
        pixels[dst + 1] = raw[src + 1]!;
        pixels[dst + 2] = raw[src + 2]!;
        pixels[dst + 3] = 255;
        src += 3;
        break;
      }
      case 3: {
        const index = raw[src]!;
        const entry = index * 3;
        if (palette === undefined || entry + 2 >= palette.length) {
          throw new Error('invalid PNG palette index');
        }
        pixels[dst] = palette[entry]!;
        pixels[dst + 1] = palette[entry + 1]!;
        pixels[dst + 2] = palette[entry + 2]!;
        pixels[dst + 3] =
          paletteAlpha !== undefined && index < paletteAlpha.length ? paletteAlpha[index]! : 255;
        src += 1;
        break;
      }
      case 4: {
        const v = raw[src]!;
        pixels[dst] = v;
        pixels[dst + 1] = v;
        pixels[dst + 2] = v;
        pixels[dst + 3] = raw[src + 1]!;
        src += 2;
        break;
      }
      default: {
        // colorType 6 (RGBA) — the validator rejects anything else.
        pixels[dst] = raw[src]!;
        pixels[dst + 1] = raw[src + 1]!;
        pixels[dst + 2] = raw[src + 2]!;
        pixels[dst + 3] = raw[src + 3]!;
        src += 4;
        break;
      }
    }
    dst += 4;
  }
  return pixels;
}
