import type {
  RendererCell,
  RendererCellBuffer,
  RendererCellStyle,
  RendererDamageRect,
} from './cell-buffer';
import {
  applyRendererCellVfx,
  type RendererCellVfxOptions,
} from './cell-vfx';
import {
  rendererLineToCells,
  type RendererLineCellCache,
  type RendererLineCellCacheStats,
} from './line-cache';

export type RendererRect = RendererDamageRect;

export type RendererRegionLine = string | readonly RendererCell[];

export interface RendererRegionVfx {
  readonly effect: RendererCellVfxOptions;
  readonly rect?: RendererRect;
}

export interface RendererRegionLayer {
  readonly id?: string;
  readonly rect: RendererRect;
  readonly lines: readonly RendererRegionLine[];
  readonly zIndex?: number;
  readonly visible?: boolean;
  readonly scrollY?: number;
  readonly style?: RendererCellStyle;
  readonly clear?: boolean;
  readonly background?: RendererCell;
  readonly vfx?: RendererRegionVfx;
}

export interface RendererCompositionCacheFrame {
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly layers: readonly RendererRegionLayer[];
}

export interface RendererCompositionCacheStats {
  readonly entries: number;
  readonly rowsComposed: number;
  readonly rowsReused: number;
  readonly resets: number;
}

export interface RendererLineCellCacheFrameStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly hitRatio: number;
}

export interface RendererCompositionStats {
  readonly regions: number;
  readonly rowsVisited: number;
  readonly rowsComposed: number;
  readonly rowsReused: number;
  readonly cellsWritten: number;
  readonly cellsClipped: number;
  readonly lineCache?: RendererLineCellCacheStats;
  readonly lineCacheFrame?: RendererLineCellCacheFrameStats;
  readonly compositionCache?: RendererCompositionCacheStats;
}

export interface RendererCompositionOptions {
  readonly lineCache?: RendererLineCellCache;
  readonly cache?: RendererCompositionCache;
  readonly reuseCachedRows?: boolean;
}

interface OrderedRegion {
  readonly region: RendererRegionLayer;
  readonly index: number;
}

export class RendererCompositionCache {
  private rowKeys = new Map<string, string>();
  private topologySignature: string | undefined;
  private rowsComposed = 0;
  private rowsReused = 0;
  private resets = 0;

  beginFrame(frame: RendererCompositionCacheFrame): boolean {
    this.rowsComposed = 0;
    this.rowsReused = 0;
    const topologySignature = createTopologySignature(frame);
    const reusable =
      this.topologySignature === topologySignature &&
      this.rowKeys.size > 0;
    if (!reusable) {
      this.rowKeys.clear();
      this.resets++;
    }
    this.topologySignature = topologySignature;
    return reusable;
  }

  shouldReuseRow(rowId: string, rowKey: string): boolean {
    if (this.rowKeys.get(rowId) !== rowKey) return false;
    this.rowsReused++;
    return true;
  }

  markComposedRow(rowId: string, rowKey: string): void {
    this.rowKeys.set(rowId, rowKey);
    this.rowsComposed++;
  }

  snapshot(): RendererCompositionCacheStats {
    return {
      entries: this.rowKeys.size,
      rowsComposed: this.rowsComposed,
      rowsReused: this.rowsReused,
      resets: this.resets,
    };
  }

  reset(): void {
    this.rowKeys.clear();
    this.topologySignature = undefined;
    this.rowsComposed = 0;
    this.rowsReused = 0;
    this.resets = 0;
  }
}

