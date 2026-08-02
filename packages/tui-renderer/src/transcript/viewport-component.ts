import { Container } from '../component-primitives/index';
import type { RendererRegionLine } from '../render/compositor';
import {
  renderRendererRightGutterRegionLines,
  renderRendererVerticalScrollbar,
  type RendererScrollbarGlyphRole,
  type RendererScrollbarVariant,
} from '../scrollbar';
import type { RendererViewportSnapshot } from '../viewport/index';
import type { IncrementalRenderStats } from '../frame/incremental-render';
import {
  supportsWindowedBody,
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
  TranscriptVisibleLinePresenter,
  type TranscriptPresentResult,
} from './incremental-present';
import {
  isTranscriptCheapPaintMode,
  noteTranscriptPureScrollPaint,
  shouldSkipExpensiveTranscriptFormat,
  withTranscriptMeasureMode,
} from './measure-mode';
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
/**
 * Viewport-class sparse format band for one overflow child.
 * Never sized to geometry height — multi-k O(geometry) clear loops were a
 * permanent-freeze class after windowed paint landed.
 */
interface RendererTranscriptSparseBand {
  /** Local row index of slots[0]. */
  origin: number;
  slots: (RendererRegionLine | undefined)[];
}

interface RendererTranscriptOverflowRenderCache {
  inner: number;
  safeWidth: number;
  childRefs: (Component | undefined)[];
  childRenderRefs: (string[] | undefined)[];
  /**
   * Legacy full-height sparse (non-windowed children). Prefer bands for
   * windowed multi-k bodies.
   */
  childFormattedSparse: ((RendererRegionLine | undefined)[] | undefined)[];
  /** Windowed bodies: compact band only (viewport × retain), not geometry. */
  childSparseBands: (RendererTranscriptSparseBand | undefined)[];
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
/**
 * Overflow paint retention. Scrolling the whole history used to keep every
 * visited card's full string[] forever → multi-100MB heaps → multi-second GC
 * pauses that felt like freezes on rapid up/down flings.
 */
/** Keep only this many viewport-heights of off-screen materialize around the window. */
const OVERFLOW_RETAIN_VIEWPORTS = 2;
/** Hard cap on how many children keep full line arrays (LRU by last paint). */
const OVERFLOW_MAX_RETAINED_CHILDREN = 12;
/** Exported for unit tests that assert the shipped retain ceiling. */
export const TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN = OVERFLOW_MAX_RETAINED_CHILDREN;
/**
 * Max cold materializations per content/settle frame for the *visible* window.
 * Pure-scroll is always 0. Content must be large enough to fill a typical
 * viewport of short cards in one frame (incremental==authoritative); windowed
 * multi-k bodies only cost one paintContentRows each so this stays O(viewport).
 */
export const TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET = 32;
/**
 * Legacy children (ToolCall etc.) above this row count never pin full
 * `childRenderRefs` arrays — only a viewport band of formatted lines.
 * Prevents multi-k × retained-children heaps during history walks.
 */
const LEGACY_FULL_LINE_RETAIN_CAP = 256;


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
   * Per-frame budget for cold child.render / paintContentRows materializations.
   * Pure-scroll always forces 0 (cache/placeholder only). Content/settle uses
   * {@link CONTENT_MATERIALIZE_BUDGET} so progressive fill cannot hitch.
   */
  private coldMaterializeBudget = 0;
  /** Max cold layouts per non-scroll (settle/content) frame — avoids settle hitch. */
  private static readonly CONTENT_MATERIALIZE_BUDGET = TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET;
  /**
   * True when the last paint left visible cold placeholders because the
   * materialize budget ran out. Hosts should schedule another content frame.
   */
  private materializeContinuePending = false;
  /** Child indices painted recently — overflow eviction LRU (insertion order). */
  private overflowTouchOrder: number[] = [];
  /**
   * Incremental present engine on the real visible-window path (Phase C).
   * Stable re-presents skip clean lines; dirty work is frame-budgeted.
   */
  private readonly incrementalPresenter = new TranscriptVisibleLinePresenter();
  private lastPresentResult: TranscriptPresentResult | undefined;
  /**
   * Diagnostics: child.render / paintContentRows calls in the last paint.
   * Pure-scroll must stay 0 (cache/placeholder only).
   */
  private childPaintCallsThisFrame = 0;
  /** Whether the last paint was pure-scroll cheap mode. */
  private lastPureScrollFlag = false;
  /** Whether the last paint was inside a scroll storm (rapid successive pure-scroll). */
  private lastStormFlag = false;

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

