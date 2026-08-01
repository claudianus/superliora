import { Container } from '../component-primitives/index';
import type { RendererRegionLine } from '../render/compositor';
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
  registerTranscriptGeometryParent,
  unregisterTranscriptGeometryParent,
} from './geometry-parent';
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

/**
 * Overflow paint cache for virtual scroll. Holds both raw child lines and
 * already-prefixed/formatted region lines so pure scroll (same epoch + width)
 * can slice without re-running formatCanvasLine / visibleWidth.
 */
interface RendererTranscriptOverflowRenderCache {
  inner: number;
  safeWidth: number;
  cacheEpoch: number;
  childRefs: (Component | undefined)[];
  childRenderRefs: (string[] | undefined)[];
  /** lead + formatCanvasLine applied; parallel to childRenderRefs. */
  childFormattedRefs: (RendererRegionLine[] | undefined)[];
}

interface RendererTranscriptLineCountCacheEntry {
  counts: number[];
  total: number;
}

/**
 * Geometry (row counts) for one inner width. Kept separate from paint/animation
 * epoch so ambient ticks and pure scroll never remeasure the whole tree.
 *
 * Per-slot `childRefs` identity: when a child is replaced or appended, only
 * that slot is remeasured. Content mutations of the same component instance
 * must call {@link RendererTranscriptViewportComponent.invalidate} so counts
 * are dropped (identity alone cannot see in-place text changes).
 */
interface RendererTranscriptGeometryCache {
  childRefs: (Component | undefined)[];
  counts: number[];
  total: number;
}

/** O(1) geometry hit when generation + width + child count are unchanged. */
interface RendererTranscriptGeometrySnapshot {
  generation: number;
  inner: number;
  n: number;
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

  // ── Virtual-scroll geometry cache (line counts) ────────────────────────
  //
  // Every render needs the total content row count (to sync the viewport) and
  // the per-child row counts (to map a viewport line range back to the
  // children that occupy it).  Computing either requires rendering every
  // child — the dominant cost once the transcript grows past a few hundred
  // messages.
  //
  // Geometry lifetime is independent of paint/animation epoch:
  //   - pure scroll frames reuse counts without touching off-screen children
  //   - ambient epoch advances only bust paint caches (overflow / full paint)
  //   - width changes remeasure at that width (small LRU of measured widths)
  //   - invalidate() drops geometry + paint so in-place content edits are safe
  //
  // Keyed by inner width only (never by paint epoch). Each entry reconciles
  // per-child Component identity so append/replace remeasures only dirty slots.
  // When generation + inner + n match the last full resolve, contentRowCount /
  // render skip the O(n) identity walk entirely (pure scroll hot path).
  private lineCountCache = new Map<number, RendererTranscriptGeometryCache>();
  private geometryGeneration = 0;
  private geometrySnapshot: RendererTranscriptGeometrySnapshot | undefined;
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

  /**
   * Register the child for {@link notifyTranscriptChildGeometryDirty} so
   * in-place height mutators (tool results, expand) can dirty only their slot.
   */
  override addChild(component: Component): void {
    super.addChild(component);
    registerTranscriptGeometryParent(this, component);
    // Child count changed — snapshot short-circuit must re-check identity.
    this.geometrySnapshot = undefined;
  }

  override removeChild(component: Component): void {
    unregisterTranscriptGeometryParent(component);
    super.removeChild(component);
    this.geometrySnapshot = undefined;
  }

  /**
   * Swap one mounted child for another without cascading invalidate() to every
   * sibling (that would wipe all message render caches). Geometry remeasures
   * only the replaced slot on the next resolve.
   */
  replaceChild(previous: Component, next: Component): boolean {
    const index = this.children.indexOf(previous);
    if (index === -1) return false;
    unregisterTranscriptGeometryParent(previous);
    this.children[index] = next;
    registerTranscriptGeometryParent(this, next);
    this.invalidateChildGeometry(next);
    // Previous identity is gone; ensure any width entry that still points at
    // `previous` is cleared (invalidateChildGeometry only matches `next`).
    for (const geometry of this.lineCountCache.values()) {
      if (geometry.childRefs[index] === previous) {
        geometry.childRefs[index] = undefined;
      }
    }
    if (this.overflowRenderCache !== undefined) {
      if (this.overflowRenderCache.childRefs[index] === previous) {
        this.overflowRenderCache.childRefs[index] = undefined;
        this.overflowRenderCache.childRenderRefs[index] = undefined;
        this.overflowRenderCache.childFormattedRefs[index] = undefined;
      }
    }
    this.geometrySnapshot = undefined;
    this.bumpGeometryGeneration();
    return true;
  }