export function composeRendererRegions(
  buffer: RendererCellBuffer,
  regions: readonly RendererRegionLayer[],
  options: RendererCompositionOptions = {},
): RendererCompositionStats {
  const ordered = regions
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => region.visible !== false)
    .toSorted(compareRegions);

  let rowsVisited = 0;
  let rowsComposed = 0;
  let rowsReused = 0;
  let cellsWritten = 0;
  let cellsClipped = 0;
  const canReuseRows = options.reuseCachedRows === true && options.cache !== undefined;
  const lineCacheBefore = options.lineCache?.snapshot();
  const underlayRowKeys = new Map<number, string>();

  for (const { region, index } of ordered) {
    const rect = normalizeRect(region.rect);
    if (rect === null) continue;
    const clipped = clipRect(rect, buffer.width, buffer.height);
    if (clipped === null) {
      cellsClipped += rect.width * rect.height;
      continue;
    }

    const rowClearing = canReuseRows && isOpaqueRegion(region);
    if (!rowClearing && (region.clear === true || region.background !== undefined)) {
      buffer.fillRect(clipped, region.background);
    }

    const scrollY = normalizeScroll(region.scrollY);
    for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
      rowsVisited++;
      const sourceY = y - rect.y + scrollY;
      const line = region.lines[sourceY];
      const rowId = createRowId(region, index, y);
      const underlayKey = underlayRowKeys.get(y) ?? '';
      const rowKey = createRowKey(region, rect, clipped, y, sourceY, line, underlayKey);
      if (canReuseRows && options.cache?.shouldReuseRow(rowId, rowKey)) {
        rowsReused++;
        underlayRowKeys.set(y, appendUnderlayRowKey(underlayKey, rowKey));
        continue;
      }

      if (rowClearing) {
        buffer.fillRect({ x: clipped.x, y, width: clipped.width, height: 1 }, region.background);
      }
      options.cache?.markComposedRow(rowId, rowKey);
      rowsComposed++;
      if (line === undefined) {
        underlayRowKeys.set(y, appendUnderlayRowKey(underlayKey, rowKey));
        continue;
      }

      const cells = applyRendererRegionVfx(
        options.lineCache?.get(line, region.style) ?? rendererLineToCells(line, region.style),
        region,
        rect,
        y - rect.y,
      );
      for (let x = clipped.x; x < clipped.x + clipped.width; x++) {
        const sourceX = x - rect.x;
        const cell = cells[sourceX];
        if (cell === undefined) {
          cellsClipped++;
          continue;
        }
        buffer.setCell(x, y, inheritRegionBackground(cell, region));
        cellsWritten++;
      }
      underlayRowKeys.set(y, appendUnderlayRowKey(underlayKey, rowKey));
    }
  }

  const lineCache = options.lineCache?.snapshot();
  return {
    regions: ordered.length,
    rowsVisited,
    rowsComposed,
    rowsReused,
    cellsWritten,
    cellsClipped,
    lineCache,
    lineCacheFrame: diffLineCacheStats(lineCacheBefore, lineCache),
    compositionCache: options.cache?.snapshot(),
  };
}

function inheritRegionBackground(
  cell: RendererCell,
  region: RendererRegionLayer,
): RendererCell {
  if (cell.style?.bg !== undefined) return cell;
  const inheritedBg = region.background?.style?.bg ?? region.style?.bg;
  if (inheritedBg === undefined) return cell;
  return cell.style === undefined
    ? { ...cell, style: { bg: inheritedBg } }
    : { ...cell, style: { ...cell.style, bg: inheritedBg } };
}

function compareRegions(a: OrderedRegion, b: OrderedRegion): number {
  const zDiff = (a.region.zIndex ?? 0) - (b.region.zIndex ?? 0);
  return zDiff === 0 ? a.index - b.index : zDiff;
}

