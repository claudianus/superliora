import { Container } from '../component-primitives/index';
import type { RendererRegionLine } from '../compositor';
import {
  renderRendererRightGutterRegionLines,
  renderRendererVerticalScrollbar,
  type RendererScrollbarGlyphRole,
  type RendererScrollbarVariant,
} from '../scrollbar';
import type { RendererViewportSnapshot } from '../viewport/index';
import {
  type Component,
} from '../text/component';
import type {
  RendererTranscriptChildRowRange,
  RendererTranscriptViewportComponentOptions,
  RendererTranscriptViewportLinePainter,
  RendererTranscriptViewportRegionLinePainter,
} from './types';
import {
  normalizeTranscriptLineCount,
  normalizeTranscriptPadding,
  normalizeTranscriptWidth,
} from './normalize';

interface RendererTranscriptViewportRenderCache {
  width: number;
  cacheEpoch: number;
  childRefs: Component[];
  childRenderRefs: string[][];
  prefixed: RendererRegionLine[][];
  out: RendererRegionLine[];
}

interface RendererTranscriptOverflowRenderCache {
  inner: number;
  cacheEpoch: number;
  childRefs: (Component | undefined)[];
  childRenderRefs: (string[] | undefined)[];
}

interface RendererTranscriptLineCountCacheEntry {
  counts: number[];
  total: number;
}

/** Max distinct widths kept in the per-child line-count LRU. */
const LINE_COUNT_CACHE_CAP = 4;

export class RendererTranscriptViewportComponent extends Container {
  private readonly viewport: RendererTranscriptViewportComponentOptions['viewport'];
  private readonly getVisibleRows: (width: number) => number;
  private readonly leftPad: number;
  private readonly rightPad: number;
  private readonly scrollbar: boolean;
  private readonly scrollbarTrackChar: string;
  private readonly scrollbarThumbChar: string;
  private readonly minScrollbarThumbRows: number;
  private readonly scrollbarVariant: RendererScrollbarVariant;
  private readonly paintScrollbarGlyph:
    | ((role: RendererScrollbarGlyphRole, glyph: string) => string)
    | undefined;
  private readonly paintLine: RendererTranscriptViewportLinePainter | undefined;
  private readonly paintRegionLine: RendererTranscriptViewportRegionLinePainter | undefined;
  private readonly isCacheEnabled: () => boolean;
  private readonly getCacheEpoch: () => number;
  private renderCache: RendererTranscriptViewportRenderCache | undefined;

  // ── Virtual-scroll line-count cache ────────────────────────────────────
  //
  // Every render needs the total content row count (to sync the viewport) and
  // the per-child row counts (to map a viewport line range back to the
  // children that occupy it).  Computing either requires rendering every
  // child — the dominant cost once the transcript grows past a few hundred
  // messages.  We cache the row counts keyed by inner width so that, after the
  // first render at a given width, subsequent renders only re-render the
  // children that actually changed (and only paint the visible ones).
  //
  // Counts live in a small LRU keyed by inner width + cache epoch + child
  // count, so oscillating between widths (e.g. a terminal resize drag) keeps
  // reusing every measured width instead of evicting the previous one.
  // invalidate() drops the whole LRU, and children that mutate call
  // invalidate() which propagates up, so stale counts are never served.
  private lineCountCache = new Map<string, RendererTranscriptLineCountCacheEntry>();
  private overflowRenderCache: RendererTranscriptOverflowRenderCache | undefined;

  constructor(options: RendererTranscriptViewportComponentOptions) {
    super();
    this.viewport = options.viewport;
    this.getVisibleRows = options.getVisibleRows;
    this.leftPad = normalizeTranscriptPadding(options.leftPad);
    this.rightPad = normalizeTranscriptPadding(options.rightPad);
    this.scrollbar = options.scrollbar ?? true;
    this.scrollbarTrackChar = options.scrollbarTrackChar ?? '│';
    this.scrollbarThumbChar = options.scrollbarThumbChar ?? '█';
    this.minScrollbarThumbRows = normalizeTranscriptLineCount(
      options.minScrollbarThumbRows ?? 1,
    );
    this.scrollbarVariant = options.scrollbarVariant ?? 'plain';
    this.paintScrollbarGlyph = options.paintScrollbarGlyph;
    this.paintLine = options.paintLine;
    this.paintRegionLine = options.paintRegionLine;
    this.isCacheEnabled = options.isCacheEnabled ?? (() => true);
    this.getCacheEpoch = options.getCacheEpoch ?? (() => -1);
  }

