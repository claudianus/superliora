/**
 * Image dimensions for native prompt image compression. No npm dependency.
 */

function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function startsWith(buf: Buffer, prefix: Buffer | readonly number[]): boolean {
  const needle = Buffer.isBuffer(prefix) ? prefix : Buffer.from(prefix);
  if (buf.length < needle.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if (buf[i] !== needle[i]) return false;
  }
  return true;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Best-effort pixel-dimension reader for common raster formats.
 *
 * Inspects only the fixed region near the start of the file where each
 * format records its dimensions (the IHDR/DIB header, the RIFF chunk
 * after the `WEBP` tag, or the first JPEG SOFn segment). Returns `null`
 * for formats whose dimensions are not locatable from that region, or
 * when the supplied buffer is too short to cover it.
 */
export function sniffImageDimensions(data: Buffer | Uint8Array): ImageDimensions | null {
  const buf = toBuffer(data);

  // PNG — IHDR is the first chunk; width/height are big-endian uint32
  // at offsets 16 and 20.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF — logical-screen width/height are little-endian uint16 at
  // offsets 6 and 8.
  if (
    (startsWith(buf, Buffer.from('GIF87a')) || startsWith(buf, Buffer.from('GIF89a'))) &&
    buf.length >= 10
  ) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // BMP — DIB header width/height are little-endian int32 at offsets 18
  // and 22 (height may be negative for top-down bitmaps).
  if (startsWith(buf, Buffer.from('BM')) && buf.length >= 26) {
    return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  }

  // WEBP — RIFF container; VP8/VP8L/VP8X each store dimensions
  // differently in the chunk that follows the 'WEBP' tag.
  if (startsWith(buf, Buffer.from('RIFF')) && buf.length >= 30) {
    const fourCc = buf.subarray(12, 16).toString('latin1');
    if (fourCc === 'VP8 ') {
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (fourCc === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (fourCc === 'VP8X') {
      const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
      const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
      return { width, height };
    }
  }

  // JPEG — scan segment markers for a Start-Of-Frame (SOFn) marker,
  // whose payload carries height/width as big-endian uint16.
  if (startsWith(buf, [0xff, 0xd8])) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1]!;
      // SOFn markers carry frame dimensions; skip SOF4/SOF8/SOF12 (0xc4/0xc8/0xcc).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      // Standalone markers (RSTn, SOI, EOI) carry no length field.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLength = buf.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }

  return null;
}