function normalizeRect(rect: RendererRect): RendererRect | null {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function clipRect(rect: RendererRect, width: number, height: number): RendererRect | null {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(width, rect.x + rect.width);
  const y2 = Math.min(height, rect.y + rect.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function normalizeScroll(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function isOpaqueRegion(region: RendererRegionLayer): boolean {
  return region.clear === true || region.background !== undefined;
}

function createTopologySignature(frame: RendererCompositionCacheFrame): string {
  const layers = frame.layers
    .map((region, index) => {
      const rect = normalizeRect(region.rect);
      return [
        index,
        region.id ?? '',
        region.visible === false ? 0 : 1,
        region.zIndex ?? 0,
        rect?.x ?? '',
        rect?.y ?? '',
        rect?.width ?? '',
        rect?.height ?? '',
        region.clear === true ? 1 : 0,
        cellKey(region.background),
        vfxKey(region.vfx),
      ].join(':');
    })
    .join('|');
  return `${String(frame.bufferWidth)}x${String(frame.bufferHeight)}|${layers}`;
}

function createRowId(region: RendererRegionLayer, index: number, y: number): string {
  return [index, region.id ?? '', y].join(':');
}

function createRowKey(
  region: RendererRegionLayer,
  rect: RendererRect,
  clipped: RendererRect,
  y: number,
  sourceY: number,
  line: RendererRegionLine | undefined,
  underlayKey = '',
): string {
  return [
    underlayKey,
    rect.x,
    rect.y,
    clipped.x,
    clipped.width,
    y,
    sourceY,
    normalizeScroll(region.scrollY),
    styleKey(region.style),
    region.clear === true ? 1 : 0,
    cellKey(region.background),
    vfxKey(region.vfx),
    lineKey(line),
  ].join('\u0000');
}

function appendUnderlayRowKey(underlayKey: string, rowKey: string): string {
  return underlayKey.length === 0 ? rowKey : `${underlayKey}\u0001${rowKey}`;
}

function applyRendererRegionVfx(
  cells: readonly RendererCell[],
  region: RendererRegionLayer,
  rect: RendererRect,
  localY: number,
): readonly RendererCell[] {
  const vfx = region.vfx;
  if (vfx === undefined || vfx.effect.kind === 'none') return cells;
  if (vfx.rect === undefined) return applyRendererCellVfx(cells, vfx.effect);

  const effectRect = normalizeRect(vfx.rect);
  if (effectRect === null) return cells;
  const clippedEffectRect = clipRect(effectRect, rect.width, rect.height);
  if (
    clippedEffectRect === null ||
    localY < clippedEffectRect.y ||
    localY >= clippedEffectRect.y + clippedEffectRect.height
  ) {
    return cells;
  }

  const start = clippedEffectRect.x;
  const end = Math.min(cells.length, clippedEffectRect.x + clippedEffectRect.width);
  if (end <= start) return cells;

  return [
    ...cells.slice(0, start),
    ...applyRendererCellVfx(cells.slice(start, end), vfx.effect),
    ...cells.slice(end),
  ];
}

function lineKey(line: RendererRegionLine | undefined): string {
  if (line === undefined) return 'undefined';
  if (typeof line === 'string') return `s:${line}`;
  return `c:${line.map(cellKey).join('\u0001')}`;
}

function cellKey(cell: RendererCell | undefined): string {
  if (cell === undefined) return '';
  return [
    cell.char,
    cell.width ?? '',
    cell.continuation === true ? 1 : 0,
    styleKey(cell.style),
  ].join('\u0002');
}

function styleKey(style: RendererCellStyle | undefined): string {
  if (style === undefined) return '';
  return [
    style.fg ?? '',
    style.bg ?? '',
    style.bold === true ? 1 : 0,
    style.dim === true ? 1 : 0,
    style.italic === true ? 1 : 0,
    style.underline === true ? 1 : 0,
    style.inverse === true ? 1 : 0,
  ].join('\u0003');
}

function vfxKey(vfx: RendererRegionVfx | undefined): string {
  if (vfx === undefined) return '';
  return [
    rectKey(vfx.rect),
    cellVfxOptionsKey(vfx.effect),
  ].join('\u0004');
}

function rectKey(rect: RendererRect | undefined): string {
  if (rect === undefined) return '';
  return [
    Math.floor(rect.x),
    Math.floor(rect.y),
    Math.floor(rect.width),
    Math.floor(rect.height),
  ].join(',');
}

function cellVfxOptionsKey(options: RendererCellVfxOptions): string {
  const timing = [
    options.progress ?? '',
    options.nowMs ?? '',
    options.intervalMs ?? '',
    options.seed ?? '',
    options.offset ?? '',
  ].join(',');
  switch (options.kind) {
    case 'none':
      return `none:${timing}`;
    case 'pulse':
      return [
        'pulse',
        timing,
        options.color ?? '',
        options.target ?? '',
        styleKey(options.style),
        options.minIntensity ?? '',
        options.maxIntensity ?? '',
      ].join('\u0005');
    case 'shimmer':
      return [
        'shimmer',
        timing,
        options.color ?? '',
        options.target ?? '',
        styleKey(options.style),
        options.width ?? '',
        options.direction ?? '',
      ].join('\u0005');
    case 'reveal':
      return [
        'reveal',
        timing,
        styleKey(options.hiddenStyle),
        options.maskChar ?? '',
      ].join('\u0005');
  }
}

function diffLineCacheStats(
  before: RendererLineCellCacheStats | undefined,
  after: RendererLineCellCacheStats | undefined,
): RendererLineCellCacheFrameStats | undefined {
  if (before === undefined || after === undefined) return undefined;
  const hits = Math.max(0, after.hits - before.hits);
  const misses = Math.max(0, after.misses - before.misses);
  return {
    hits,
    misses,
    evictions: Math.max(0, after.evictions - before.evictions),
    hitRatio: ratio(hits, hits + misses),
  };
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}
