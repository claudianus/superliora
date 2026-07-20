import { displayClusterWidth, splitDisplayClusters } from './text-metrics';
import {
  clipRendererDamageRect,
  planRendererDamage,
  unionRendererDamageRect,
  type RendererDamageScanStrategy,
} from './damage';

export interface RendererCellStyle {
  readonly fg?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
}

export interface RendererCell {
  readonly char: string;
  readonly style?: RendererCellStyle;
  readonly link?: string;
  readonly width?: number;
  readonly continuation?: boolean;
}

export interface RendererDamageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RendererDirtyRowSpan {
  readonly y: number;
  readonly x: number;
  readonly width: number;
}

export interface RendererCellPatch {
  readonly x: number;
  readonly y: number;
  readonly cell: RendererCell;
}

export interface RendererFrameDiff {
  readonly patches: readonly RendererCellPatch[];
  readonly runs?: readonly RendererRenderRun[];
  readonly damage: RendererDamageRect | null;
  readonly force: boolean;
  readonly scanStrategy: RendererDamageScanStrategy;
  readonly changedCells: number;
  readonly outputCells?: number;
  readonly bridgedCells?: number;
  readonly renderRuns?: number;
  readonly scannedCells: number;
  readonly scannedRows: number;
  readonly dirtyRows: number;
  readonly totalCells: number;
  readonly scanRatio: number;
  readonly damageCells: number;
  readonly damageRatio: number;
  /**
   * Scroll delta detected for this frame (positive = content scrolled up,
   * negative = content scrolled down). When set, the encoder can emit a
   * terminal scroll-region command instead of re-encoding shifted rows.
   */
  readonly scrollDelta?: number;
}

export interface RendererRenderRun {
  readonly x: number;
  readonly y: number;
  readonly cells: readonly RendererCell[];
}

export interface RendererRunOptimizationOptions {
  readonly maxGapCells?: number;
}

export type RendererRunOptimizationInput = boolean | RendererRunOptimizationOptions;

export interface RendererOptimizedRunPlan {
  readonly runs: readonly RendererRenderRun[];
  readonly outputCells: number;
  readonly bridgedCells: number;
}

const EMPTY_CELL: RendererCell = { char: ' ' };
const DEFAULT_RENDER_RUN_MAX_GAP_CELLS = 3;

export class RendererCellBuffer {
  private cells: RendererCell[];
  private damageRect: RendererDamageRect | null = null;
  /** Per-row intervals — overlapping/adjacent merge; disjoint gaps stay split. */
  private dirtyRowMap = new Map<number, { x: number; endX: number }[]>();
  /**
   * Copy-on-write peer. When set, `cells` is shared with that buffer — mutate
   * only after {@link ensureUniqueCells} so the other frame stays immutable.
   */
  private cowPeer: RendererCellBuffer | null = null;
  /**
   * Per-row XOR checksums for O(1) row-level diff skip. Each cell contributes
   * a position-dependent hash; when a cell changes, the row checksum is updated
   * incrementally via XOR (self-inverse). Used by {@link diffCellBuffers} to
   * skip rows whose content provably matches the previous frame.
   */
  private rowChecksums: Uint32Array;

  constructor(
    public readonly width: number,
    public readonly height: number,
    fill: RendererCell = EMPTY_CELL,
  ) {
    const safeWidth = normalizeSize(width);
    const safeHeight = normalizeSize(height);
    if (safeWidth !== width || safeHeight !== height) {
      throw new RangeError('RendererCellBuffer dimensions must be finite non-negative integers.');
    }
    this.cells = Array.from({ length: width * height }, () => normalizeCell(fill));
    this.rowChecksums = new Uint32Array(height);
    this.recomputeAllChecksums();
  }

  get damage(): RendererDamageRect | null {
    return this.damageRect;
  }

  get dirtyRowCount(): number {
    return this.dirtyRowMap.size;
  }