  override clear(): void {
    for (const child of this.children) {
      unregisterTranscriptGeometryParent(child);
    }
    super.clear();
    this.geometrySnapshot = undefined;
  }

  /**
   * Drop paint-only caches (full-tree paint + overflow child lines). Geometry
   * (line counts) is preserved so a theme/epoch refresh does not remeasure
   * every historical message. Use {@link invalidate} when content or child
   * structure may have changed in place across the whole tree, or
   * {@link invalidateChildGeometry} for a single in-place height change
   * (streaming text).
   */
  invalidatePaint(): void {
    this.renderCache = undefined;
    this.overflowRenderCache = undefined;
  }

  /**
   * Drop geometry + parent paint without cascading {@link Container.invalidate}
   * to every sibling. Prefer when children already cleared their own caches
   * (or only structure/geometry must refresh). Theme switches should still use
   * {@link invalidate} so every message rebuilds themed ANSI.
   */
  invalidateGeometryAndPaint(): void {
    this.invalidatePaint();
    this.lineCountCache.clear();
    this.geometrySnapshot = undefined;
    this.bumpGeometryGeneration();
  }

  /**
   * Mark one child's row count dirty without cascading invalidate to siblings.
   * Streaming assistant/thinking updates mutate a child in place; identity
   * alone cannot see that height change. Only that slot is remeasured on the
   * next resolve — O(1) geometry, not O(transcript).
   */
  invalidateChildGeometry(child: Component): void {
    for (const geometry of this.lineCountCache.values()) {
      for (let i = 0; i < geometry.childRefs.length; i++) {
        if (geometry.childRefs[i] === child) {
          geometry.childRefs[i] = undefined;
        }
      }
    }
    if (this.overflowRenderCache !== undefined) {
      for (let i = 0; i < this.overflowRenderCache.childRefs.length; i++) {
        if (this.overflowRenderCache.childRefs[i] === child) {
          this.overflowRenderCache.childRefs[i] = undefined;
          this.overflowRenderCache.childRenderRefs[i] = undefined;
          this.overflowRenderCache.childFormattedRefs[i] = undefined;
        }
      }
    }
    // No-overflow paint cache is a flat concat — drop it so the next paint
    // picks up the new height for this child.
    this.renderCache = undefined;
    this.geometrySnapshot = undefined;
    this.bumpGeometryGeneration();
  }

  override invalidate(): void {
    this.invalidatePaint();
    this.lineCountCache.clear();
    this.geometrySnapshot = undefined;
    this.bumpGeometryGeneration();
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

  private bumpGeometryGeneration(): void {
    this.geometryGeneration = (this.geometryGeneration + 1) | 0;
  }

  private renderVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);

    // Phase 1 — resolve per-child row counts (geometry cache).  This is the
    // only place that may render *all* children, and only on geometry miss /
    // identity change; pure scroll and pure paint-epoch frames skip off-screen
    // children entirely once geometry is warm.
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
    const cacheEnabled = this.isCacheEnabled();

    if (!cacheEnabled) {
      return this.measureAllChildLineCounts(inner, n);
    }

    // Pure scroll / repeated contentRowCount: skip the O(n) identity walk when
    // nothing has dirtied geometry since the last full resolve at this size.
    const snap = this.geometrySnapshot;
    if (
      snap !== undefined &&
      snap.generation === this.geometryGeneration &&
      snap.inner === inner &&
      snap.n === n
    ) {
      return { counts: snap.counts, total: snap.total };
    }