  override invalidate(): void {
    this.renderCache = undefined;
    this.overflowRenderCache = undefined;
    this.lineCountCache.clear();
    super.invalidate();
  }

  override render(width: number): string[] {
    return this.renderWithVisibleRows(width, this.getVisibleRows(width));
  }

  /**
   * Total number of rows the transcript content would occupy if rendered
   * without a viewport cap. Used by callers that want to size a container to
   * the actual content instead of always reserving the full viewport.
   *
   * Uses the cached per-child row counts so it does not re-render unchanged
   * children on every call.
   */
  contentRowCount(width: number): number {
    const inner = this.innerWidth(width);
    return this.resolveChildLineCounts(inner).total;
  }

  /**
   * Resolve one logical transcript row to its child without repainting the
   * transcript. The per-child line-count LRU makes pointer hit-tests cheap
   * after the current width has been measured by render().
   */
  childRowRangeAt(
    width: number,
    logicalRow: number,
  ): RendererTranscriptChildRowRange | undefined {
    if (!Number.isFinite(logicalRow) || logicalRow < 0) return undefined;
    const row = Math.floor(logicalRow);
    const inner = this.innerWidth(width);
    const { counts, total } = this.resolveChildLineCounts(inner);
    if (row >= total) return undefined;

    let startRow = 0;
    for (let childIndex = 0; childIndex < counts.length; childIndex++) {
      const endRow = startRow + counts[childIndex]!;
      if (row < endRow) {
        return {
          child: this.children[childIndex]!,
          childIndex,
          renderWidth: inner,
          startRow,
          endRow,
          localRow: row - startRow,
        };
      }
      startRow = endRow;
    }
    return undefined;
  }

  renderWithVisibleRows(width: number, visibleRows: number): string[] {
    return this.renderVisibleRegionLines(width, visibleRows).map(regionLineToTranscriptDisplayString);
  }

  renderWithVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    return this.renderVisibleRegionLines(width, visibleRows);
  }

  private renderVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);

    // Phase 1 — resolve per-child row counts (cached).  This is the only
    // place that may render *all* children, and only on a cache miss; once
    // cached, subsequent frames skip children whose render output is reused.
    const { counts: childCounts, total: totalLines } = this.resolveChildLineCounts(inner);

    // Phase 2 — sync the viewport with the total content size.
    const snapshot = this.viewport.sync(totalLines, visibleRows);

    // Phase 3 — when the content fits inside the viewport (no overflow) we
    // still need every child, but we can reuse the cached prefixed lines.
    if (!snapshot.hasOverflow) {
      return this.renderAllChildren(width, inner, safeWidth, childCounts);
    }

    // Phase 4 — overflow: render only the children that intersect the visible
    // line window.  This is the virtual-scroll fast path.
    const visibleLines = this.renderVisibleChildren(
      inner,
      safeWidth,
      childCounts,
      snapshot.start,
      snapshot.end,
    );

    // Phase 5 — attach a scrollbar gutter if configured.
    if (!this.scrollbar || this.rightPad <= 0) return visibleLines;
    return this.renderScrollbar(visibleLines, width, snapshot);
  }

  /** Returns the inner content width (total minus horizontal padding). */
  private innerWidth(width: number): number {
    const safeWidth = normalizeTranscriptWidth(width);
    return Math.max(1, safeWidth - this.leftPad - this.rightPad);
  }

  private resolveChildLineCounts(inner: number): RendererTranscriptLineCountCacheEntry {
    const n = this.children.length;
    const cacheEpoch = this.getCacheEpoch();
    const cacheEnabled = this.isCacheEnabled();
    const key = `${inner}:${cacheEpoch}:${n}`;
    if (cacheEnabled) {
      const hit = this.lineCountCache.get(key);
      if (hit !== undefined) {
        // Refresh LRU recency (Map iterates in insertion order).
        this.lineCountCache.delete(key);
        this.lineCountCache.set(key, hit);
        return hit;
      }
    }

    const counts: number[] = Array.from({ length: n });
    let total = 0;
    for (let i = 0; i < n; i++) {
      const count = this.children[i]!.render(inner).length;
      counts[i] = count;
      total += count;
    }
    const entry: RendererTranscriptLineCountCacheEntry = { counts, total };
    if (cacheEnabled) {
      this.lineCountCache.set(key, entry);
      if (this.lineCountCache.size > LINE_COUNT_CACHE_CAP) {
        const oldest = this.lineCountCache.keys().next();
        if (oldest.done !== true) this.lineCountCache.delete(oldest.value);
      }
    }
    return entry;
  }

  private formatCanvasLine(line: string, width: number): RendererRegionLine {
    if (this.paintRegionLine !== undefined) return this.paintRegionLine(line, width);
    if (this.paintLine !== undefined) return this.paintLine(line, width);
    return line;
  }

  private renderAllChildren(
    width: number,
    inner: number,
    safeWidth: number,
    _childCounts: number[],
  ): RendererRegionLine[] {
    const lead = ' '.repeat(this.leftPad);
    const cache = this.renderCache;
    const cacheEpoch = this.getCacheEpoch();
    const cacheValid =
      this.isCacheEnabled() &&
      cache !== undefined &&
      cache.width === safeWidth &&
      cache.cacheEpoch === cacheEpoch &&
      cache.childRefs.length === this.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: string[][] = [];
    const prefixed: RendererRegionLine[][] = [];
    let allReused = cacheValid;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      const lines = child.render(inner);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused =
        cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        prefixed.push(cache.prefixed[i]!);
      } else {
        allReused = false;
        prefixed.push(lines.map((line) => this.formatCanvasLine(lead + line, safeWidth)));
      }
    }

    const out = allReused ? cache!.out : prefixed.flat();

    if (this.isCacheEnabled()) {
      this.renderCache = { width: safeWidth, cacheEpoch, childRefs, childRenderRefs, prefixed, out };
    } else {
      this.renderCache = undefined;
    }

    return out;
  }

  private renderVisibleChildren(
    inner: number,
    safeWidth: number,
    childCounts: number[],
    startLine: number,
    endLine: number,
  ): RendererRegionLine[] {
    const lead = ' '.repeat(this.leftPad);
    const out: RendererRegionLine[] = [];

    let lineOffset = 0;
    for (let i = 0; i < this.children.length; i++) {
      const childLines = childCounts[i]!;
      const childStart = lineOffset;
      const childEnd = lineOffset + childLines;

      if (childStart >= endLine) break;

      if (childEnd > startLine) {
        const lines = this.resolveOverflowChildRenderLines(i, inner);
        const sliceStart = Math.max(0, startLine - childStart);
        const sliceEnd = Math.min(lines.length, endLine - childStart);
        for (let j = sliceStart; j < sliceEnd; j++) {
          out.push(this.formatCanvasLine(lead + lines[j]!, safeWidth));
        }
      }

      lineOffset = childEnd;
    }

    return out;
  }

  private resolveOverflowChildRenderLines(childIndex: number, inner: number): string[] {
    const child = this.children[childIndex]!;
    if (!this.isCacheEnabled()) return child.render(inner);

    const cacheEpoch = this.getCacheEpoch();
    const childCount = this.children.length;
    if (
      this.overflowRenderCache === undefined ||
      this.overflowRenderCache.inner !== inner ||
      this.overflowRenderCache.cacheEpoch !== cacheEpoch ||
      this.overflowRenderCache.childRefs.length !== childCount
    ) {
      this.overflowRenderCache = {
        inner,
        cacheEpoch,
        childRefs: Array.from({ length: childCount }),
        childRenderRefs: Array.from({ length: childCount }),
      };
    }

    const cache = this.overflowRenderCache;
    if (cache.childRefs[childIndex] === child && cache.childRenderRefs[childIndex] !== undefined) {
      return cache.childRenderRefs[childIndex]!;
    }

    const lines = child.render(inner);
    cache.childRefs[childIndex] = child;
    cache.childRenderRefs[childIndex] = lines;
    return lines;
  }

  private renderScrollbar(
    lines: readonly RendererRegionLine[],
    width: number,
    viewport: RendererViewportSnapshot,
  ): RendererRegionLine[] {
    if (!viewport.hasOverflow || !Number.isFinite(viewport.viewportRows) || width < 2) {
      return [...lines];
    }

    const glyphs = renderRendererVerticalScrollbar({
      contentRows: viewport.contentRows,
      viewportRows: viewport.viewportRows,
      offsetFromBottom: viewport.offsetFromBottom,
      trackRows: lines.length,
      minThumbRows: this.minScrollbarThumbRows,
      trackChar: this.scrollbarTrackChar,
      thumbChar: this.scrollbarThumbChar,
      variant: this.scrollbarVariant,
      paintGlyph: this.paintScrollbarGlyph,
    });
    if (glyphs.length === 0) return [...lines];
    return renderRendererRightGutterRegionLines({ lines, width, glyphs });
  }
}

function regionLineToTranscriptDisplayString(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}
