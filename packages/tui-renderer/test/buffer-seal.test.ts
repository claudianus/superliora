import { describe, expect, it } from 'vitest';

import {
  countCellsMissingBackground,
  RendererCellBuffer,
  sealRendererBufferBackground,
} from '../src';

describe('sealRendererBufferBackground', () => {
  it('paints canvas bg onto EMPTY cells and leaves styled cells alone', () => {
    const buffer = new RendererCellBuffer(4, 2);
    buffer.setCell(0, 0, { char: 'a', style: { bg: '#ff0000' } });
    const fill = { char: ' ', style: { bg: '#0b0f14' } };

    expect(countCellsMissingBackground(buffer)).toBe(7);
    expect(sealRendererBufferBackground(buffer, fill)).toBe(7);
    expect(countCellsMissingBackground(buffer)).toBe(0);
    expect(buffer.getCell(0, 0).style?.bg).toBe('#ff0000');
    expect(buffer.getCell(1, 0).style?.bg).toBe('#0b0f14');
    expect(sealRendererBufferBackground(buffer, fill)).toBe(0);
  });

  it('is a no-op when fill has no background', () => {
    const buffer = new RendererCellBuffer(2, 1);
    expect(sealRendererBufferBackground(buffer, { char: ' ' })).toBe(0);
    expect(countCellsMissingBackground(buffer)).toBe(2);
  });
});
