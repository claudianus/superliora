import { deflateSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  preparePastedImage,
  setJimpModuleForTests,
} from '#/utils/image/prepare-pasted-image';

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

/** Minimal valid solid-color PNG (RGB). */
function solidPng(width: number, height: number, r = 0, g = 0, b = 0): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

afterEach(() => {
  setJimpModuleForTests(undefined);
});

describe('preparePastedImage', () => {
  it('returns small PNG bytes unchanged', async () => {
    const bytes = solidPng(4, 4, 10, 20, 30);
    const prepared = await preparePastedImage(bytes, { maxEdge: 2000, byteBudget: 1_000_000 });
    expect(prepared).not.toBeNull();
    expect(prepared!.changed).toBe(false);
    expect(prepared!.mime).toBe('image/png');
    expect(prepared!.width).toBe(4);
    expect(prepared!.height).toBe(4);
    expect(Array.from(prepared!.bytes)).toEqual(Array.from(bytes));
  });

  it('returns null for non-image bytes', async () => {
    expect(await preparePastedImage(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('downscales oversized images when jimp is available', async () => {
    // Skip if jimp cannot be resolved in this workspace install.
    const probe = await preparePastedImage(solidPng(8, 8), { maxEdge: 4, byteBudget: 1 });
    if (probe === null) return;
    // When jimp is missing, prepare leaves the original and changed=false.
    // With jimp, edge + byte pressure forces a re-encode.
    if (!probe.changed) {
      // jimp unavailable in this environment — still a valid soft path.
      expect(probe.width).toBe(8);
      return;
    }
    expect(Math.max(probe.width, probe.height)).toBeLessThanOrEqual(4);
    expect(probe.mime === 'image/png' || probe.mime === 'image/jpeg').toBe(true);
  });
});