  get dirtyRowSpans(): readonly RendererDirtyRowSpan[] {
    const spans: RendererDirtyRowSpan[] = [];
    for (const [y, intervals] of this.dirtyRowMap) {
      for (const span of intervals) {
        spans.push({ y, x: span.x, width: span.endX - span.x });
      }
    }
    return spans.toSorted(compareDirtyRowSpans);
  }

  get totalCells(): number {
    return this.cells.length;
  }

  getCell(x: number, y: number): RendererCell {
    if (!this.contains(x, y)) return EMPTY_CELL;
    return this.cells[this.indexOf(x, y)]!;
  }

  /** O(1) row checksum for diff acceleration. */
  rowChecksum(y: number): number {
    if (y < 0 || y >= this.height) return 0;
    return this.rowChecksums[y]!;
  }

  setCell(x: number, y: number, cell: RendererCell): void {
    if (!this.contains(x, y)) return;
    const next = normalizeCell(cell);
    const index = this.indexOf(x, y);
    const prev = this.cells[index]!;
    if (normalizedCellsEqual(prev, next)) return;
    this.ensureUniqueCells();
    this.cells[index] = next;
    // Incremental XOR checksum update: remove old contribution, add new.
    this.rowChecksums[y]! ^= cellPositionHash(x, prev) ^ cellPositionHash(x, next);
    this.markDamage({ x, y, width: 1, height: 1 });
  }

