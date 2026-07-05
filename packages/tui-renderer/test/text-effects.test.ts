import { describe, expect, it } from 'vitest';

import {
  createRendererGradientTextCells,
  createRendererGradientTextRuns,
  hashRendererEffectSeed,
  rendererPositiveModulo,
  resolveRendererSeededIndex,
} from '../src';

describe('renderer text effects', () => {
  it('hashes effect seeds deterministically', () => {
    expect(hashRendererEffectSeed('session-a')).toBe(hashRendererEffectSeed('session-a'));
    expect(hashRendererEffectSeed('session-a')).not.toBe(hashRendererEffectSeed('session-b'));
  });

  it('resolves seeded indices with stable modulo wrapping', () => {
    expect(rendererPositiveModulo(-1, 4)).toBe(3);
    expect(resolveRendererSeededIndex({
      seed: 'loader',
      nowMs: 250,
      intervalMs: 100,
      length: 4,
    })).toBe((Math.floor(250 / 100) + hashRendererEffectSeed('loader')) % 4);
  });

  it('creates per-grapheme gradient runs and cells', () => {
    const runs = createRendererGradientTextRuns('ab', {
      from: '#111111',
      to: '#eeeeee',
      bold: false,
    });

    expect(runs.map((run) => run.text)).toEqual(['a', 'b']);
    expect(runs[0]?.style.fg).toBe('#111111');
    expect(runs[1]?.style.fg).toBe('#eeeeee');
    expect(runs.every((run) => run.style.bold === undefined)).toBe(true);

    const cells = createRendererGradientTextCells('x', {
      from: '#000000',
      to: '#ffffff',
    });
    expect(cells).toEqual([{ char: 'x', style: { fg: '#000000', bold: true } }]);
  });
});
