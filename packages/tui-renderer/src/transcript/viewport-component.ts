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
import { shouldSkipExpensiveTranscriptFormat, withTranscriptMeasureMode } from './measure-mode';
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
 * Overflow paint cache for virtual scroll.
 *
 * Intentionally NOT keyed on ambient paint epoch. Child components already
 * embed epoch in their own render caches when animated; static children return
 * the same string[] reference, so we reuse formatted slices across ambient
 * ticks and pure scroll. Keying on epoch wiped this cache every ~16ms and
 * re-formatted every tall historical message during fast wheel scroll — the
 * residual freeze after geometry was decoupled from epoch.
 */
interface RendererTranscriptOverflowRenderCache {
  inner: number;
  safeWidth: number;
  childRefs: (Component | undefined)[];
  childRenderRefs: (string[] | undefined)[];
  /**
   * Sparse per-line formatted output (lead + canvas paint). Only lines that
   * have entered the visible window are filled — tall tool bodies are not
   * fully formatted on first intersection.
   */
  childFormattedSparse: ((RendererRegionLine | undefined)[] | undefined)[];
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
  /**
   * True when the last geometry resolve hit the wall-clock budget and left
   * provisional slots. Pure-scroll must NOT re-enter remasure every frame
   * (that re-taxed 12ms+ per wheel tick). Ambient/content continues dirty slots.
   */
  private geometryNeedsContinue = false;
  private overflowRenderCache: RendererTranscriptOverflowRenderCache | undefined;
  /**
   * Per pure-scroll frame budget for cold child.render materializations.
   * Fling (frames closer than FLING_GAP_MS) uses 0 — placeholders only —
   * so top→bottom wheel storms never layout history sync. Slow scroll may
   * materialize one card per frame. Ambient/content: unlimited.
   */
  private coldMaterializeBudget = 0;
  private lastPureScrollPaintAt = 0;
  private static readonly FLING_GAP_MS = 40;

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
        this.overflowRenderCache.childFormattedSparse[index] = undefined;
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
    this.geometryNeedsContinue = false;
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
          this.overflowRenderCache.childFormattedSparse[i] = undefined;
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
    this.geometryNeedsContinue = false;
  }

  private renderVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);

    // Pure-scroll fling detection: top→bottom storms schedule frames with delay
    // 0, so paints land <40ms apart. Never cold-layout during a fling.
    if (shouldSkipExpensiveTranscriptFormat()) {
      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const fling =
        this.lastPureScrollPaintAt > 0 && now - this.lastPureScrollPaintAt < RendererTranscriptViewportComponent.FLING_GAP_MS;
      this.coldMaterializeBudget = fling ? 0 : 1;
      this.lastPureScrollPaintAt = now;
    } else {
      this.coldMaterializeBudget = Number.POSITIVE_INFINITY;
      this.lastPureScrollPaintAt = 0;
    }

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
    // Also skip while incomplete under pure-scroll — remasuring every wheel
    // frame for 12ms was a residual permanent tax after a budget hit.
    const snap = this.geometrySnapshot;
    if (
      snap !== undefined &&
      snap.generation === this.geometryGeneration &&
      snap.inner === inner &&
      snap.n === n &&
      (!this.geometryNeedsContinue || shouldSkipExpensiveTranscriptFormat())
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

    // Probe-only: never run component live ticks / rebuilds / requestRender.
    // Those side effects re-dirty geometry and busy-loop the main thread.
    //
    // Hard wall-clock budget: remasuring hundreds of cold multi-k children in
    // one stack is the permanent-freeze class (event loop blocked for minutes).
    // Past the budget, keep provisional counts + install snapshot so pure
    // scroll is O(1); ambient/content frames continue dirty slots.
    return withTranscriptMeasureMode(() => {
      const measureStarted =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const MEASURE_BUDGET_MS = 12;
      let total = 0;
      let hitBudget = false;
      for (let i = 0; i < n; i++) {
        const child = this.children[i]!;
        if (geometry.childRefs[i] === child && Number.isFinite(geometry.counts[i])) {
          total += geometry.counts[i]!;
          continue;
        }
        if (hitBudget) {
          const provisional =
            Number.isFinite(geometry.counts[i]) && (geometry.counts[i] ?? 0) > 0
              ? geometry.counts[i]!
              : 1;
          geometry.counts[i] = provisional;
          // Leave childRefs undefined so a later non-scroll resolve remeasures.
          geometry.childRefs[i] = undefined;
          total += provisional;
          continue;
        }
        const count = child.render(inner).length;
        geometry.childRefs[i] = child;
        geometry.counts[i] = count;
        total += count;
        const now =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        if (now - measureStarted >= MEASURE_BUDGET_MS) {
          hitBudget = true;
        }
      }
      geometry.total = total;
      this.geometryNeedsContinue = hitBudget;
      // Always install snapshot so pure-scroll totals stay O(1) after a budget hit.
      this.geometrySnapshot = {
        generation: this.geometryGeneration,
        inner,
        n,
        counts: geometry.counts,
        total,
      };
      return { counts: geometry.counts, total };
    });
  }

  private measureAllChildLineCounts(
    inner: number,
    n: number,
  ): RendererTranscriptLineCountCacheEntry {
    return withTranscriptMeasureMode(() => {
      const counts: number[] = Array.from({ length: n });
      let total = 0;
      for (let i = 0; i < n; i++) {
        const count = this.children[i]!.render(inner).length;
        counts[i] = count;
        total += count;
      }
      return { counts, total };
    });
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
        const sliceStart = Math.max(0, startLine - childStart);
        const sliceEnd = Math.min(childLines, endLine - childStart);
        this.appendOverflowChildFormattedSlice(
          out,
          i,
          inner,
          safeWidth,
          sliceStart,
          sliceEnd,
        );
      }

      lineOffset = childEnd;
    }

    return out;
  }

  /**
   * Format only the visible local-line slice of one overflow child.
   * Raw child.render is cached by identity+array ref (not ambient epoch).
   * Formatted lines are sparse so scrolling a 5k-line tool body only paints
   * the ~viewport rows that actually appear.
   */
  private appendOverflowChildFormattedSlice(
    out: RendererRegionLine[],
    childIndex: number,
    inner: number,
    safeWidth: number,
    sliceStart: number,
    sliceEnd: number,
  ): void {
    const child = this.children[childIndex]!;
    const lead = ' '.repeat(this.leftPad);

    if (!this.isCacheEnabled()) {
      const lines = child.render(inner);
      for (let j = sliceStart; j < sliceEnd; j++) {
        out.push(this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth));
      }
      return;
    }

    const childCount = this.children.length;
    if (
      this.overflowRenderCache === undefined ||
      this.overflowRenderCache.inner !== inner ||
      this.overflowRenderCache.safeWidth !== safeWidth ||
      this.overflowRenderCache.childRefs.length !== childCount
    ) {
      this.overflowRenderCache = {
        inner,
        safeWidth,
        childRefs: Array.from({ length: childCount }),
        childRenderRefs: Array.from({ length: childCount }),
        childFormattedSparse: Array.from({ length: childCount }),
      };
    }

    const cache = this.overflowRenderCache;
    let lines = cache.childRenderRefs[childIndex];
    let sparse = cache.childFormattedSparse[childIndex];

    if (cache.childRefs[childIndex] !== child || lines === undefined) {
      // Pure-scroll cold intersection: fling budget is 0 (placeholders only).
      // Never write placeholder slots into the overflow cache so the settle
      // content frame re-materializes real bodies.
      if (
        shouldSkipExpensiveTranscriptFormat() &&
        this.coldMaterializeBudget <= 0
      ) {
        const rowCount = Math.max(0, sliceEnd - sliceStart);
        const pad = ' '.repeat(this.leftPad);
        for (let k = 0; k < rowCount; k++) {
          out.push(this.formatCanvasLine(`${pad}…`, safeWidth));
        }
        return;
      }
      if (shouldSkipExpensiveTranscriptFormat()) {
        this.coldMaterializeBudget -= 1;
      }
      lines = child.render(inner);
      cache.childRefs[childIndex] = child;
      cache.childRenderRefs[childIndex] = lines;
      sparse = undefined;
      cache.childFormattedSparse[childIndex] = undefined;
    } else if (shouldSkipExpensiveTranscriptFormat()) {
      // Pure-scroll / measure: identity match is enough. Re-probing child.render
      // every wheel frame re-enters multi-k Markdown/Text width caches and was
      // a residual freeze when many tall cards stayed in the visible window.
      // Ambient/content frames still probe below so live animation refs update.
    } else {
      // Probe render: animated children return a new array each epoch; static
      // caches often return the same reference. When the array is new but line
      // strings are unchanged, keep sparse formats (critical for fast scroll).
      const nextLines = child.render(inner);
      if (nextLines !== lines) {
        const prev = lines;
        lines = nextLines;
        cache.childRenderRefs[childIndex] = lines;
        if (sparse === undefined || sparse.length !== lines.length || prev.length !== lines.length) {
          sparse = undefined;
          cache.childFormattedSparse[childIndex] = undefined;
        } else {
          for (let j = 0; j < sparse.length; j++) {
            if (sparse[j] !== undefined && prev[j] !== lines[j]) {
              sparse[j] = undefined;
            }
          }
        }
      }
    }

    if (sparse === undefined) {
      sparse = Array.from({ length: lines.length });
      cache.childFormattedSparse[childIndex] = sparse;
    } else if (sparse.length < lines.length) {
      sparse.length = lines.length;
    }

    for (let j = sliceStart; j < sliceEnd; j++) {
      let formatted = sparse[j];
      if (formatted === undefined) {
        formatted = this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth);
        sparse[j] = formatted;
      }
      out.push(formatted);
    }
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
