/**
 * Shipped transcript present step: IncrementalRenderer on the visible window.
 *
 * Applies dirty-only paint commands into the returned line buffer: clean rows
 * keep the previous line object identity (compose/promote can skip work), dirty
 * rows within the frame budget take the new line, and budget-deferred dirty
 * rows keep the previous content until a continue frame. Hosts must schedule
 * another content paint when {@link TranscriptPresentResult.hasPendingDirty}.
 */

import {
  IncrementalRenderer,
  type IncrementalRenderStats,
  type PaintCommand,
} from '../frame/incremental-render';
import type { RendererRegionLine } from '../render/compositor';

export interface TranscriptPresentResult {
  /**
   * Presented visible window. Clean rows reuse prior line refs; only budgeted
   * dirty rows are replaced from the incoming window.
   */
  readonly lines: readonly RendererRegionLine[];
  /** Paint commands actually applied this frame (budget-capped). */
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
  /** Last presented buffer — clean rows keep these object identities. */
  private lastPresented: RendererRegionLine[] | undefined;

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
   * identical line keys yields repaintedLines ≈ 0, skippedLines ≈ visible, and
   * the same line object refs in {@link TranscriptPresentResult.lines}.
   */
  present(lines: readonly RendererRegionLine[]): TranscriptPresentResult {
    const keys = lines.map(regionLinePresentKey);
    this.engine.replaceAll(keys);
    const viewport = { start: 0, end: keys.length };
    const paintCommands = this.engine.computePaintCommands(viewport);
    this.lastStats = this.engine.lastFrameStats;

    const presented = this.applyPaintCommands(lines, paintCommands);
    this.lastPresented = presented;

    return {
      lines: presented,
      paintCommands,
      stats: this.lastStats,
      hasPendingDirty: this.engine.hasPendingDirtyLines(viewport),
    };
  }

  /**
   * Merge budgeted dirty rows into the presented buffer. Clean / deferred rows
   * keep the previous line reference when possible.
   */
  private applyPaintCommands(
    incoming: readonly RendererRegionLine[],
    paintCommands: readonly PaintCommand[],
  ): RendererRegionLine[] {
    const n = incoming.length;
    const prev = this.lastPresented;
    const out: RendererRegionLine[] = new Array(n);

    if (prev !== undefined && prev.length === n) {
      for (let i = 0; i < n; i++) {
        out[i] = prev[i]!;
      }
    } else {
      // Size change or first frame: seed with incoming so the window is full
      // even when the budget only applies a subset of dirty rows.
      for (let i = 0; i < n; i++) {
        out[i] = incoming[i]!;
      }
    }

    for (const cmd of paintCommands) {
      const row = cmd.row;
      if (row >= 0 && row < n) {
        out[row] = incoming[row]!;
      }
    }
    return out;
  }

  /** Force every line dirty (theme/resize) and drop presented identity. */
  invalidate(): void {
    this.engine.invalidateAll();
    this.lastPresented = undefined;
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
