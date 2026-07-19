import { ansiTextToCells } from './ansi-text';
import type { RendererCell, RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';

export interface RendererLineCellCacheOptions {
  readonly maxEntries?: number;
  readonly maxCells?: number;
}

export interface RendererLineCellCacheStats {
  readonly entries: number;
  readonly cells: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

interface RendererLineCellCacheEntry {
  readonly cells: readonly RendererCell[];
  readonly cellCount: number;
}

export class RendererLineCellCache {
  private readonly maxEntries: number;
  private readonly maxCells: number;
  private readonly entries = new Map<string, RendererLineCellCacheEntry>();
  private cellCount = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: RendererLineCellCacheOptions = {}) {
    this.maxEntries = normalizeMaxEntries(options.maxEntries);
    this.maxCells = normalizeMaxCells(options.maxCells);
  }

  get(line: RendererRegionLine, style: RendererCellStyle | undefined): readonly RendererCell[] {
    if (typeof line !== 'string') return mergeCellsStyle(line, style);

    const key = `${styleKey(style)}\u0000${line}`;
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.cells;
    }

    this.misses++;
    const cells = mergeCellsStyle(ansiTextToCells(line), style);
    if (cells.length > this.maxCells) return cells;

    this.entries.set(key, { cells, cellCount: cells.length });
    this.cellCount += cells.length;
    this.evictOverflow();
    return cells;
  }

  clear(): void {
    this.entries.clear();
    this.cellCount = 0;
  }

  snapshot(): RendererLineCellCacheStats {
    return {
      entries: this.entries.size,
      cells: this.cellCount,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.cellCount > this.maxCells) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.cellCount -= entry?.cellCount ?? 0;
      this.evictions++;
    }
  }
}

export function rendererLineToCells(
  line: RendererRegionLine,
  style: RendererCellStyle | undefined,
): readonly RendererCell[] {
  if (typeof line === 'string') return mergeCellsStyle(ansiTextToCells(line), style);
  return mergeCellsStyle(line, style);
}

/** Parses ANSI string region lines into cell lines once for native composition. */
const promoteLineCellCache = new RendererLineCellCache({
  maxEntries: 512,
  maxCells: 48_000,
});

export function promoteRendererRegionLinesToCells(
  lines: readonly RendererRegionLine[],
): readonly RendererRegionLine[] {
  return lines.map((line) =>
    typeof line === 'string' ? promoteLineCellCache.get(line, undefined) : line,
  );
}

/** Test helper — clear the promote ANSI→cells cache. */
export function resetPromoteRendererLineCellCacheForTests(): void {
  promoteLineCellCache.clear();
}

function mergeCellsStyle(
  cells: readonly RendererCell[],
  style: RendererCellStyle | undefined,
): readonly RendererCell[] {
  if (style === undefined) return cells;
  return cells.map((cell) => {
    const merged: {
      char: string;
      style: RendererCellStyle;
      link?: string;
      width?: number;
      continuation?: boolean;
    } = { char: cell.char, style: { ...style, ...cell.style } };
    if (cell.link !== undefined) merged.link = cell.link;
    if (cell.width !== undefined) merged.width = cell.width;
    if (cell.continuation !== undefined) merged.continuation = cell.continuation;
    return merged;
  });
}

function styleKey(style: RendererCellStyle | undefined): string {
  if (style === undefined) return '';
  return [
    style.fg ?? '',
    style.bg ?? '',
    style.bold === true ? '1' : '',
    style.dim === true ? '1' : '',
    style.italic === true ? '1' : '',
    style.underline === true ? '1' : '',
    style.inverse === true ? '1' : '',
  ].join('|');
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return 2048;
  return Math.max(1, Math.floor(value));
}

function normalizeMaxCells(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return 131072;
  return Math.max(1, Math.floor(value));
}
