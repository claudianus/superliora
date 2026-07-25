import { describe, expect, it } from 'vitest';

import {
  isJpegBuffer,
  isPngBuffer,
  readImageDimensions,
  readJpegDimensions,
  readPngDimensions,
  sharedPrefixLength,
  visualDiff,
} from '../../src/tools/visual-diff';

/** Minimal valid-looking PNG: signature + IHDR chunk header + width/height. */
function fakePng(width: number, height: number, payload = new Uint8Array([1, 2, 3])): Uint8Array {
  const out = new Uint8Array(8 + 4 + 4 + 4 + 4 + payload.length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // length of IHDR data (13) is not strictly required for our reader
  out[8] = 0;
  out[9] = 0;
  out[10] = 0;
  out[11] = 13;
  out[12] = 0x49; // I
  out[13] = 0x48; // H
  out[14] = 0x44; // D
  out[15] = 0x52; // R
  const view = new DataView(out.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  out.set(payload, 24);
  return out;
}

/**
 * Minimal JPEG: SOI + SOF0 (baseline) with width/height + EOI.
 * SOF0 payload: precision(1) + height(2) + width(2) + components(1) = 6 bytes min.
 */
function fakeJpeg(width: number, height: number, payload = new Uint8Array([9])): Uint8Array {
  // SOI(2) + FF C0 + len(2)=8 + precision + H + W + comps(1) + payload + EOI(2)
  const sofDataLen = 2 + 1 + 2 + 2 + 1; // length field includes itself
  const out = new Uint8Array(2 + 2 + sofDataLen + payload.length + 2);
  let o = 0;
  out[o++] = 0xff;
  out[o++] = 0xd8; // SOI
  out[o++] = 0xff;
  out[o++] = 0xc0; // SOF0
  out[o++] = (sofDataLen >> 8) & 0xff;
  out[o++] = sofDataLen & 0xff;
  out[o++] = 8; // precision
  out[o++] = (height >> 8) & 0xff;
  out[o++] = height & 0xff;
  out[o++] = (width >> 8) & 0xff;
  out[o++] = width & 0xff;
  out[o++] = 1; // components
  out.set(payload, o);
  o += payload.length;
  out[o++] = 0xff;
  out[o++] = 0xd9; // EOI
  return out;
}

describe('visualDiff', () => {
  it('detects identical buffers', () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const result = visualDiff(buf, buf);
    expect(result.identical).toBe(true);
    expect(result.status).toBe('identical');
    expect(result.lengthDelta).toBe(0);
    expect(result.sharedPrefixRatio).toBe(1);
    expect(result.summary).toContain('identical');
    expect(result.leftSha256).toBe(result.rightSha256);
  });

  it('detects different content of same length', () => {
    const left = new Uint8Array([1, 2, 3, 4]);
    const right = new Uint8Array([1, 2, 3, 5]);
    const result = visualDiff(left, right);
    expect(result.identical).toBe(false);
    expect(result.status).toBe('content_changed');
    expect(result.lengthDelta).toBe(0);
    expect(result.sharedPrefixBytes).toBe(3);
    expect(result.sharedPrefixRatio).toBeCloseTo(0.75);
    expect(result.summary).toContain('content changed');
  });

  it('detects size change', () => {
    const left = new Uint8Array([1, 2, 3]);
    const right = new Uint8Array([1, 2, 3, 4, 5]);
    const result = visualDiff(left, right);
    expect(result.identical).toBe(false);
    expect(result.status).toBe('size_changed');
    expect(result.lengthDelta).toBe(2);
    expect(result.summary).toContain('size changed');
  });

  it('parses PNG dimensions and flags dimension mismatch', () => {
    const left = fakePng(100, 50, new Uint8Array([9]));
    const right = fakePng(200, 50, new Uint8Array([9]));
    expect(isPngBuffer(left)).toBe(true);
    expect(readPngDimensions(left)).toEqual({ width: 100, height: 50 });
    const result = visualDiff(left, right);
    expect(result.identical).toBe(false);
    expect(result.status).toBe('dimension_mismatch');
    expect(result.left.width).toBe(100);
    expect(result.right.width).toBe(200);
    expect(result.left.format).toBe('png');
    expect(result.summary).toContain('100x50');
    expect(result.summary).toContain('200x50');
  });

  it('parses JPEG SOF0 dimensions and flags dimension mismatch', () => {
    const left = fakeJpeg(320, 240);
    const right = fakeJpeg(640, 240);
    expect(isJpegBuffer(left)).toBe(true);
    expect(readJpegDimensions(left)).toEqual({ width: 320, height: 240 });
    expect(readImageDimensions(left)).toEqual({ width: 320, height: 240 });
    const result = visualDiff(left, right);
    expect(result.identical).toBe(false);
    expect(result.status).toBe('dimension_mismatch');
    expect(result.left.format).toBe('jpeg');
    expect(result.left.width).toBe(320);
    expect(result.right.width).toBe(640);
    expect(result.summary).toContain('320x240');
    expect(result.summary).toContain('640x240');
  });

  it('sharedPrefixLength stops at first mismatch', () => {
    expect(sharedPrefixLength(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 9, 9]))).toBe(2);
    expect(sharedPrefixLength(new Uint8Array([1]), new Uint8Array([2]))).toBe(0);
  });
});