    let geometry = this.lineCountCache.get(inner);
    if (geometry === undefined) {
      geometry = {
        childRefs: Array.from({ length: n }),
        counts: Array.from({ length: n }),
        total: 0,
      };
      this.lineCountCache.set(inner, geometry);
      if (this.lineCountCache.size > LINE_COUNT_CACHE_CAP) {
        const oldest = this.lineCountCache.keys().next();
        if (oldest.done !== true) this.lineCountCache.delete(oldest.value);
      }
    } else {
      // Refresh LRU recency (Map iterates in insertion order).
      this.lineCountCache.delete(inner);
      this.lineCountCache.set(inner, geometry);
      if (geometry.childRefs.length !== n) {
        geometry.childRefs.length = n;
        geometry.counts.length = n;
      }
    }

    let total = 0;
    for (let i = 0; i < n; i++) {
      const child = this.children[i]!;
      if (geometry.childRefs[i] === child && Number.isFinite(geometry.counts[i])) {
        total += geometry.counts[i]!;
        continue;
      }
      const count = child.render(inner).length;
      geometry.childRefs[i] = child;
      geometry.counts[i] = count;
      total += count;
    }
    geometry.total = total;
    this.geometrySnapshot = {
      generation: this.geometryGeneration,
      inner,
      n,
      counts: geometry.counts,
      total,
    };
    return { counts: geometry.counts, total };
  }

  private measureAllChildLineCounts(
    inner: number,
    n: number,
  ): RendererTranscriptLineCountCacheEntry {
    const counts: number[] = Array.from({ length: n });
    let total = 0;
    for (let i = 0; i < n; i++) {
      const count = this.children[i]!.render(inner).length;
      counts[i] = count;
      total += count;
    }
    return { counts, total };
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
    const out: RendererRegionLine[] = [];

    let lineOffset = 0;
    for (let i = 0; i < this.children.length; i++) {
      const childLines = childCounts[i]!;
      const childStart = lineOffset;
      const childEnd = lineOffset + childLines;

      if (childStart >= endLine) break;

      if (childEnd > startLine) {
        const formatted = this.resolveOverflowChildFormattedLines(i, inner, safeWidth);
        const sliceStart = Math.max(0, startLine - childStart);
        const sliceEnd = Math.min(formatted.length, endLine - childStart);
        for (let j = sliceStart; j < sliceEnd; j++) {
          out.push(formatted[j]!);
        }
      }

      lineOffset = childEnd;
    }

    return out;
  }

  /**
   * Resolve overflow paint for one child: raw render lines plus
   * lead+formatCanvasLine output. Pure scroll reuses formatted lines when
   * epoch/width/child identity match — no per-line visibleWidth on scroll.
   */
  private resolveOverflowChildFormattedLines(
    childIndex: number,
    inner: number,
    safeWidth: number,
  ): RendererRegionLine[] {
    const child = this.children[childIndex]!;
    const lead = ' '.repeat(this.leftPad);

    if (!this.isCacheEnabled()) {
      const lines = child.render(inner);
      return lines.map((line) => this.formatCanvasLine(lead + line, safeWidth));
    }

    const cacheEpoch = this.getCacheEpoch();
    const childCount = this.children.length;
    if (
      this.overflowRenderCache === undefined ||
      this.overflowRenderCache.inner !== inner ||
      this.overflowRenderCache.safeWidth !== safeWidth ||
      this.overflowRenderCache.cacheEpoch !== cacheEpoch ||
      this.overflowRenderCache.childRefs.length !== childCount
    ) {
      this.overflowRenderCache = {
        inner,
        safeWidth,
        cacheEpoch,
        childRefs: Array.from({ length: childCount }),
        childRenderRefs: Array.from({ length: childCount }),
        childFormattedRefs: Array.from({ length: childCount }),
      };
    }

    const cache = this.overflowRenderCache;
    if (
      cache.childRefs[childIndex] === child &&
      cache.childFormattedRefs[childIndex] !== undefined
    ) {
      return cache.childFormattedRefs[childIndex];
    }

    const lines = child.render(inner);
    const formatted = lines.map((line) => this.formatCanvasLine(lead + line, safeWidth));
    cache.childRefs[childIndex] = child;
    cache.childRenderRefs[childIndex] = lines;
    cache.childFormattedRefs[childIndex] = formatted;
    return formatted;
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
