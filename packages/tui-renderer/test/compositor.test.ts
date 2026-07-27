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
