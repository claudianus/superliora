import type { RendererDamageRect, RendererDirtyRowSpan } from './cell-buffer';

export type RendererDamageScanStrategy = 'none' | 'dirty-rows' | 'damage-rect' | 'full-frame';

export interface RendererDamagePlanOptions {
  readonly width: number;
  readonly height: number;
  readonly force?: boolean;
  readonly damage?: RendererDamageRect | null;
  readonly dirtyRows?: readonly RendererDirtyRowSpan[] | null;
}

export interface RendererDamagePlan {
  readonly strategy: RendererDamageScanStrategy;
  readonly damage: RendererDamageRect | null;
  readonly spans: readonly RendererDirtyRowSpan[];
  readonly dirtyRows: number;
  readonly scannedCells: number;
  readonly scannedRows: number;
  readonly totalCells: number;
  readonly scanRatio: number;
  readonly damageCells: number;
  readonly damageRatio: number;
}

export function planRendererDamage(options: RendererDamagePlanOptions): RendererDamagePlan {
  const width = normalizeExtent(options.width);
  const height = normalizeExtent(options.height);
  const totalCells = width * height;
  const fullRect = { x: 0, y: 0, width, height };

  if (options.force === true) {
    return createDamagePlan('full-frame', fullRect, rectToDirtyRowSpans(fullRect), 0, totalCells);
  }

  if (options.damage === null) {
    return createDamagePlan('none', null, [], 0, totalCells);
  }

  const clippedDamage =
    options.damage === undefined
      ? undefined
      : clipRendererDamageRect(options.damage, width, height);
  if (options.damage !== undefined && clippedDamage === null) {
    return createDamagePlan('none', null, [], 0, totalCells);
  }

  const dirtySpans = normalizeRendererDirtyRowSpans(
    options.dirtyRows,
    width,
    height,
    clippedDamage,
  );

  if (dirtySpans.length > 0) {
    return createDamagePlan(
      'dirty-rows',
      clippedDamage ?? unionRendererDirtyRowSpans(dirtySpans),
      dirtySpans,
      dirtySpans.length,
      totalCells,
    );
  }

  const fallbackDamage: RendererDamageRect | null =
    options.damage === undefined
      ? fullRect
      : clippedDamage ?? null;
  return createDamagePlan(
    options.damage === undefined ? 'full-frame' : 'damage-rect',
    fallbackDamage,
    fallbackDamage === null ? [] : rectToDirtyRowSpans(fallbackDamage),
    0,
    totalCells,
  );
}

export function clipRendererDamageRect(
  rect: RendererDamageRect,
  width: number,
  height: number,
): RendererDamageRect | null {
  const safeWidth = normalizeExtent(width);
  const safeHeight = normalizeExtent(height);
  const x1 = Math.max(0, Math.floor(rect.x));
  const y1 = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(safeWidth, Math.floor(rect.x + rect.width));
  const y2 = Math.min(safeHeight, Math.floor(rect.y + rect.height));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function unionRendererDamageRect(
  a: RendererDamageRect | null,
  b: RendererDamageRect,
): RendererDamageRect {
  if (a === null) return b;
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rendererDamageRectCells(rect: RendererDamageRect | null): number {
  if (rect === null) return 0;
  return normalizeExtent(rect.width) * normalizeExtent(rect.height);
}

function createDamagePlan(
  strategy: RendererDamageScanStrategy,
  damage: RendererDamageRect | null,
  spans: readonly RendererDirtyRowSpan[],
  dirtyRows: number,
  totalCells: number,
): RendererDamagePlan {
  const scannedCells = spans.reduce((total, span) => total + span.width, 0);
  const damageCells = rendererDamageRectCells(damage);
  return {
    strategy,
    damage,
    spans,
    dirtyRows,
    scannedCells,
    scannedRows: spans.length,
    totalCells,
    scanRatio: ratio(scannedCells, totalCells),
    damageCells,
    damageRatio: ratio(damageCells, totalCells),
  };
}

function normalizeRendererDirtyRowSpans(
  spans: readonly RendererDirtyRowSpan[] | null | undefined,
  width: number,
  height: number,
  damage: RendererDamageRect | null | undefined,
): readonly RendererDirtyRowSpan[] {
  if (spans === undefined || spans === null || spans.length === 0) return [];

  const byRow = new Map<number, { x: number; endX: number }[]>();
  for (const span of spans) {
    if (!Number.isFinite(span.x) || !Number.isFinite(span.y) || !Number.isFinite(span.width)) {
      continue;
    }
    const y = Math.floor(span.y);
    if (y < 0 || y >= height) continue;
    if (damage !== undefined && damage !== null) {
      if (y < damage.y || y >= damage.y + damage.height) continue;
    }

    let x = Math.max(0, Math.floor(span.x));
    let endX = Math.min(width, Math.floor(span.x + span.width));
    if (damage !== undefined && damage !== null) {
      x = Math.max(x, damage.x);
      endX = Math.min(endX, damage.x + damage.width);
    }
    if (endX <= x) continue;

    byRow.set(y, mergeNormalizedRowIntervals(byRow.get(y) ?? [], x, endX));
  }

  const out: RendererDirtyRowSpan[] = [];
  for (const [y, intervals] of byRow) {
    for (const span of intervals) {
      out.push({ y, x: span.x, width: span.endX - span.x });
    }
  }
  return out.toSorted(compareDirtyRowSpans);
}

/** Same rules as cell-buffer merge: abut/overlap coalesce, gaps stay split. */
function mergeNormalizedRowIntervals(
  intervals: readonly { x: number; endX: number }[],
  x: number,
  endX: number,
): { x: number; endX: number }[] {
  if (endX <= x) return intervals.map((span) => ({ x: span.x, endX: span.endX }));
  const next: { x: number; endX: number }[] = [];
  let merged = { x, endX };
  let inserted = false;
  for (const span of intervals) {
    if (span.endX < merged.x) {
      next.push({ x: span.x, endX: span.endX });
      continue;
    }
    if (span.x > merged.endX) {
      if (!inserted) {
        next.push(merged);
        inserted = true;
      }
      next.push({ x: span.x, endX: span.endX });
      continue;
    }
    merged = {
      x: Math.min(merged.x, span.x),
      endX: Math.max(merged.endX, span.endX),
    };
  }
  if (!inserted) next.push(merged);
  return next;
}

function rectToDirtyRowSpans(rect: RendererDamageRect): readonly RendererDirtyRowSpan[] {
  return Array.from({ length: rect.height }, (_, offset) => ({
    y: rect.y + offset,
    x: rect.x,
    width: rect.width,
  }));
}

function unionRendererDirtyRowSpans(
  spans: readonly RendererDirtyRowSpan[],
): RendererDamageRect | null {
  let damage: RendererDamageRect | null = null;
  for (const span of spans) {
    damage = unionRendererDamageRect(damage, { ...span, height: 1 });
  }
  return damage;
}

function compareDirtyRowSpans(a: RendererDirtyRowSpan, b: RendererDirtyRowSpan): number {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
}

function normalizeExtent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}
