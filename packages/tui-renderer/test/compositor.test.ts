import { describe, expect, it } from 'vitest';

import {
  composeRendererRegions,
  RendererCellBuffer,
  RendererCompositionCache,
  type RendererRegionLayer,
} from '../src';

describe('RendererCompositionCache topology signature', () => {
  const region: RendererRegionLayer = {
    id: 'fixed',
    rect: { x: 2, y: 1, width: 20, height: 3 },
    lines: ['alpha', 'beta', 'gamma'],
  };

  it('reuses composed rows across a buffer resize with unchanged layer topology', () => {
    const cache = new RendererCompositionCache();

    const first = new RendererCellBuffer(80, 24);
    cache.beginFrame({ bufferWidth: 80, bufferHeight: 24, layers: [region] });
    composeRendererRegions(first, [region], { cache, reuseCachedRows: true });
    const firstStats = cache.snapshot();
    expect(firstStats.rowsComposed).toBe(3);
    expect(firstStats.rowsReused).toBe(0);

    // Same layer content and rect, wider buffer: the topology signature must
    // not encode the buffer size, so every row is reused.
    const second = new RendererCellBuffer(100, 24);
    const reusable = cache.beginFrame({ bufferWidth: 100, bufferHeight: 24, layers: [region] });
    expect(reusable).toBe(true);
    composeRendererRegions(second, [region], { cache, reuseCachedRows: true });
    const secondStats = cache.snapshot();
    expect(secondStats.rowsReused).toBe(3);
    expect(secondStats.rowsComposed).toBe(0);
  });

  it('still invalidates rows when layer geometry changes', () => {
    const cache = new RendererCompositionCache();
    const buffer = new RendererCellBuffer(80, 24);
    cache.beginFrame({ bufferWidth: 80, bufferHeight: 24, layers: [region] });
    composeRendererRegions(buffer, [region], { cache, reuseCachedRows: true });

    const moved: RendererRegionLayer = {
      ...region,
      rect: { x: 3, y: 1, width: 20, height: 3 },
    };
    const reusable = cache.beginFrame({ bufferWidth: 80, bufferHeight: 24, layers: [moved] });
    expect(reusable).toBe(false);
    composeRendererRegions(buffer, [moved], { cache, reuseCachedRows: true });
    expect(cache.snapshot().rowsComposed).toBe(3);
    expect(cache.snapshot().rowsReused).toBe(0);
  });

  it('never reuses rows whose width changed', () => {
    const cache = new RendererCompositionCache();
    const fullWidth: RendererRegionLayer = {
      id: 'full',
      rect: { x: 0, y: 0, width: 80, height: 2 },
      lines: ['x'.repeat(80), 'y'.repeat(80)],
    };
    const first = new RendererCellBuffer(80, 24);
    cache.beginFrame({ bufferWidth: 80, bufferHeight: 24, layers: [fullWidth] });
    composeRendererRegions(first, [fullWidth], { cache, reuseCachedRows: true });

    // Wider buffer AND wider region: the row key hashes the clipped width,
    // so even with a matching topology nothing may reuse.
    const wider: RendererRegionLayer = {
      ...fullWidth,
      rect: { x: 0, y: 0, width: 100, height: 2 },
      lines: ['x'.repeat(100), 'y'.repeat(100)],
    };
    const second = new RendererCellBuffer(100, 24);
    cache.beginFrame({ bufferWidth: 100, bufferHeight: 24, layers: [wider] });
    composeRendererRegions(second, [wider], { cache, reuseCachedRows: true });
    expect(cache.snapshot().rowsReused).toBe(0);
    expect(cache.snapshot().rowsComposed).toBe(2);
  });
});

describe('RendererCompositionCache topology ignores paint-mode / VFX churn', () => {
  it('reuses topology when only clear/background/vfx change (ambient tick hole)', () => {
    // clear + letterbox chase VFX used to be part of the topology signature.
    // Every ambient tick then forced beginFrame(clear) → black bands / vanished
    // prompt glyphs on ConPTY while the soft buffer still held text.
    const cache = new RendererCompositionCache();
    const base: RendererRegionLayer = {
      id: 'editor',
      rect: { x: 0, y: 10, width: 40, height: 3 },
      lines: ['> hello', '  world', ''],
      clear: false,
      background: { char: ' ', style: { bg: '#0b0f14' } },
    };
    const first = new RendererCellBuffer(80, 24);
    cache.beginFrame({ bufferWidth: 80, bufferHeight: 24, layers: [base] });
    composeRendererRegions(first, [base], { cache, reuseCachedRows: true });

    const ambient: RendererRegionLayer = {
      ...base,
      clear: true,
      background: { char: ' ', style: { bg: '#111111' } },
      vfx: {
        effect: {
          kind: 'pulse',
          nowMs: 1_234,
          color: '#ff00aa',
        },
      },
    };
    const reusable = cache.beginFrame({
      bufferWidth: 80,
      bufferHeight: 24,
      layers: [ambient],
    });
    expect(reusable).toBe(true);

    // Row keys still include clear/vfx so changed paint modes recompose.
    composeRendererRegions(first, [ambient], { cache, reuseCachedRows: true });
    expect(cache.snapshot().rowsComposed).toBe(3);
    expect(cache.snapshot().rowsReused).toBe(0);
  });
});

describe('composeRendererRegions missing-line background fill', () => {
  it('fills region background for undefined lines when clear:false', () => {
    // Short content inside a taller rect used to leave EMPTY_CELL (no bg) —
    // black horizontal band between stack regions / inside tall editor.
    const bg = { char: ' ', style: { bg: '#0b0f14' } };
    const buffer = new RendererCellBuffer(10, 6, { char: 'X', style: { bg: '#ff0000' } });
    const region: RendererRegionLayer = {
      id: 'editor',
      rect: { x: 0, y: 1, width: 10, height: 4 },
      lines: ['hello'],
      clear: false,
      background: bg,
    };
    composeRendererRegions(buffer, [region]);

    // Painted content row
    expect(buffer.getCell(0, 1).char).toBe('h');
    // Missing rows inside rect must take region.background, not prior buffer/X
    for (const y of [2, 3, 4]) {
      for (let x = 0; x < 10; x++) {
        expect(buffer.getCell(x, y).char).toBe(' ');
        expect(buffer.getCell(x, y).style?.bg).toBe('#0b0f14');
      }
    }
    // Outside the region stays the prior fill
    expect(buffer.getCell(0, 0).char).toBe('X');
    expect(buffer.getCell(0, 5).char).toBe('X');
  });

  it('does not double-fill missing rows when clear:true already wiped the rect', () => {
    const bg = { char: ' ', style: { bg: '#101010' } };
    const buffer = new RendererCellBuffer(8, 4, { char: 'Z' });
    const region: RendererRegionLayer = {
      id: 'stack',
      rect: { x: 0, y: 0, width: 8, height: 3 },
      lines: ['ab'],
      clear: true,
      background: bg,
    };
    composeRendererRegions(buffer, [region]);
    expect(buffer.getCell(0, 0).char).toBe('a');
    expect(buffer.getCell(0, 1).style?.bg).toBe('#101010');
    expect(buffer.getCell(0, 2).style?.bg).toBe('#101010');
  });
});
