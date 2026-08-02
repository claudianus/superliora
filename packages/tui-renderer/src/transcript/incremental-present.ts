/**
 * Shipped transcript present step: IncrementalRenderer on the visible window.
 *
 * The viewport still produces a full visible-line window for layout/compose, but
 * this presenter tracks per-line hashes so stable re-presents skip clean rows
 * (repaint ≪ visible) and dirty work respects a hard per-frame budget.
 */

import {
  IncrementalRenderer,
  type IncrementalRenderStats,
  type PaintCommand,
} from '../frame/incremental-render';
import type { RendererRegionLine } from '../render/compositor';

export interface TranscriptPresentResult {
  /** Full visible window (unchanged) for layout/compose callers. */
  readonly lines: readonly RendererRegionLine[];
  /** Paint commands for dirty rows only (budget-capped). */
  readonly paintCommands: readonly PaintCommand[];
  readonly stats: IncrementalRenderStats;
  /** True when budget stopped before all dirty visible rows were painted. */
  readonly hasPendingDirty: boolean;
}

const DEFAULT_PRESENT_BUDGET_MS = 8;

/**
 * Owns one IncrementalRenderer for the transcript visible window present path.
 */
export class TranscriptVisibleLinePresenter {
  private readonly engine: IncrementalRenderer;
  private lastStats: IncrementalRenderStats;

  constructor(options?: { readonly frameBudgetMs?: number }) {
    this.engine = new IncrementalRenderer({
      frameBudgetMs: options?.frameBudgetMs ?? DEFAULT_PRESENT_BUDGET_MS,
      poolOverflow: 64,
      useHashing: true,
    });
    this.lastStats = this.engine.lastFrameStats;
  }

  get lastFrameStats(): IncrementalRenderStats {
    return this.lastStats;
  }

  /**
   * Present a visible window of region lines. Stable content re-present with
   * identical line keys yields repaintedLines ≈ 0 and skippedLines ≈ visible.
   */
  present(lines: readonly RendererRegionLine[]): TranscriptPresentResult {
    const keys = lines.map(regionLinePresentKey);
    this.engine.replaceAll(keys);
    const viewport = { start: 0, end: keys.length };
    const paintCommands = this.engine.computePaintCommands(viewport);
    this.lastStats = this.engine.lastFrameStats;
    return {
      lines,
      paintCommands,
      stats: this.lastStats,
      hasPendingDirty: this.engine.hasPendingDirtyLines(viewport),
    };
  }

  /** Force every line dirty (theme/resize). */
  invalidate(): void {
    this.engine.invalidateAll();
  }

  resetStats(): void {
    this.engine.resetStats();
  }
}

/** Stable present key for string or cell region lines. */
export function regionLinePresentKey(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  let out = '';
  for (const cell of line) {
    out += cell.char;
    if (cell.style?.fg !== undefined) out += `\0f${cell.style.fg}`;
    if (cell.style?.bg !== undefined) out += `\0b${cell.style.bg}`;
  }
  return out;
}
