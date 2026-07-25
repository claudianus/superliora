import { describe, expect, it } from 'vitest';

import {
  isPngBuffer,
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
    expect(result.summary).toContain('100x50');
    expect(result.summary).toContain('200x50');
  });

  it('sharedPrefixLength stops at first mismatch', () => {
    expect(sharedPrefixLength(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 9, 9]))).toBe(2);
    expect(sharedPrefixLength(new Uint8Array([1]), new Uint8Array([2]))).toBe(0);
  });
});
