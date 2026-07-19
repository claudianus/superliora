import { afterEach, describe, expect, it, vi } from 'vitest';

import { paintStarfield } from '#/tui/utils/night-sky';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function plainCanvas(canvas: readonly string[]): string[] {
  return canvas.map((line) => line.replaceAll(ANSI_SGR, ''));
}

describe('paintStarfield', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps star positions stable across elapsed time (twinkle only)', () => {
    // Hold twinkle open so visibility does not mask position stability.
    vi.spyOn(Math, 'sin').mockReturnValue(1);

    const width = 40;
    const rows = 12;
    const early = Array.from({ length: rows }, () => ' '.repeat(width));
    const late = Array.from({ length: rows }, () => ' '.repeat(width));
    const style = (glyph: string) => glyph;

    paintStarfield(early, width, rows, 0, 0.8, style);
    paintStarfield(late, width, rows, 900, 0.8, style);

    expect(plainCanvas(late)).toEqual(plainCanvas(early));
  });
});