  /**
   * Batch-write a span of cells into row `y` starting at column `x`.
   * Maps `cells[srcOffset + i]` → buffer `(x + i, y)` for `i = 0..width-1`.
   * Performs a single bounds check, single COW clone, and single damage mark
   * instead of per-cell overhead. Used by the compositor hot path.
   */
  setRowSpan(y: number, x: number, cells: readonly RendererCell[], srcOffset: number, width: number): void {
    if (y < 0 || y >= this.height) return;
    const startX = Math.max(0, x);
    const endX = Math.min(this.width, x + width);
    if (startX >= endX) return;

    // First pass: check if any cell actually differs (avoid COW clone if no-op).
    let changed = false;
    for (let cx = startX; cx < endX; cx++) {
      const srcIndex = srcOffset + (cx - x);
      if (srcIndex < 0 || srcIndex >= cells.length) continue;
      const next = normalizeCell(cells[srcIndex]!);
      const prev = this.cells[this.indexOf(cx, y)]!;
      if (!normalizedCellsEqual(prev, next)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.ensureUniqueCells();
    let damageX0 = endX;
    let damageX1 = startX;
    for (let cx = startX; cx < endX; cx++) {
      const srcIndex = srcOffset + (cx - x);
      if (srcIndex < 0 || srcIndex >= cells.length) continue;
      const next = normalizeCell(cells[srcIndex]!);
      const index = this.indexOf(cx, y);
      const prev = this.cells[index]!;
      if (normalizedCellsEqual(prev, next)) continue;
      this.cells[index] = next;
      this.rowChecksums[y]! ^= cellPositionHash(cx, prev) ^ cellPositionHash(cx, next);
      if (cx < damageX0) damageX0 = cx;
      if (cx > damageX1) damageX1 = cx;
    }
    if (damageX0 <= damageX1) {
      this.markDamage({ x: damageX0, y, width: damageX1 - damageX0 + 1, height: 1 });
    }
  }

  fillRect(rect: RendererDamageRect, cell: RendererCell = EMPTY_CELL): void {
    const clipped = clipRendererDamageRect(rect, this.width, this.height);
    if (clipped === null) return;

    const next = normalizeCell(cell);
    let damage: RendererDamageRect | null = null;
    let cloned = false;
    for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
      let rowChanged = false;
      for (let x = clipped.x; x < clipped.x + clipped.width; x++) {
        const index = this.indexOf(x, y);
        const prev = this.cells[index]!;
        if (normalizedCellsEqual(prev, next)) continue;
        if (!cloned) {
          this.ensureUniqueCells();
          cloned = true;
        }
        this.cells[index] = next;
        this.rowChecksums[y]! ^= cellPositionHash(x, prev) ^ cellPositionHash(x, next);
        rowChanged = true;
        damage = unionRendererDamageRect(damage, { x, y, width: 1, height: 1 });
      }
      void rowChanged;
    }
    // Only the cells that actually changed — marking the whole fill rect made
    // letterbox clear:true scans look like full-band damage on every twinkle.
    if (damage !== null) this.markDamage(damage);
  }

  clear(cell: RendererCell = EMPTY_CELL): void {
    this.fillRect({ x: 0, y: 0, width: this.width, height: this.height }, cell);
  }

  writeText(x: number, y: number, text: string, style?: RendererCellStyle): void {
    let cursorX = Math.floor(x);
    let cursorY = Math.floor(y);
    const lineStartX = cursorX;
    const cellStyle = normalizeStyle(style);

    for (const cluster of splitDisplayClusters(text)) {
      if (cursorY >= this.height) return;
      if (cluster.text === '\n') {
        cursorX = lineStartX;
        cursorY++;
        continue;
      }
      if (cluster.text === '\r') {
        cursorX = lineStartX;
        continue;
      }

      if (cluster.text === '\t') {
        for (let i = 0; i < 4; i++) {
          if (cursorY >= 0 && cursorX >= 0 && cursorX < this.width) {
            this.setCell(cursorX, cursorY, { char: ' ', style: cellStyle });
          }
          cursorX++;
        }
        continue;
      }

      if (cluster.width <= 0) continue;
      if (cluster.width === 1) {
        if (cursorY >= 0 && cursorX >= 0 && cursorX < this.width) {
          this.setCell(cursorX, cursorY, { char: cluster.text, style: cellStyle });
        }
        cursorX += 1;
        continue;
      }

      if (cursorY >= 0 && cursorX >= 0 && cursorX + 1 < this.width) {
        this.setCell(cursorX, cursorY, {
          char: cluster.text,
          style: cellStyle,
          width: 2,
        });
        this.setCell(cursorX + 1, cursorY, {
          char: '',
          style: cellStyle,
          width: 0,
          continuation: true,
        });
      }
      cursorX += cluster.width;
    }
  }

  copyFrom(other: RendererCellBuffer): void {
    if (this.width !== other.width || this.height !== other.height) {
      throw new RangeError('RendererCellBuffer.copyFrom requires matching dimensions.');
    }
    this.unlinkCow();
    other.unlinkCow();
    // Shallow cell refs — cells are already normalized on write. Remapping
    // normalizeCell across the whole frame was Θ(W·H) on every ambient present.
    this.cells = other.cells.slice();
    this.rowChecksums = other.rowChecksums.slice();
    this.damageRect = other.damageRect;
    this.dirtyRowMap = new Map(other.dirtyRowMap);
  }

  /**
   * Exchange cell storage with `other` (same dimensions). Used by double-buffer
   * present to avoid a full-frame copy when the next buffer becomes current.
   */
  swapContentWith(other: RendererCellBuffer): void {
    if (this.width !== other.width || this.height !== other.height) {
      throw new RangeError('RendererCellBuffer.swapContentWith requires matching dimensions.');
    }
    if (this.cowPeer === other && other.cowPeer === this) {
      // Shared storage — only damage metadata differs.
      const damageRect = this.damageRect;
      const dirtyRowMap = this.dirtyRowMap;
      this.damageRect = other.damageRect;
      this.dirtyRowMap = other.dirtyRowMap;
      other.damageRect = damageRect;
      other.dirtyRowMap = dirtyRowMap;
      return;
    }
    this.unlinkCow();
    other.unlinkCow();
    const cells = this.cells;
    const damageRect = this.damageRect;
    const dirtyRowMap = this.dirtyRowMap;
    const checksums = this.rowChecksums;
    this.cells = other.cells;
    this.damageRect = other.damageRect;
    this.dirtyRowMap = other.dirtyRowMap;
    this.rowChecksums = other.rowChecksums;
    other.cells = cells;
    other.damageRect = damageRect;
    other.dirtyRowMap = dirtyRowMap;
    other.rowChecksums = checksums;
  }

  /**
   * Alias `other` cells (copy-on-write). Next mutate clones. Prefer this over
   * {@link mirrorCellsFrom} on the ambient hot path — avoids Θ(W·H) every tick
   * when the following compose only touches a few cells.
   */
  shareCellsFrom(other: RendererCellBuffer): void {
    if (this.width !== other.width || this.height !== other.height) {
      throw new RangeError('RendererCellBuffer.shareCellsFrom requires matching dimensions.');
    }
    if (this === other) return;
    if (this.cells === other.cells && this.cowPeer === other && other.cowPeer === this) {
      return;
    }
    this.unlinkCow();
    other.unlinkCow();
    this.cells = other.cells;
    this.rowChecksums = other.rowChecksums;
    this.cowPeer = other;
    other.cowPeer = this;
  }

  /** Exclusive shallow copy of `other` cell refs (clear:false baseline). */
  mirrorCellsFrom(other: RendererCellBuffer): void {
    if (this.width !== other.width || this.height !== other.height) {
      throw new RangeError('RendererCellBuffer.mirrorCellsFrom requires matching dimensions.');
    }
    this.unlinkCow();
    this.cells = other.cells.slice();
    this.rowChecksums = other.rowChecksums.slice();
  }

  resetDamage(): void {
    this.damageRect = null;
    this.dirtyRowMap.clear();
  }

  private unlinkCow(): void {
    if (this.cowPeer === null) return;
    this.cowPeer.cowPeer = null;
    this.cowPeer = null;
  }

  private ensureUniqueCells(): void {
    if (this.cowPeer === null) return;
    const peer = this.cowPeer;
    this.cells = this.cells.slice();
    this.rowChecksums = this.rowChecksums.slice();
    this.cowPeer = null;
    peer.cowPeer = null;
  }

  private contains(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  private indexOf(x: number, y: number): number {
    return y * this.width + x;
  }

  private markDamage(rect: RendererDamageRect): void {
    const clipped = clipRendererDamageRect(rect, this.width, this.height);
    if (clipped === null) return;
    this.damageRect = unionRendererDamageRect(this.damageRect, clipped);
    this.markDirtyRows(clipped);
  }

  private markDirtyRows(rect: RendererDamageRect): void {
    const x = rect.x;
    const endX = rect.x + rect.width;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      const existing = this.dirtyRowMap.get(y) ?? [];
      this.dirtyRowMap.set(y, mergeDirtyRowIntervals(existing, x, endX));
    }
  }

  /** Recompute all row checksums from scratch (constructor / resize). */
  private recomputeAllChecksums(): void {
    for (let y = 0; y < this.height; y++) {
      let checksum = 0;
      const rowStart = y * this.width;
      for (let x = 0; x < this.width; x++) {
        checksum ^= cellPositionHash(x, this.cells[rowStart + x]!);
      }
      this.rowChecksums[y] = checksum >>> 0;
    }
  }
}

/**
 * Merge [x, endX) into sorted row intervals.
 * Overlapping or adjacent ranges coalesce; a gap stays as separate spans so
 * left+right letterbox damage does not scan the centered stage between them.
 */
export function mergeDirtyRowIntervals(
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

export interface RendererDiffOptions {
  /**
   * Full-frame scan (ignore damage/dirty-row narrowing). Does **not** by itself
   * re-emit cells that still match the previous buffer — use `rewriteUnchanged`
   * when the terminal surface is known to be out of sync with `previous`.
   */
  readonly force?: boolean;
  /**
   * Emit every scanned cell even when it equals the previous buffer. Needed
   * after an external terminal clear/resync; ambient animation must never set this.
   */
  readonly rewriteUnchanged?: boolean;
  readonly damage?: RendererDamageRect | null;
  readonly dirtyRows?: readonly RendererDirtyRowSpan[] | null;
  readonly runOptimization?: RendererRunOptimizationInput;
}

export class RendererDoubleBuffer {
  readonly current: RendererCellBuffer;
  readonly next: RendererCellBuffer;

  constructor(width: number, height: number, fill: RendererCell = EMPTY_CELL) {
    this.current = new RendererCellBuffer(width, height, fill);
    this.next = new RendererCellBuffer(width, height, fill);
  }

  beginFrame(options: { readonly clear?: boolean; readonly fill?: RendererCell } = {}): void {
    this.next.resetDamage();
    if (options.clear !== false) this.next.clear(options.fill);
  }

  present(
    options: {
      readonly force?: boolean;
      readonly rewriteUnchanged?: boolean;
      readonly runOptimization?: RendererRunOptimizationInput;
    } = {},
  ): RendererFrameDiff {
    const diff = diffCellBuffers(this.current, this.next, {
      force: options.force,
      rewriteUnchanged: options.rewriteUnchanged,
      damage: this.next.damage,
      dirtyRows: this.next.dirtyRowSpans,
      runOptimization: options.runOptimization,
    });
    // Flip: presented `next` becomes `current`. Share cells into `next` so the
    // next clear:false compose starts identical without Θ(W·H) slice until the
    // first write copy-on-writes.
    this.current.swapContentWith(this.next);
    this.next.shareCellsFrom(this.current);
    this.current.resetDamage();
    this.next.resetDamage();
    return diff;
  }
}

export function diffCellBuffers(
  previous: RendererCellBuffer,
  next: RendererCellBuffer,
  options: RendererDiffOptions = {},
): RendererFrameDiff {
  if (previous.width !== next.width || previous.height !== next.height) {
    throw new RangeError('diffCellBuffers requires matching dimensions.');
  }

  const force = options.force === true;
  const rewriteUnchanged = options.rewriteUnchanged === true;
  const plan = planRendererDamage({
    width: next.width,
    height: next.height,
    force,
    damage: options.damage,
    dirtyRows: options.dirtyRows,
  });
  const patches: RendererCellPatch[] = [];
  let scannedCells = 0;
  let scannedRows = 0;

  for (const span of plan.spans) {
    scannedRows++;
    // Row-level checksum short-circuit: if both buffers agree on the row's
    // XOR checksum, no cell in that row can have changed. Skip the per-cell
    // scan entirely — O(1) instead of O(width). Only applies to non-forced,
    // non-rewrite scans where we only care about actual changes.
    if (
      !force &&
      !rewriteUnchanged &&
      previous.rowChecksum(span.y) === next.rowChecksum(span.y)
    ) {
      continue;
    }
    for (let x = span.x; x < span.x + span.width; x++) {
      scannedCells++;
      const y = span.y;
      const cell = next.getCell(x, y);
      // force = full scan only. Re-emitting equal cells causes whole-screen
      // flicker on high-frequency animation ticks; require rewriteUnchanged.
      // Both buffers only ever hold normalized cells, so the allocation-free
      // normalized comparator is exact here.
      if (!rewriteUnchanged && normalizedCellsEqual(previous.getCell(x, y), cell)) continue;
      patches.push({ x, y, cell });
    }
  }
  const optimizedRuns = createOptimizedRunPlan(patches, next, options.runOptimization);
  const changedCells = patches.length;
  // Soft-force may scan the whole frame while rewriting only a few cells.
  // Sync / large-frame policy must follow rewrite coverage, not scan coverage —
  // otherwise every forced ambient-style tick looked like a 100% damage frame.
  const damageCells = rewriteUnchanged ? plan.damageCells : changedCells;
  const totalCells = next.totalCells;
  const damageRatio = totalCells === 0 ? 0 : damageCells / totalCells;

  return {
    patches,
    runs: optimizedRuns?.runs,
    damage: plan.damage,
    force,
    scanStrategy: plan.strategy,
    changedCells,
    outputCells: optimizedRuns?.outputCells,
    bridgedCells: optimizedRuns?.bridgedCells,
    renderRuns: optimizedRuns?.runs.length,
    scannedCells,
    scannedRows,
    dirtyRows: plan.dirtyRows,
    totalCells,
    scanRatio: plan.scanRatio,
    damageCells,
    damageRatio,
  };
}

function compareDirtyRowSpans(a: RendererDirtyRowSpan, b: RendererDirtyRowSpan): number {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
}

export function coalesceCellPatches(
  patches: readonly RendererCellPatch[],
): readonly RendererRenderRun[] {
  const runs: RendererRenderRun[] = [];
  let active: { x: number; y: number; cells: RendererCell[] } | null = null;

  for (const patch of patches) {
    if (
      active !== null &&
      patch.y === active.y &&
      patch.x === active.x + active.cells.length
    ) {
      active.cells.push(patch.cell);
      continue;
    }
    if (active !== null) runs.push(active);
    active = { x: patch.x, y: patch.y, cells: [patch.cell] };
  }

  if (active !== null) runs.push(active);
  return runs;
}

export function coalesceCellPatchesWithFrameGaps(
  patches: readonly RendererCellPatch[],
  frame: RendererCellBuffer,
  options: RendererRunOptimizationOptions = {},
): RendererOptimizedRunPlan {
  const maxGapCells = normalizeMaxGapCells(options.maxGapCells);
  const runs: RendererRenderRun[] = [];
  let active: { x: number; y: number; cells: RendererCell[] } | null = null;
  let bridgedCells = 0;

  for (const patch of patches) {
    if (active !== null && patch.y === active.y) {
      const activeEndX = active.x + active.cells.length;
      const gapWidth = patch.x - activeEndX;
      if (gapWidth === 0) {
        active.cells.push(patch.cell);
        continue;
      }
      if (gapWidth > 0 && gapWidth <= maxGapCells) {
        const gapCells = readRendererGapCells(frame, activeEndX, patch.y, gapWidth);
        if (canBridgeRendererGap(gapCells)) {
          active.cells.push(...gapCells, patch.cell);
          bridgedCells += gapCells.length;
          continue;
        }
      }
    }

    if (active !== null) runs.push(active);
    active = { x: patch.x, y: patch.y, cells: [patch.cell] };
  }

  if (active !== null) runs.push(active);
  return {
    runs,
    outputCells: runs.reduce((total, run) => total + run.cells.length, 0),
    bridgedCells,
  };
}

export function cellsEqual(a: RendererCell, b: RendererCell): boolean {
  if (a === b) return true;
  if (a.char !== b.char) return false;
  if (a.continuation !== b.continuation) return false;
  if (normalizedCellWidth(a) !== normalizedCellWidth(b)) return false;
  if (normalizeLink(a.link) !== normalizeLink(b.link)) return false;
  return stylesEqual(a.style, b.style);
}

/**
 * Allocation-free equality for cells that are already normalized — i.e. every
 * cell stored inside a {@link RendererCellBuffer} (constructor, setCell,
 * fillRect, copyFrom all normalize on write). Skips re-normalization, object
 * allocation, and `Object.keys`, comparing fields directly with reference
 * shortcuts. This is the hot path for per-cell diff scans.
 *
 * Must NOT be used for arbitrary/unnormalized cells (e.g. VFX output or
 * terminal-output style probes); use the public {@link cellsEqual} there.
 */
function normalizedCellsEqual(a: RendererCell, b: RendererCell): boolean {
  if (a === b) return true;
  return (
    a.char === b.char &&
    a.link === b.link &&
    a.width === b.width &&
    a.continuation === b.continuation &&
    normalizedStylesEqual(a.style, b.style)
  );
}

/**
 * Position-dependent cell hash for XOR-based row checksums.
 *
 * Combines x-coordinate, character code point, width/continuation flags, and
 * style field hashes into a single uint32. The hash is deterministic for
 * normalized cells and position-sensitive (same cell at different columns
 * produces different hashes) so that column-shifted content is detected.
 *
 * Uses Math.imul for 32-bit multiply to avoid floating-point rounding.
 */
function cellPositionHash(x: number, cell: RendererCell): number {
  // Mix position with golden ratio constant for good distribution.
  // `pos` is unique per column and feeds into the character hash below so
  // that the same character change at different columns produces different
  // XOR deltas — preventing even-count cancellation in the row checksum.
  const pos = Math.imul(x + 1, 0x9e3779b9);
  let h = pos;
  // Character code point mixed with position (BMP fast path).
  const code = cell.char.length === 1 ? cell.char.charCodeAt(0) : (cell.char.codePointAt(0) ?? 0);
  h ^= Math.imul(code + 1, pos);
  // Width and continuation flags.
  h ^= (cell.width ?? 1) << 16;
  if (cell.continuation === true) h ^= 0x40000000;
  // Style content hash (field-based, not reference-based).
  h ^= normalizedStyleHash(cell.style);
  // Link presence hash.
  if (cell.link !== undefined) {
    h ^= Math.imul(cell.link.length + 1, 0xc2b2ae35);
    // Sample first/last char codes for cheap discrimination.
    h ^= cell.link.charCodeAt(0) << 8;
    if (cell.link.length > 1) h ^= cell.link.charCodeAt(cell.link.length - 1);
  }
  return h >>> 0;
}

/**
 * Numeric hash of a normalized style's fields. Returns 0 for undefined.
 * Field-based (not reference-based) so logically equal styles hash equally.
 */
function normalizedStyleHash(style: RendererCellStyle | undefined): number {
  if (style === undefined) return 0;
  let h = 0x12345678;
  if (style.fg !== undefined) h ^= Math.imul(style.fg.length + 1, 0x27d4eb2f) ^ hashShortString(style.fg);
  if (style.bg !== undefined) h ^= Math.imul(style.bg.length + 1, 0x165667b1) ^ hashShortString(style.bg);
  let flags = 0;
  if (style.bold === true) flags |= 1;
  if (style.dim === true) flags |= 2;
  if (style.italic === true) flags |= 4;
  if (style.underline === true) flags |= 8;
  if (style.inverse === true) flags |= 16;
  h ^= flags << 24;
  return h >>> 0;
}

/** FNV-1a inspired hash for short strings (color hex values, typically 4-7 chars). */
function hashShortString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Allocation-free style equality for normalized styles (flags are `true` or
 * absent, never `false`). Reference-equal styles short-circuit immediately,
 * which is the common case when a run of cells shares one style object.
 */
function normalizedStylesEqual(
  a: RendererCellStyle | undefined,
  b: RendererCellStyle | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

function normalizeSize(value: number): number {
  if (!Number.isFinite(value) || value < 0) return -1;
  return Math.floor(value);
}

function createOptimizedRunPlan(
  patches: readonly RendererCellPatch[],
  frame: RendererCellBuffer,
  input: RendererRunOptimizationInput | undefined,
): RendererOptimizedRunPlan | undefined {
  if (input === undefined || input === false) return undefined;
  const options = input === true ? {} : input;
  return coalesceCellPatchesWithFrameGaps(patches, frame, options);
}

function normalizeMaxGapCells(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_RENDER_RUN_MAX_GAP_CELLS;
  }
  return Math.floor(value);
}

function readRendererGapCells(
  frame: RendererCellBuffer,
  x: number,
  y: number,
  width: number,
): RendererCell[] {
  return Array.from({ length: width }, (_, offset) => frame.getCell(x + offset, y));
}

function canBridgeRendererGap(cells: readonly RendererCell[]): boolean {
  if (cells.length === 0) return true;
  if (cells[0]?.continuation === true) return false;

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    if (cell.continuation === true || cell.width === 0) {
      if (cell.style !== undefined || cell.link !== undefined) return false;
      if (index === 0 || normalizedCellWidth(cells[index - 1]!) !== 2) return false;
      continue;
    }
    if (cell.style !== undefined || cell.link !== undefined) return false;
    if (normalizedCellWidth(cell) === 2 && cells[index + 1]?.continuation !== true) {
      return false;
    }
  }

  return true;
}

function normalizeCell(cell: RendererCell): RendererCell {
  const link = normalizeLink(cell.link);
  if (cell.continuation === true || cell.width === 0) {
    const style = normalizeStyle(cell.style);
    return applyCellMetadata({ char: '', width: 0, continuation: true }, style, link);
  }
  // Ambient paints mostly single printable BMP glyphs — skip grapheme split.
  // A single UTF-16 code unit that is a printable BMP char (including wide
  // chars like 한글) is its own cluster, so only control/DEL chars and
  // multi-unit strings need the segmenter. Width is still measured below
  // (displayClusterWidth has its own ASCII fast path).
  const raw = cell.char;
  let char: string;
  if (raw.length === 1) {
    const code = raw.codePointAt(0);
    char =
      code !== undefined && code >= 0x20 && code !== 0x7f
        ? raw
        : (splitDisplayClusters(raw)[0]?.text ?? ' ');
  } else if (raw.length === 0) {
    char = ' ';
  } else {
    char = splitDisplayClusters(raw)[0]?.text ?? ' ';
  }
  const style = normalizeStyle(cell.style);
  const width = Math.max(1, Math.min(2, cell.width ?? displayClusterWidth(char)));
  return applyCellMetadata(width === 1 ? { char } : { char, width }, style, link);
}

function normalizedCellWidth(cell: RendererCell): number | undefined {
  if (cell.continuation === true || cell.width === 0) return 0;
  const width = cell.width ?? displayClusterWidth(cell.char);
  return width === 1 ? undefined : width;
}

function normalizeStyle(style: RendererCellStyle | undefined): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const normalized: {
    fg?: string;
    bg?: string;
    bold?: true;
    dim?: true;
    italic?: true;
    underline?: true;
    inverse?: true;
  } = {};
  if (style.fg !== undefined) normalized.fg = style.fg;
  if (style.bg !== undefined) normalized.bg = style.bg;
  if (style.bold === true) normalized.bold = true;
  if (style.dim === true) normalized.dim = true;
  if (style.italic === true) normalized.italic = true;
  if (style.underline === true) normalized.underline = true;
  if (style.inverse === true) normalized.inverse = true;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeLink(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  const normalized = link.replaceAll(/[\u0000-\u001F\u007F]/g, '');
  return normalized.length === 0 ? undefined : normalized;
}

function applyCellMetadata(
  cell: RendererCell,
  style: RendererCellStyle | undefined,
  link: string | undefined,
): RendererCell {
  if (style === undefined && link === undefined) return cell;
  const normalized: {
    char: string;
    style?: RendererCellStyle;
    link?: string;
    width?: number;
    continuation?: boolean;
  } = { char: cell.char };
  if (cell.width !== undefined) normalized.width = cell.width;
  if (cell.continuation !== undefined) normalized.continuation = cell.continuation;
  if (style !== undefined) normalized.style = style;
  if (link !== undefined) normalized.link = link;
  return normalized;
}

function stylesEqual(
  a: RendererCellStyle | undefined,
  b: RendererCellStyle | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Buffer cells store normalizeStyle() results — compare fields directly
  // instead of re-normalizing on every ambient scan.
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}
