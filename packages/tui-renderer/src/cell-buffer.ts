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
  private dirtyRowMap = new Map<number, { x: number; endX: number }>();

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
  }

  get damage(): RendererDamageRect | null {
    return this.damageRect;
  }

  get dirtyRowCount(): number {
    return this.dirtyRowMap.size;
  }

  get dirtyRowSpans(): readonly RendererDirtyRowSpan[] {
    return Array.from(this.dirtyRowMap, ([y, span]) => ({
      y,
      x: span.x,
      width: span.endX - span.x,
    })).toSorted(compareDirtyRowSpans);
  }

  get totalCells(): number {
    return this.cells.length;
  }

  getCell(x: number, y: number): RendererCell {
    if (!this.contains(x, y)) return EMPTY_CELL;
    return this.cells[this.indexOf(x, y)]!;
  }

  setCell(x: number, y: number, cell: RendererCell): void {
    if (!this.contains(x, y)) return;
    const next = normalizeCell(cell);
    const index = this.indexOf(x, y);
    if (cellsEqual(this.cells[index]!, next)) return;
    this.cells[index] = next;
    this.markDamage({ x, y, width: 1, height: 1 });
  }

  fillRect(rect: RendererDamageRect, cell: RendererCell = EMPTY_CELL): void {
    const clipped = clipRendererDamageRect(rect, this.width, this.height);
    if (clipped === null) return;

    const next = normalizeCell(cell);
    let damage: RendererDamageRect | null = null;
    for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
      for (let x = clipped.x; x < clipped.x + clipped.width; x++) {
        const index = this.indexOf(x, y);
        if (cellsEqual(this.cells[index]!, next)) continue;
        this.cells[index] = next;
        damage = unionRendererDamageRect(damage, { x, y, width: 1, height: 1 });
      }
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
    this.cells = other.cells.map((cell) => normalizeCell(cell));
    this.damageRect = other.damageRect;
    this.dirtyRowMap = new Map(other.dirtyRowMap);
  }

  resetDamage(): void {
    this.damageRect = null;
    this.dirtyRowMap.clear();
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
      const existing = this.dirtyRowMap.get(y);
      this.dirtyRowMap.set(
        y,
        existing === undefined
          ? { x, endX }
          : { x: Math.min(existing.x, x), endX: Math.max(existing.endX, endX) },
      );
    }
  }
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
    this.current.copyFrom(this.next);
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
    for (let x = span.x; x < span.x + span.width; x++) {
      scannedCells++;
      const y = span.y;
      const cell = next.getCell(x, y);
      // force = full scan only. Re-emitting equal cells causes whole-screen
      // flicker on high-frequency animation ticks; require rewriteUnchanged.
      if (!rewriteUnchanged && cellsEqual(previous.getCell(x, y), cell)) continue;
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
  return (
    a.char === b.char &&
    normalizeLink(a.link) === normalizeLink(b.link) &&
    normalizedCellWidth(a) === normalizedCellWidth(b) &&
    a.continuation === b.continuation &&
    stylesEqual(a.style, b.style)
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
  const char = splitDisplayClusters(cell.char)[0]?.text ?? ' ';
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
  const left = normalizeStyle(a);
  const right = normalizeStyle(b);
  if (left === undefined || right === undefined) return left === right;
  return (
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.inverse === right.inverse
  );
}