  /**
   * Hosts: schedule another content paint when true after a frame.
   * Cold materialize placeholders only. Present no longer budget-defers dirty
   * rows (that left stale scrolled content + endless progressive content).
   */
  get needsMaterializeContinue(): boolean {
    return this.materializeContinuePending;
  }

  /**
   * Last incremental present stats from the shipped visible-window path.
   * Stable re-present → repaintedLines ≪ visibleLines; budget stop → hasPending.
   */
  get lastIncrementalPresentStats(): IncrementalRenderStats | undefined {
    return this.lastPresentResult?.stats;
  }

  /** True when the last present deferred dirty rows past the frame budget. */
  get needsIncrementalPresentContinue(): boolean {
    return this.lastPresentResult?.hasPendingDirty === true;
  }

  /** Test/host: force all present lines dirty (theme/resize). */
  invalidateIncrementalPresent(): void {
    this.incrementalPresenter.invalidate();
  }

  /**
   * How many children currently hold a full raw line array in the overflow
   * paint cache. Used by tests and diagnostics to prove retain caps.
   */
  get overflowRetainedFullLineChildCount(): number {
    const cache = this.overflowRenderCache;
    if (cache === undefined) return 0;
    let n = 0;
    for (const lines of cache.childRenderRefs) {
      if (lines !== undefined && lines.length > 0) n += 1;
    }
    return n;
  }

  /** Total raw lines retained across overflow full-line arrays (heap proxy). */
  get overflowRetainedRawLineCount(): number {
    const cache = this.overflowRenderCache;
    if (cache === undefined) return 0;
    let n = 0;
    for (const lines of cache.childRenderRefs) {
      if (lines !== undefined) n += lines.length;
    }
    return n;
  }

  /**
   * Filled (defined) sparse format slots across overflow children. Windowed
   * multi-k bodies must stay O(viewport × retain), not geometry height.
   */
  get overflowFilledSparseLineCount(): number {
    const cache = this.overflowRenderCache;
    if (cache === undefined) return 0;
    let n = 0;
    for (const band of cache.childSparseBands) {
      if (band === undefined) continue;
      for (const slot of band.slots) {
        if (slot !== undefined) n += 1;
      }
    }
    for (const sparse of cache.childFormattedSparse) {
      if (sparse === undefined) continue;
      for (const slot of sparse) {
        if (slot !== undefined) n += 1;
      }
    }
    return n;
  }

  /**
   * Child.render / paintContentRows invocations in the last paint frame.
   * Pure-scroll paints must report 0 (structurally cache/placeholder only).
   */
  get lastFrameChildPaintCalls(): number {
    return this.childPaintCallsThisFrame;
  }

  /** True when the last paint ran under pure-scroll cheap-paint mode. */
  get lastPaintWasPureScroll(): boolean {
    return this.lastPureScrollFlag;
  }

  /** True when the last paint was a rapid successive pure-scroll (storm). */
  get lastPaintWasScrollStorm(): boolean {
    return this.lastStormFlag;
  }

