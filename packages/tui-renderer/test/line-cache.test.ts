import { describe, expect, it } from 'vitest';

import {
  composeRendererRegions,
  NativeFrameRenderer,
  RendererCellBuffer,
  RendererCompositionCache,
  RendererLineCellCache,
  promoteRendererRegionLinesToCells,
  renderNativeLayoutFrame,
} from '../src';

describe('RendererLineCellCache', () => {
  it('reuses parsed ANSI cell lines across composition passes', () => {
    const cache = new RendererLineCellCache();
    const first = new RendererCellBuffer(2, 1);
    const second = new RendererCellBuffer(2, 1);
    const layer = {
      rect: { x: 0, y: 0, width: 2, height: 1 },
      lines: ['a\u001B[31mb'],
    };

    const firstStats = composeRendererRegions(first, [layer], { lineCache: cache });
    const secondStats = composeRendererRegions(second, [layer], { lineCache: cache });

    expect(firstStats.lineCache).toMatchObject({ hits: 0, misses: 1, entries: 1 });
    expect(firstStats.lineCacheFrame).toEqual({
      hits: 0,
      misses: 1,
      evictions: 0,
      hitRatio: 0,
    });
    expect(secondStats.lineCache).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    expect(secondStats.lineCacheFrame).toEqual({
      hits: 1,
      misses: 0,
      evictions: 0,
      hitRatio: 1,
    });
    expect(second.getCell(1, 0)).toEqual({ char: 'b', style: { fg: '#800000' } });
  });

  it('keeps region-level styles as part of the cache key', () => {
    const cache = new RendererLineCellCache();
    const buffer = new RendererCellBuffer(1, 2);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 1, height: 1 },
        style: { fg: '#111111' },
        lines: ['x'],
      },
      {
        rect: { x: 0, y: 1, width: 1, height: 1 },
        style: { fg: '#222222' },
        lines: ['x'],
      },
    ], { lineCache: cache });

    expect(cache.snapshot()).toMatchObject({ entries: 2, hits: 0, misses: 2 });
    expect(buffer.getCell(0, 0)).toEqual({ char: 'x', style: { fg: '#111111' } });
    expect(buffer.getCell(0, 1)).toEqual({ char: 'x', style: { fg: '#222222' } });
  });

  it('preserves cell hyperlink and wide-cell metadata when merging region styles', () => {
    const cache = new RendererLineCellCache();
    const buffer = new RendererCellBuffer(2, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 2, height: 1 },
        style: { fg: '#111111' },
        lines: [[{ char: '한', width: 2, link: 'https://example.com' }, {
          char: '',
          width: 0,
          continuation: true,
          link: 'https://example.com',
        }]],
      },
    ], { lineCache: cache });

    expect(buffer.getCell(0, 0)).toEqual({
      char: '한',
      width: 2,
      style: { fg: '#111111' },
      link: 'https://example.com',
    });
    expect(buffer.getCell(1, 0)).toEqual({
      char: '',
      width: 0,
      continuation: true,
      style: { fg: '#111111' },
      link: 'https://example.com',
    });
  });

  it('evicts least recently used entries when bounded', () => {
    const cache = new RendererLineCellCache({ maxEntries: 2 });
    const buffer = new RendererCellBuffer(1, 1);

    for (const line of ['a', 'b', 'c']) {
      composeRendererRegions(buffer, [
        { rect: { x: 0, y: 0, width: 1, height: 1 }, lines: [line] },
      ], { lineCache: cache });
    }

    expect(cache.snapshot()).toMatchObject({ entries: 2, misses: 3, evictions: 1 });
  });

  it('evicts least recently used entries when the parsed cell budget is exceeded', () => {
    const cache = new RendererLineCellCache({ maxEntries: 10, maxCells: 3 });
    const buffer = new RendererCellBuffer(2, 1);

    for (const line of ['ab', 'cd']) {
      composeRendererRegions(buffer, [
        { rect: { x: 0, y: 0, width: 2, height: 1 }, lines: [line] },
      ], { lineCache: cache });
    }

    expect(cache.snapshot()).toMatchObject({
      entries: 1,
      cells: 2,
      misses: 2,
      evictions: 1,
    });
  });

  it('does not retain a single parsed line larger than the cell budget', () => {
    const cache = new RendererLineCellCache({ maxCells: 2 });
    const buffer = new RendererCellBuffer(3, 1);
    const layer = { rect: { x: 0, y: 0, width: 3, height: 1 }, lines: ['abc'] };

    composeRendererRegions(buffer, [layer], { lineCache: cache });
    composeRendererRegions(buffer, [layer], { lineCache: cache });

    expect(cache.snapshot()).toMatchObject({
      entries: 0,
      cells: 0,
      hits: 0,
      misses: 2,
      evictions: 0,
    });
  });

  it('clears retained cell count with cached entries', () => {
    const cache = new RendererLineCellCache();
    const buffer = new RendererCellBuffer(2, 1);

    composeRendererRegions(buffer, [
      { rect: { x: 0, y: 0, width: 2, height: 1 }, lines: ['ok'] },
    ], { lineCache: cache });
    cache.clear();

    expect(cache.snapshot()).toMatchObject({ entries: 0, cells: 0, misses: 1 });
  });

  it('feeds cache stats through native layout frame rendering', () => {
    const cache = new RendererLineCellCache();
    const renderer = new NativeFrameRenderer({
      width: 2,
      height: 1,
      output: { write: () => {} },
    });
    const regions = [{ rect: { x: 0, y: 0, width: 2, height: 1 }, content: ['ok'] }];

    renderNativeLayoutFrame(renderer, regions, { composition: { lineCache: cache } });
    const second = renderNativeLayoutFrame(renderer, regions, { composition: { lineCache: cache } });

    expect(second.composition.lineCache).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    expect(second.composition.lineCacheFrame).toMatchObject({ hits: 1, misses: 0, hitRatio: 1 });
    expect(second.output).toBe('');
  });
});

