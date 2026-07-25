import { describe, expect, it } from 'vitest';

import { visualDiff } from '../../src/tools/visual-diff';

describe('visual-diff MVP', () => {
  it('reports identical for equal buffers', () => {
    const a = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const result = visualDiff(a, b);
    expect(result.identical).toBe(true);
    expect(result.lengthDelta).toBe(0);
    expect(result.leftSha256).toBe(result.rightSha256);
    expect(result.note).toContain('MVP not pixel SSIM');
  });

  it('reports different when content changes', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    const result = visualDiff(a, b);
    expect(result.identical).toBe(false);
    expect(result.leftBytes).toBe(4);
    expect(result.rightBytes).toBe(4);
    expect(result.leftSha256).not.toBe(result.rightSha256);
  });

  it('reports lengthDelta when sizes differ', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const result = visualDiff(a, b);
    expect(result.identical).toBe(false);
    expect(result.lengthDelta).toBe(3);
  });
});
