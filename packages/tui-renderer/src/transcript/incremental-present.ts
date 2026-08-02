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

/**
 * Visible transcript windows are tens of rows, not multi-k. Budget-deferring
 * dirty rows left stale scrolled content on screen (flicker) and kept
 * hasPendingDirty true so progressive content frames never settled (freeze).
 * Hash skip-clean is the win; never defer dirty rows in this path.
 */
const DEFAULT_PRESENT_BUDGET_MS = Number.POSITIVE_INFINITY;

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
   * Merge dirty rows into the presented buffer. Clean rows keep the previous
   * line reference. Scroll / full-window dirty: every dirty row is in
   * paintCommands (no budget defer), so the window never shows stale rows.
   */
  private applyPaintCommands(
    incoming: readonly RendererRegionLine[],
    paintCommands: readonly PaintCommand[],
  ): RendererRegionLine[] {
    const n = incoming.length;
    const prev = this.lastPresented;
    const out: RendererRegionLine[] = new Array(n);
    const dirtyRows = new Set<number>();
    for (const cmd of paintCommands) {
      if (cmd.row >= 0 && cmd.row < n) dirtyRows.add(cmd.row);
    }

    // Many dirty rows (scroll / first paint): prefer incoming for any row not
    // known-clean so we never keep prev content at a shifted scroll offset.
    const mostlyDirty = dirtyRows.size > n / 2;

    for (let i = 0; i < n; i++) {
      if (dirtyRows.has(i) || mostlyDirty || prev === undefined || prev.length !== n) {
        out[i] = incoming[i]!;
      } else {
        out[i] = prev[i]!;
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