describe('RendererCompositionCache', () => {
  it('reuses unchanged opaque rows without rewriting cells', () => {
    const cache = new RendererCompositionCache();
    const buffer = new RendererCellBuffer(4, 2);
    const layer = {
      rect: { x: 0, y: 0, width: 4, height: 2 },
      clear: true,
      lines: ['aa', 'bb'],
    };

    const firstReusable = cache.beginFrame({
      bufferWidth: buffer.width,
      bufferHeight: buffer.height,
      layers: [layer],
    });
    const first = composeRendererRegions(buffer, [layer], {
      cache,
      reuseCachedRows: firstReusable,
    });
    buffer.resetDamage();

    const secondReusable = cache.beginFrame({
      bufferWidth: buffer.width,
      bufferHeight: buffer.height,
      layers: [layer],
    });
    const second = composeRendererRegions(buffer, [layer], {
      cache,
      reuseCachedRows: secondReusable,
    });

    expect(firstReusable).toBe(false);
    expect(first.compositionCache).toMatchObject({
      entries: 2,
      rowsComposed: 2,
      rowsReused: 0,
    });
    expect(secondReusable).toBe(true);
    expect(second).toMatchObject({
      rowsVisited: 2,
      rowsComposed: 0,
      rowsReused: 2,
      cellsWritten: 0,
    });
    expect(buffer.damage).toBeNull();
  });

  it('composes only the changed row when one cached row key changes', () => {
    const cache = new RendererCompositionCache();
    const buffer = new RendererCellBuffer(4, 2);
    const firstLayer = {
      rect: { x: 0, y: 0, width: 4, height: 2 },
      clear: true,
      lines: ['same', 'old'],
    };
    const secondLayer = {
      rect: { x: 0, y: 0, width: 4, height: 2 },
      clear: true,
      lines: ['same', 'new'],
    };

    cache.beginFrame({ bufferWidth: 4, bufferHeight: 2, layers: [firstLayer] });
    composeRendererRegions(buffer, [firstLayer], { cache });
    buffer.resetDamage();

    const reusable = cache.beginFrame({ bufferWidth: 4, bufferHeight: 2, layers: [secondLayer] });
    const second = composeRendererRegions(buffer, [secondLayer], {
      cache,
      reuseCachedRows: reusable,
    });

    expect(reusable).toBe(true);
    expect(second.rowsReused).toBe(1);
    expect(second.rowsComposed).toBe(1);
    expect(second.cellsWritten).toBe(3);
    expect(buffer.dirtyRowSpans).toEqual([{ y: 1, x: 0, width: 4 }]);
  });

  it('feeds retained row reuse through native layout frame rendering', () => {
    const cache = new RendererCompositionCache();
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: () => {} },
    });
    const regions = [
      {
        rect: { x: 0, y: 0, width: 4, height: 1 },
        clear: true,
        content: ['ok'],
      },
    ];

    const first = renderNativeLayoutFrame(renderer, regions, { composition: { cache } });
    const second = renderNativeLayoutFrame(renderer, regions, { composition: { cache } });

    expect(first.composition.compositionCache).toMatchObject({
      rowsComposed: 1,
      rowsReused: 0,
    });
    expect(second.composition).toMatchObject({
      rowsVisited: 1,
      rowsComposed: 0,
      rowsReused: 1,
      cellsWritten: 0,
    });
    expect(second.output).toBe('');
  });

  it('invalidates opaque row reuse when a lower layer row changes underneath', () => {
    const cache = new RendererCompositionCache();
    const buffer = new RendererCellBuffer(5, 1);
    const baseLayer = {
      rect: { x: 0, y: 0, width: 5, height: 1 },
      clear: true,
      zIndex: 0,
      lines: ['aaaaa'],
    };
    const overlayLayer = {
      rect: { x: 0, y: 0, width: 5, height: 1 },
      clear: true,
      zIndex: 10,
      lines: ['.....'],
    };

    cache.beginFrame({ bufferWidth: 5, bufferHeight: 1, layers: [baseLayer, overlayLayer] });
    composeRendererRegions(buffer, [baseLayer, overlayLayer], { cache });
    buffer.resetDamage();

    cache.beginFrame({ bufferWidth: 5, bufferHeight: 1, layers: [baseLayer, overlayLayer] });
    const reused = composeRendererRegions(buffer, [baseLayer, overlayLayer], {
      cache,
      reuseCachedRows: true,
    });
    expect(reused.rowsReused).toBeGreaterThan(0);

    const changedBase = { ...baseLayer, lines: ['bbbbb'] };
    cache.beginFrame({ bufferWidth: 5, bufferHeight: 1, layers: [changedBase, overlayLayer] });
    const afterBaseChange = composeRendererRegions(buffer, [changedBase, overlayLayer], {
      cache,
      reuseCachedRows: true,
    });

    expect(afterBaseChange.rowsReused).toBe(0);
    expect(afterBaseChange.rowsComposed).toBe(2);
    expect(buffer.getCell(0, 0).char).toBe('.');
  });

  it('promotes ANSI string region lines into parsed cell lines', () => {
    const lines = promoteRendererRegionLinesToCells(['a\u001B[31mb', [{ char: 'x' }]]);

    expect(typeof lines[0]).not.toBe('string');
    expect(lines[1]).toEqual([{ char: 'x' }]);
    expect((lines[0] as readonly { char: string; style?: { fg?: string } }[])[1]?.style?.fg).toBeDefined();
  });

  it('reuses unchanged rows for semi-transparent regions when the underlay is stable', () => {
    const cache = new RendererCompositionCache();
    const buffer = new RendererCellBuffer(5, 1);
    const baseLayer = {
      rect: { x: 0, y: 0, width: 5, height: 1 },
      zIndex: 0,
      lines: ['aaaaa'],
    };
    const overlayLayer = {
      rect: { x: 0, y: 0, width: 5, height: 1 },
      zIndex: 10,
      clear: false,
      lines: ['.....'],
    };

    cache.beginFrame({ bufferWidth: 5, bufferHeight: 1, layers: [baseLayer, overlayLayer] });
    composeRendererRegions(buffer, [baseLayer, overlayLayer], { cache });
    buffer.resetDamage();

    cache.beginFrame({ bufferWidth: 5, bufferHeight: 1, layers: [baseLayer, overlayLayer] });
    const reused = composeRendererRegions(buffer, [baseLayer, overlayLayer], {
      cache,
      reuseCachedRows: true,
    });

    expect(reused.rowsReused).toBe(2);
    expect(reused.rowsComposed).toBe(0);
  });
});
