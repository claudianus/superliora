import type { RendererDamageScanStrategy } from '../render/damage';

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
