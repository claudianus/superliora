import type { RendererCellBuffer } from './index';
import type {
  RendererCell,
  RendererCellPatch,
  RendererOptimizedRunPlan,
  RendererRenderRun,
  RendererRunOptimizationInput,
  RendererRunOptimizationOptions,
} from './types';
import { normalizedCellWidth } from './normalize';

const DEFAULT_RENDER_RUN_MAX_GAP_CELLS = 3;

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

export function createOptimizedRunPlan(
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
