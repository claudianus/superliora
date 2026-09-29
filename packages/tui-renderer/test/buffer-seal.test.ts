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

  it('falls back to a full walk when the caller cannot vouch for damage', () => {
    // An empty scope means "nothing was tracked", not "nothing needs sealing" —
    // a freshly cleared buffer is exactly this case.
    const buffer = new RendererCellBuffer(3, 2);
    const fill = { char: ' ', style: { bg: '#0b0f14' } };

    expect(sealRendererBufferBackground(buffer, fill, new Map())).toBe(6);
    expect(countCellsMissingBackground(buffer)).toBe(0);
  });

  it('damage-scoped sealing matches a full walk on the same writes', () => {
    const fill = { char: ' ', style: { bg: '#0b0f14' } };
    const build = (seed: (buffer: RendererCellBuffer) => void): RendererCellBuffer => {
      const buffer = new RendererCellBuffer(6, 4);
      buffer.clear(fill);
      seed(buffer);
      return buffer;
    };
    const seed = (buffer: RendererCellBuffer): void => {
      buffer.writeText(0, 1, 'hello');
      buffer.fillRect({ x: 3, y: 2, width: 3, height: 1 });
      buffer.setCell(5, 3, { char: 'x' });
    };
    // Scope the first buffer, leave the second unscoped.
    const scoped = build(seed);
    const scopedSealed = sealRendererBufferBackground(
      scoped,
      fill,
      scoped.sealRowScopes,
    );
    const full = build(seed);
    const fullSealed = sealRendererBufferBackground(full, fill);

    expect(scopedSealed).toBe(fullSealed);
    expect(countCellsMissingBackground(scoped)).toBe(0);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        expect(scoped.getCell(x, y)).toEqual(full.getCell(x, y));
      }
    }
  });

  it('seals only the rewritten row and leaves earlier-sealed rows alone', () => {
    // Row 0 keeps its background from an earlier seal; only row 1 is rewritten
    // with bg-less cells, so a scoped seal fixes row 1 (4 cells of "rewritten")
    // and never revisits row 0.
    const fill = { char: ' ', style: { bg: '#0b0f14' } };
    const buffer = new RendererCellBuffer(4, 2);
    buffer.clear(fill);
    buffer.resetDamage();
    sealRendererBufferBackground(buffer, fill, buffer.sealRowScopes);
    expect(countCellsMissingBackground(buffer)).toBe(0);

    buffer.writeText(0, 1, 'rewritten');
    const sealed = sealRendererBufferBackground(buffer, fill, buffer.sealRowScopes);

    expect(sealed).toBe(4);
    expect(countCellsMissingBackground(buffer)).toBe(0);
    expect(buffer.getCell(0, 0).style?.bg).toBe('#0b0f14');
    expect(buffer.getCell(0, 1).style?.bg).toBe('#0b0f14');
  });
});