  private renderVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);
    this.materializeContinuePending = false;
    this.childPaintCallsThisFrame = 0;

    // Pure-scroll: never cold-layout (budget 0). Materializing even 1 multi-k
    // card per wheel frame during rapid up/down allocated string heaps that
    // triggered multi-second GC pauses. Fill only on content/settle frames.
    // Structurally: pure-scroll never calls child.render / paintContentRows —
    // only overflow cache slots or placeholders (O(viewport)).
    const pureScroll = shouldSkipExpensiveTranscriptFormat();
    this.lastPureScrollFlag = pureScroll;
    if (pureScroll) {
      this.coldMaterializeBudget = 0;
      this.lastStormFlag = noteTranscriptPureScrollPaint();
    } else {
      this.coldMaterializeBudget = RendererTranscriptViewportComponent.CONTENT_MATERIALIZE_BUDGET;
      this.lastStormFlag = false;
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
    let visibleLines: RendererRegionLine[];
    if (!snapshot.hasOverflow) {
      // Pure-scroll on non-overflowing transcripts: still avoid re-rendering
      // the full child tree every wheel tick — reuse cache or placeholders.
      if (pureScroll) {
        visibleLines = this.renderAllChildrenPureScroll(width, inner, safeWidth);
      } else {
        visibleLines = this.renderAllChildren(width, inner, safeWidth, childCounts);
      }
    } else {
      // Phase 4 — overflow: render only the children that intersect the visible
      // line window.  This is the virtual-scroll fast path.
      visibleLines = this.renderVisibleChildren(
        inner,
        safeWidth,
        childCounts,
        snapshot.start,
        snapshot.end,
        pureScroll,
      );

      // Eviction during pure-scroll causes allocate/free thrash on rapid
      // up/down (GC freezes). Defer eviction to content/settle frames only.
      if (!pureScroll) {
        this.evictOverflowAwayFromWindow(childCounts, snapshot.start, snapshot.end);
      }

      // Phase 5 — attach a scrollbar gutter if configured.
      if (this.scrollbar && this.rightPad > 0) {
        visibleLines = this.renderScrollbar(visibleLines, width, snapshot);
      }
    }

    // Phase 6 — incremental present on the real visible window (Phase C).
    // windowKey invalidates identity when the scroll window moves so equal
    // placeholder keys cannot retain pre-scroll rows (tool/output flicker).
    // Pure-scroll storm: skip present engine (hash/replaceAll tax) — lines are
    // already the final window; settle frames re-enter present for fidelity.
    if (pureScroll && this.lastStormFlag) {
      this.lastPresentResult = {
        lines: visibleLines,
        paintCommands: [],
        stats: this.incrementalPresenter.lastFrameStats,
        hasPendingDirty: false,
      };
      return visibleLines;
    }

    this.lastPresentResult = this.incrementalPresenter.present(visibleLines, {
      windowKey: `${snapshot.start}:${snapshot.end}:${visibleRows}:${safeWidth}`,
    });
    return this.lastPresentResult.lines as RendererRegionLine[];
  }

  /** Returns the inner content width (total minus horizontal padding). */
  private innerWidth(width: number): number {
    const safeWidth = normalizeTranscriptWidth(width);
    return Math.max(1, safeWidth - this.leftPad - this.rightPad);
  }

  private resolveChildLineCounts(inner: number): RendererTranscriptLineCountCacheEntry {
    const n = this.children.length;
    const cacheEnabled = this.isCacheEnabled();

    // Pure-scroll must never cold-measure (child.render for geometry). Prefer
    // the last snapshot/cache even across soft generation bumps so wheel
    // storms stay O(1). Content/settle frames remasure properly.
    if (isTranscriptCheapPaintMode()) {
      const snap = this.geometrySnapshot;
      if (snap !== undefined && snap.inner === inner && snap.n === n) {
        return { counts: snap.counts, total: snap.total };
      }
      const geometry = this.lineCountCache.get(inner);
      if (geometry !== undefined && geometry.counts.length === n) {
        let total = 0;
        for (let i = 0; i < n; i++) {
          const c = geometry.counts[i];
          total += Number.isFinite(c) && (c as number) > 0 ? (c as number) : 1;
        }
        return { counts: geometry.counts, total };
      }
      // No prior geometry: provisional 1-row stubs (scrollbar jitter until settle).
      const counts = Array.from({ length: n }, () => 1);
      return { counts, total: n };
    }

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
        const count = measureChildContentRows(child, inner);
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
        const count = measureChildContentRows(this.children[i]!, inner);
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

  private touchOverflowChild(childIndex: number): void {
    const order = this.overflowTouchOrder;
    const prev = order.indexOf(childIndex);
    if (prev >= 0) order.splice(prev, 1);
    order.push(childIndex);
  }

  private clearOverflowChildSlot(childIndex: number): void {
    const cache = this.overflowRenderCache;
    if (cache === undefined) return;
    const child = cache.childRefs[childIndex];
    cache.childRefs[childIndex] = undefined;
    cache.childRenderRefs[childIndex] = undefined;
    cache.childFormattedSparse[childIndex] = undefined;
    cache.childSparseBands[childIndex] = undefined;
    // Soft-evict leaf paint caches only. NEVER call full invalidate() —
    // ToolCall/Assistant invalidate rebuilds bodies and dirties geometry.
    if (child !== undefined && typeof child.softDropPaintCaches === 'function') {
      try {
        child.softDropPaintCaches();
      } catch {
        // Never let eviction throw into paint.
      }
    }
  }

  private ensureOverflowCache(
    inner: number,
    safeWidth: number,
    childCount: number,
  ): RendererTranscriptOverflowRenderCache {
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
        childSparseBands: Array.from({ length: childCount }),
      };
    } else if (this.overflowRenderCache.childSparseBands.length !== childCount) {
      this.overflowRenderCache.childSparseBands.length = childCount;
    }
    return this.overflowRenderCache;
  }

  /**
   * Free full line arrays for cards far from the viewport and enforce a hard
   * cap on retained children. Prevents GC freezes after scrolling the full
   * history up and down repeatedly.
   */
  private evictOverflowAwayFromWindow(
    childCounts: number[],
    startLine: number,
    endLine: number,
  ): void {
    const cache = this.overflowRenderCache;
    if (cache === undefined) return;
    const windowRows = Math.max(1, endLine - startLine);
    const margin = windowRows * OVERFLOW_RETAIN_VIEWPORTS;
    const keepStart = startLine - margin;
    const keepEnd = endLine + margin;

    let lineOffset = 0;
    for (let i = 0; i < childCounts.length; i++) {
      const childLines = childCounts[i]!;
      const childStart = lineOffset;
      const childEnd = lineOffset + childLines;
      lineOffset = childEnd;
      if (cache.childRefs[i] === undefined && cache.childRenderRefs[i] === undefined) {
        continue;
      }
      // Fully outside the retain band → drop full line arrays + sparse paint.
      if (childEnd <= keepStart || childStart >= keepEnd) {
        this.clearOverflowChildSlot(i);
        const touch = this.overflowTouchOrder.indexOf(i);
        if (touch >= 0) this.overflowTouchOrder.splice(touch, 1);
      }
    }

    // Hard cap: drop oldest touched children beyond the retain limit.
    while (this.overflowTouchOrder.length > OVERFLOW_MAX_RETAINED_CHILDREN) {
      const drop = this.overflowTouchOrder.shift();
      if (drop === undefined) break;
      this.clearOverflowChildSlot(drop);
    }
  }

  /**
   * After a cold materialize, replace estimate/provisional row counts with the
   * real laid-out height so the scrollbar does not keep jumping.
   */
  private reconcileChildGeometry(
    inner: number,
    childIndex: number,
    child: Component,
    lineCount: number,
  ): void {
    const geometry = this.lineCountCache.get(inner);
    if (geometry === undefined) return;
    if (childIndex < 0 || childIndex >= geometry.counts.length) return;
    const next = Math.max(0, Math.floor(lineCount));
    const prev = geometry.counts[childIndex];
    if (prev === next && geometry.childRefs[childIndex] === child) return;
    const old = Number.isFinite(prev) ? (prev as number) : 0;
    geometry.counts[childIndex] = next;
    geometry.childRefs[childIndex] = child;
    geometry.total = Math.max(0, geometry.total - old + next);
    if (
      this.geometrySnapshot !== undefined &&
      this.geometrySnapshot.inner === inner &&
      this.geometrySnapshot.n === geometry.counts.length
    ) {
      this.geometrySnapshot = {
        generation: this.geometryGeneration,
        inner,
        n: geometry.counts.length,
        counts: geometry.counts,
        total: geometry.total,
      };
    }
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
      this.childPaintCallsThisFrame += 1;
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

  /**
   * Non-overflow pure-scroll: reuse the last full paint cache or emit
   * placeholders. Never re-enters child.render (that was the residual freeze
   * when a short transcript still re-laid-out every wheel tick).
   */
  private renderAllChildrenPureScroll(
    _width: number,
    _inner: number,
    safeWidth: number,
  ): RendererRegionLine[] {
    const cache = this.renderCache;
    const cacheEpoch = this.getCacheEpoch();
    if (
      this.isCacheEnabled() &&
      cache !== undefined &&
      cache.width === safeWidth &&
      cache.cacheEpoch === cacheEpoch &&
      cache.childRefs.length === this.children.length &&
      cache.out.length > 0
    ) {
      // Identity check without re-rendering: same child instances → reuse.
      let identityOk = true;
      for (let i = 0; i < this.children.length; i++) {
        if (cache.childRefs[i] !== this.children[i]) {
          identityOk = false;
          break;
        }
      }
      if (identityOk) return cache.out;
    }
    // No warm full cache: placeholder window (visible rows come from viewport
    // sync on the overflow path; here content fits — emit empty-safe stubs).
    this.materializeContinuePending = true;
    const rows = Math.max(1, this.getVisibleRows(safeWidth));
    const pad = ' '.repeat(this.leftPad);
    const out: RendererRegionLine[] = [];
    for (let k = 0; k < rows; k++) {
      out.push(this.formatCanvasLine(`${pad}…`, safeWidth));
    }
    return out;
  }

  private renderVisibleChildren(
    inner: number,
    safeWidth: number,
    childCounts: number[],
    startLine: number,
    endLine: number,
    pureScroll = false,
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
          pureScroll,
        );
      }

      lineOffset = childEnd;
    }

    return out;
  }

  /**
   * Format only the visible local-line slice of one overflow child.
   *
   * **Pure-scroll (structural):** never calls `child.render` /
   * `paintContentRows` / `measureContentRows`. Only reads overflow cache
   * slots; missing rows are placeholders. Fill happens on content/settle.
   *
   * **Content:** windowed bodies paint O(visible) rows into a compact band;
   * legacy children cache raw `render()` by identity and format via a compact
   * band (never geometry-length sparse — multi-k sparse alloc was a freeze).
   */
  private appendOverflowChildFormattedSlice(
    out: RendererRegionLine[],
    childIndex: number,
    inner: number,
    safeWidth: number,
    sliceStart: number,
    sliceEnd: number,
    pureScroll = false,
  ): void {
    const child = this.children[childIndex]!;
    const lead = ' '.repeat(this.leftPad);
    const rowCount = Math.max(0, sliceEnd - sliceStart);

    // ── Pure-scroll: cache or placeholder only (O(viewport), no child paint) ──
    if (pureScroll) {
      this.appendPureScrollCachedSlice(out, childIndex, child, inner, safeWidth, sliceStart, sliceEnd, lead);
      return;
    }

    // ── Windowed large-body path (Text and adopters) ─────────────────────
    // Never call full render() / never store multi-k childRenderRefs.
    // Sparse is a compact band (viewport × retain) — never geometry-length.
    if (supportsWindowedBody(child)) {
      if (!this.isCacheEnabled()) {
        this.childPaintCallsThisFrame += 1;
        const windowLines = child.paintContentRows(inner, sliceStart, sliceEnd);
        for (const line of windowLines) {
          out.push(this.formatCanvasLine(lead + line, safeWidth));
        }
        return;
      }

      const childCount = this.children.length;
      const cache = this.ensureOverflowCache(inner, safeWidth, childCount);
      const identityMiss = cache.childRefs[childIndex] !== child;

      if (identityMiss) {
        if (this.coldMaterializeBudget <= 0) {
          this.pushPlaceholders(out, rowCount, safeWidth);
          return;
        }
        this.coldMaterializeBudget -= 1;
        cache.childRefs[childIndex] = child;
        // Critical: do NOT store a full multi-k array in childRenderRefs.
        cache.childRenderRefs[childIndex] = undefined;
        cache.childFormattedSparse[childIndex] = undefined;
        cache.childSparseBands[childIndex] = undefined;
        this.touchOverflowChild(childIndex);
        this.childPaintCallsThisFrame += 1;
        const measured = child.measureContentRows(inner);
        this.reconcileChildGeometry(inner, childIndex, child, measured);
      } else {
        this.touchOverflowChild(childIndex);
      }

      const geometryCount =
        this.lineCountCache.get(inner)?.counts[childIndex] ??
        Math.max(sliceEnd, (() => {
          this.childPaintCallsThisFrame += 1;
          return child.measureContentRows(inner);
        })());
      const band = this.ensureSparseBand(cache, childIndex, sliceStart, sliceEnd, geometryCount);

      // Fill missing slots for the visible window only.
      let missingStart = -1;
      let missingEnd = -1;
      for (let j = sliceStart; j < sliceEnd; j++) {
        const bi = j - band.origin;
        if (bi < 0 || bi >= band.slots.length || band.slots[bi] === undefined) {
          if (missingStart < 0) missingStart = j;
          missingEnd = j + 1;
        }
      }
      if (missingStart >= 0) {
        this.childPaintCallsThisFrame += 1;
        const windowLines = child.paintContentRows(inner, missingStart, missingEnd!);
        for (let k = 0; k < windowLines.length; k++) {
          const j = missingStart + k;
          if (j >= sliceEnd) break;
          const bi = j - band.origin;
          if (bi >= 0 && bi < band.slots.length) {
            band.slots[bi] = this.formatCanvasLine(lead + windowLines[k]!, safeWidth);
          }
        }
      }

      for (let j = sliceStart; j < sliceEnd; j++) {
        const bi = j - band.origin;
        const slot =
          bi >= 0 && bi < band.slots.length ? band.slots[bi] : undefined;
        out.push(slot ?? this.formatCanvasLine(lead, safeWidth));
      }
      return;
    }

    // ── Legacy path (ToolCall, composite cards) ──────────────────────────
    if (!this.isCacheEnabled()) {
      this.childPaintCallsThisFrame += 1;
      const lines = child.render(inner);
      for (let j = sliceStart; j < sliceEnd; j++) {
        out.push(this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth));
      }
      return;
    }

    const childCount = this.children.length;
    const cache = this.ensureOverflowCache(inner, safeWidth, childCount);
    let lines = cache.childRenderRefs[childIndex];

    if (cache.childRefs[childIndex] !== child || lines === undefined) {
      // Cold intersection under budget: placeholders only. Never cache them so
      // a later content frame re-materializes. Budget applies to settle/content
      // (small) — unlimited cold layouts on settle were the post-fling hitch.
      if (this.coldMaterializeBudget <= 0) {
        this.pushPlaceholders(out, rowCount, safeWidth);
        return;
      }
      this.coldMaterializeBudget -= 1;
      this.childPaintCallsThisFrame += 1;
      lines = child.render(inner);
      cache.childRefs[childIndex] = child;
      // Cap retained full line arrays: multi-k legacy bodies keep only a
      // viewport band of raw lines so flings cannot pin 5k×N string heaps.
      if (lines.length > LEGACY_FULL_LINE_RETAIN_CAP) {
        cache.childRenderRefs[childIndex] = undefined;
        // Still format a band from this one-shot render; do not pin full array.
        const band = this.ensureSparseBand(cache, childIndex, sliceStart, sliceEnd, lines.length);
        for (let j = sliceStart; j < sliceEnd; j++) {
          const bi = j - band.origin;
          if (bi >= 0 && bi < band.slots.length) {
            band.slots[bi] = this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth);
          }
          out.push(band.slots[bi] ?? this.formatCanvasLine(lead, safeWidth));
        }
        this.touchOverflowChild(childIndex);
        this.reconcileChildGeometry(inner, childIndex, child, lines.length);
        return;
      }
      cache.childRenderRefs[childIndex] = lines;
      cache.childFormattedSparse[childIndex] = undefined;
      cache.childSparseBands[childIndex] = undefined;
      this.touchOverflowChild(childIndex);
      this.reconcileChildGeometry(inner, childIndex, child, lines.length);
    } else {
      // Probe render only on content frames so live animation refs update.
      this.childPaintCallsThisFrame += 1;
      const nextLines = child.render(inner);
      if (nextLines !== lines) {
        lines = nextLines;
        if (lines.length > LEGACY_FULL_LINE_RETAIN_CAP) {
          cache.childRenderRefs[childIndex] = undefined;
        } else {
          cache.childRenderRefs[childIndex] = lines;
        }
        cache.childFormattedSparse[childIndex] = undefined;
        // Keep band; missing slots refilled below.
      }
    }

    // Compact band format (never geometry-length sparse).
    const geometryCount = lines?.length ??
      this.lineCountCache.get(inner)?.counts[childIndex] ??
      Math.max(sliceEnd, 1);
    const band = this.ensureSparseBand(cache, childIndex, sliceStart, sliceEnd, geometryCount);

    if (lines !== undefined) {
      for (let j = sliceStart; j < sliceEnd; j++) {
        const bi = j - band.origin;
        if (bi < 0 || bi >= band.slots.length) {
          out.push(this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth));
          continue;
        }
        let formatted = band.slots[bi];
        if (formatted === undefined) {
          formatted = this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth);
          band.slots[bi] = formatted;
        }
        out.push(formatted);
      }
      return;
    }

    // Multi-k legacy without pinned lines: only band slots (or placeholders).
    let anyMissing = false;
    for (let j = sliceStart; j < sliceEnd; j++) {
      const bi = j - band.origin;
      const slot = bi >= 0 && bi < band.slots.length ? band.slots[bi] : undefined;
      if (slot === undefined) anyMissing = true;
      out.push(slot ?? this.formatCanvasLine(`${' '.repeat(this.leftPad)}…`, safeWidth));
    }
    if (anyMissing) this.materializeContinuePending = true;
  }

  /**
   * Pure-scroll slice: read overflow cache only. Never invokes child paint.
   */
  private appendPureScrollCachedSlice(
    out: RendererRegionLine[],
    childIndex: number,
    child: Component,
    inner: number,
    safeWidth: number,
    sliceStart: number,
    sliceEnd: number,
    lead: string,
  ): void {
    const rowCount = Math.max(0, sliceEnd - sliceStart);
    if (!this.isCacheEnabled()) {
      this.pushPlaceholders(out, rowCount, safeWidth);
      return;
    }

    const cache = this.overflowRenderCache;
    if (
      cache === undefined ||
      cache.inner !== inner ||
      cache.safeWidth !== safeWidth ||
      cache.childRefs[childIndex] !== child
    ) {
      this.pushPlaceholders(out, rowCount, safeWidth);
      return;
    }

    // Prefer compact band (windowed + legacy multi-k).
    const band = cache.childSparseBands[childIndex];
    if (band !== undefined) {
      let anyMissing = false;
      for (let j = sliceStart; j < sliceEnd; j++) {
        const bi = j - band.origin;
        const slot =
          bi >= 0 && bi < band.slots.length ? band.slots[bi] : undefined;
        if (slot === undefined) anyMissing = true;
        out.push(slot ?? this.formatCanvasLine(`${' '.repeat(this.leftPad)}…`, safeWidth));
      }
      if (anyMissing) this.materializeContinuePending = true;
      return;
    }

    // Legacy full raw lines + optional full sparse (pre-band cache).
    const lines = cache.childRenderRefs[childIndex];
    const sparse = cache.childFormattedSparse[childIndex];
    if (lines === undefined && sparse === undefined) {
      this.pushPlaceholders(out, rowCount, safeWidth);
      return;
    }

    for (let j = sliceStart; j < sliceEnd; j++) {
      if (sparse !== undefined && sparse[j] !== undefined) {
        out.push(sparse[j]!);
        continue;
      }
      if (lines !== undefined) {
        // Format from cached raw lines without calling child — still O(viewport).
        out.push(this.formatCanvasLine(lead + (lines[j] ?? ''), safeWidth));
        continue;
      }
      this.materializeContinuePending = true;
      out.push(this.formatCanvasLine(`${' '.repeat(this.leftPad)}…`, safeWidth));
    }
  }

  private pushPlaceholders(
    out: RendererRegionLine[],
    rowCount: number,
    safeWidth: number,
  ): void {
    this.materializeContinuePending = true;
    const pad = ' '.repeat(this.leftPad);
    for (let k = 0; k < rowCount; k++) {
      out.push(this.formatCanvasLine(`${pad}…`, safeWidth));
    }
  }

  /**
   * Compact viewport band for sparse format slots. Migrates overlapping rows
   * from the previous band. Never sized to full geometry height.
   */
  private ensureSparseBand(
    cache: RendererTranscriptOverflowRenderCache,
    childIndex: number,
    sliceStart: number,
    sliceEnd: number,
    geometryCount: number,
  ): RendererTranscriptSparseBand {
    const windowRows = Math.max(1, sliceEnd - sliceStart);
    const bandMargin = windowRows * OVERFLOW_RETAIN_VIEWPORTS;
    const bandStart = Math.max(0, sliceStart - bandMargin);
    const bandEnd = Math.min(Math.max(geometryCount, sliceEnd), sliceEnd + bandMargin);
    const bandLen = Math.max(0, bandEnd - bandStart);
    const prevBand = cache.childSparseBands[childIndex];
    const band: RendererTranscriptSparseBand = {
      origin: bandStart,
      slots: Array.from({ length: bandLen }),
    };
    if (prevBand !== undefined) {
      for (let j = bandStart; j < bandEnd; j++) {
        const prevIdx = j - prevBand.origin;
        if (prevIdx >= 0 && prevIdx < prevBand.slots.length) {
          band.slots[j - bandStart] = prevBand.slots[prevIdx];
        }
      }
    }
    cache.childSparseBands[childIndex] = band;
    return band;
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

/** Prefer windowed measure; fall back to full render length for legacy cards. */
function measureChildContentRows(child: Component, inner: number): number {
  if (supportsWindowedBody(child)) {
    return child.measureContentRows(inner);
  }
  return child.render(inner).length;
}
