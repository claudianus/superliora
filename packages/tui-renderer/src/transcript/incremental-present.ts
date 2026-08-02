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
   *
   * @param windowKey When the visible scroll window moves, pass a new key so
   *   placeholder-equal rows cannot keep pre-scroll content (flicker).
   */
  present(
    lines: readonly RendererRegionLine[],
    options?: { readonly windowKey?: string },
  ): TranscriptPresentResult {
    const windowKey = options?.windowKey;
    if (windowKey !== undefined && windowKey !== this.lastWindowKey) {
      this.lastWindowKey = windowKey;
      // Scroll/size change: drop prior identities so we never keep pre-scroll rows.
      this.lastPresented = undefined;
    }

    const keys = lines.map(regionLinePresentKey);
    this.engine.replaceAll(keys);
    // After a window move, force every row dirty even when placeholders hash-equal.
    if (this.lastPresented === undefined) {
      this.engine.invalidateAll();
    }
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

  private lastWindowKey: string | undefined;

  /**
   * Merge dirty rows into the presented buffer. Clean rows keep the previous
   * line reference so compositor/promote can skip work. Only dirty indices
   * take incoming (never bulk-replace clean rows — that reintroduced flicker).
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

    for (let i = 0; i < n; i++) {
      if (dirtyRows.has(i) || prev === undefined || prev.length !== n) {
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
    this.lastWindowKey = undefined;
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
