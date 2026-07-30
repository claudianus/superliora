import { planRendererDamage } from '../render/damage';
import type {
  RendererCell,
  RendererCellPatch,
  RendererDiffOptions,
  RendererFrameDiff,
  RendererRunOptimizationInput,
} from './types';
import { EMPTY_CELL } from './normalize';
import { normalizedCellsEqual } from './normalize';
import { createOptimizedRunPlan } from './patch-runs';
import { RendererCellBuffer } from './index';

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
