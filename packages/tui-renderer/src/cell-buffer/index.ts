import { ansiTextToCells } from '../ansi-text';
import {
  clipRendererDamageRect,
  unionRendererDamageRect,
} from '../damage';
import { splitDisplayClusters } from '../text/metrics';
import { compareDirtyRowSpans, mergeDirtyRowIntervals } from './dirty-rows';
import {
  cellPositionHash,
  EMPTY_CELL,
  normalizeCell,
  normalizeSize,
  normalizeStyle,
  normalizedCellsEqual,
} from './normalize';
import type {
  RendererCell,
  RendererCellStyle,
  RendererDamageRect,
  RendererDirtyRowSpan,
} from './types';

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

  /**
   * Write a chalk/ANSI-styled string, parsing CSI/SGR into cell styles.
   * Prefer this over {@link writeText} for any string that may contain escapes —
   * `writeText` treats `\u001B[38;2…m` as literal characters (ESC is zero-width,
   * so SGR bodies leak as visible `38;2…` / `[2m` garbage).
   */
  writeAnsiText(x: number, y: number, text: string): void {
    if (text.length === 0) return;
    const cells = ansiTextToCells(text);
    if (cells.length === 0) return;
    this.setRowSpan(Math.floor(y), Math.floor(x), cells, 0, cells.length);
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

export * from './types';
export { cellsEqual } from './normalize';
export { mergeDirtyRowIntervals } from './dirty-rows';
export { coalesceCellPatches, coalesceCellPatchesWithFrameGaps } from './patch-runs';
export { diffCellBuffers, RendererDoubleBuffer } from './diff';
