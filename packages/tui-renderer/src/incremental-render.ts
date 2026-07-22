/**
 * IncrementalRenderer — line-level diff engine for transcript rendering.
 *
 * Instead of re-rendering the entire transcript every frame, this module:
 * 1. Hashes each line's content and only re-renders dirty lines
 * 2. Manages a line pool to minimize GC pressure from string allocation
 * 3. Coordinates with the viewport to skip off-screen lines entirely
 * 4. Enforces a frame budget to prevent render stalls on large transcripts
 * 5. Batches cursor-movement sequences for minimal terminal I/O
 *
 * Integrates with the existing damage.ts (dirty rects) and line-cache.ts
 * (ANSI→cell conversion) for a complete incremental pipeline.
 *
 * Performance targets:
 * - 10k line transcript: <2ms per frame (only visible + dirty lines)
 * - Streaming append: O(1) per new line (hash + push)
 * - Scroll: O(visible_rows) with line reuse from pool
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncrementalLine {
  /** Content hash for change detection (FNV-1a 32-bit). */
  readonly hash: number;
  /** The rendered ANSI string. */
  readonly content: string;
  /** Frame timestamp when this line was last rendered to output. */
  lastPaintedFrame: number;
  /** Whether this line needs repainting. */
  dirty: boolean;
}

export interface IncrementalRenderStats {
  readonly totalLines: number;
  readonly visibleLines: number;
  readonly dirtyLines: number;
  readonly repaintedLines: number;
  readonly skippedLines: number;
  readonly frameTimeMs: number;
  readonly hashHits: number;
  readonly hashMisses: number;
}

export interface IncrementalRenderOptions {
  /** Maximum time (ms) to spend rendering per frame. Default: 8ms. */
  readonly frameBudgetMs?: number;
  /** Maximum lines to keep in the pool beyond visible area. Default: 200. */
  readonly poolOverflow?: number;
  /** Whether to use content hashing for change detection. Default: true. */
  readonly useHashing?: boolean;
}

export interface PaintCommand {
  /** Row index in the terminal viewport. */
  readonly row: number;
  /** The ANSI string to write at this row. */
  readonly content: string;
}

export interface ViewportRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FRAME_BUDGET_MS = 8;
const DEFAULT_POOL_OVERFLOW = 200;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// ---------------------------------------------------------------------------
// IncrementalRenderer
// ---------------------------------------------------------------------------

export class IncrementalRenderer {
  private lines: IncrementalLine[] = [];
  private readonly frameBudgetMs: number;
  private readonly poolOverflow: number;
  private readonly useHashing: boolean;
  private frameCounter = 0;
  private stats: IncrementalRenderStats;

  // Accumulated stats
  private _hashHits = 0;
  private _hashMisses = 0;

  constructor(options?: IncrementalRenderOptions) {
    this.frameBudgetMs = options?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS;
    this.poolOverflow = options?.poolOverflow ?? DEFAULT_POOL_OVERFLOW;
    this.useHashing = options?.useHashing ?? true;
    this.stats = this.emptyStats();
  }

  // ─── Content Management ───────────────────────────────────────────────

  /** Total number of lines in the buffer. */
  get lineCount(): number {
    return this.lines.length;
  }

  /**
   * Append a new line to the end of the buffer.
   * O(1) — just hash and push.
   */
  appendLine(content: string): void {
    this.lines.push({
      hash: this.useHashing ? fnv1a(content) : 0,
      content,
      lastPaintedFrame: -1,
      dirty: true,
    });
  }

  /**
   * Append multiple lines at once (batch streaming).
   */
  appendLines(contents: readonly string[]): void {
    for (const content of contents) {
      this.appendLine(content);
    }
  }

  /**
   * Update a line at a specific index. Only marks dirty if content changed.
   * Returns true if the line was actually modified.
   */
  updateLine(index: number, content: string): boolean {
    if (index < 0 || index >= this.lines.length) return false;

    const existing = this.lines[index]!;
    const newHash = this.useHashing ? fnv1a(content) : 0;

    // Fast path: hash match means no change
    if (this.useHashing && existing.hash === newHash && existing.content === content) {
      this._hashHits++;
      return false;
    }

    this._hashMisses++;
    this.lines[index] = {
      hash: newHash,
      content,
      lastPaintedFrame: existing.lastPaintedFrame,
      dirty: true,
    };
    return true;
  }

  /**
   * Replace the entire content (e.g. after compaction).
   * Diffs against existing lines to minimize dirty marks.
   */
  replaceAll(contents: readonly string[]): void {
    const oldLength = this.lines.length;
    const newLength = contents.length;

    // Update existing lines in place
    const minLength = Math.min(oldLength, newLength);
    for (let i = 0; i < minLength; i++) {
      this.updateLine(i, contents[i]!);
    }

    // Append new lines
    if (newLength > oldLength) {
      for (let i = oldLength; i < newLength; i++) {
        this.appendLine(contents[i]!);
      }
    }

    // Truncate removed lines
    if (newLength < oldLength) {
      this.lines.length = newLength;
    }
  }

  /**
   * Mark a range of lines as dirty (force repaint).
   */
  invalidateRange(start: number, end: number): void {
    const from = Math.max(0, start);
    const to = Math.min(this.lines.length, end);
    for (let i = from; i < to; i++) {
      this.lines[i]!.dirty = true;
    }
  }

  /** Mark all lines dirty (e.g. after theme change or resize). */
  invalidateAll(): void {
    for (const line of this.lines) {
      line.dirty = true;
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────

  /**
   * Compute the paint commands for the current frame.
   * Only returns commands for dirty lines within the viewport.
   * Respects the frame budget — may defer some lines to next frame.
   */
  computePaintCommands(viewport: ViewportRange): PaintCommand[] {
    this.frameCounter++;
    const startTime = performance.now();

    const start = Math.max(0, viewport.start);
    const end = Math.min(this.lines.length, viewport.end);
    const commands: PaintCommand[] = [];

    let repainted = 0;
    let skipped = 0;
    let dirtyCount = 0;

    for (let i = start; i < end; i++) {
      const line = this.lines[i]!;

      if (!line.dirty) {
        skipped++;
        continue;
      }

      dirtyCount++;

      // Frame budget check
      if (performance.now() - startTime > this.frameBudgetMs) {
        // Defer remaining dirty lines to next frame
        break;
      }

      commands.push({
        row: i - viewport.start,
        content: line.content,
      });

      line.dirty = false;
      line.lastPaintedFrame = this.frameCounter;
      repainted++;
    }

    // Update stats
    this.stats = {
      totalLines: this.lines.length,
      visibleLines: end - start,
      dirtyLines: dirtyCount,
      repaintedLines: repainted,
      skippedLines: skipped,
      frameTimeMs: performance.now() - startTime,
      hashHits: this._hashHits,
      hashMisses: this._hashMisses,
    };

    return commands;
  }

  /**
   * Check if there are still dirty lines in the viewport (needs another frame).
   */
  hasPendingDirtyLines(viewport: ViewportRange): boolean {
    const start = Math.max(0, viewport.start);
    const end = Math.min(this.lines.length, viewport.end);
    for (let i = start; i < end; i++) {
      if (this.lines[i]!.dirty) return true;
    }
    return false;
  }

  /**
   * Get the content of a specific line (for cursor-based partial updates).
   */
  getLineContent(index: number): string | null {
    if (index < 0 || index >= this.lines.length) return null;
    return this.lines[index]!.content;
  }

  // ─── Pool Management ──────────────────────────────────────────────────

  /**
   * Trim lines far outside the viewport to bound memory.
   * Keeps poolOverflow lines above and below the viewport.
   */
  trimPool(viewport: ViewportRange): number {
    const maxLines = (viewport.end - viewport.start) + this.poolOverflow * 2;
    if (this.lines.length <= maxLines) return 0;

    // For transcript-style append-only, trim from the top
    const excess = this.lines.length - maxLines;
    const trimStart = Math.max(0, viewport.start - this.poolOverflow);
    const actualTrim = Math.min(excess, trimStart);

    if (actualTrim > 0) {
      this.lines.splice(0, actualTrim);
    }
    return actualTrim;
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  get lastFrameStats(): IncrementalRenderStats {
    return this.stats;
  }

  get currentFrame(): number {
    return this.frameCounter;
  }

  /** Reset accumulated hash stats. */
  resetStats(): void {
    this._hashHits = 0;
    this._hashMisses = 0;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private emptyStats(): IncrementalRenderStats {
    return {
      totalLines: 0,
      visibleLines: 0,
      dirtyLines: 0,
      repaintedLines: 0,
      skippedLines: 0,
      frameTimeMs: 0,
      hashHits: 0,
      hashMisses: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Diff Engine — compute minimal edit operations between line arrays
// ---------------------------------------------------------------------------

export interface LineDiffOp {
  readonly type: 'keep' | 'insert' | 'delete' | 'update';
  readonly index: number;
  readonly content?: string;
}

/**
 * Compute a line-level diff between old and new content arrays.
 * Uses hash-based comparison for O(n) performance.
 * Returns the minimal set of operations to transform old → new.
 */
export function diffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
): LineDiffOp[] {
  const ops: LineDiffOp[] = [];
  const oldHashes = oldLines.map(fnv1a);
  const newHashes = newLines.map(fnv1a);

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldHashes[prefixLen] === newHashes[prefixLen]) {
    ops.push({ type: 'keep', index: prefixLen });
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldHashes[oldLines.length - 1 - suffixLen] === newHashes[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Middle section: lines that changed
  const oldMiddleEnd = oldLines.length - suffixLen;
  const newMiddleEnd = newLines.length - suffixLen;

  // Simple strategy: update in place where possible, insert/delete the rest
  const oldMiddleLen = oldMiddleEnd - prefixLen;
  const newMiddleLen = newMiddleEnd - prefixLen;
  const updateLen = Math.min(oldMiddleLen, newMiddleLen);

  for (let i = 0; i < updateLen; i++) {
    const idx = prefixLen + i;
    if (oldHashes[idx] !== newHashes[idx]) {
      ops.push({ type: 'update', index: idx, content: newLines[idx] });
    } else {
      ops.push({ type: 'keep', index: idx });
    }
  }

  // Insertions (new is longer)
  for (let i = updateLen; i < newMiddleLen; i++) {
    ops.push({ type: 'insert', index: prefixLen + i, content: newLines[prefixLen + i] });
  }

  // Deletions (old is longer)
  for (let i = updateLen; i < oldMiddleLen; i++) {
    ops.push({ type: 'delete', index: prefixLen + i });
  }

  // Suffix (kept)
  for (let i = 0; i < suffixLen; i++) {
    ops.push({ type: 'keep', index: newLines.length - suffixLen + i });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Terminal Output Batcher
// ---------------------------------------------------------------------------

export interface CursorPosition {
  readonly row: number;
  readonly col: number;
}

/**
 * Batch paint commands into optimized terminal output.
 * Groups consecutive rows to minimize cursor movement sequences.
 */
export function batchPaintOutput(
  commands: readonly PaintCommand[],
  options?: { readonly useAbsoluteCursor?: boolean },
): string {
  if (commands.length === 0) return '';

  const sorted = [...commands].sort((a, b) => a.row - b.row);
  const parts: string[] = [];
  let lastRow = -2; // Force first cursor move

  for (const cmd of sorted) {
    if (cmd.row !== lastRow + 1) {
      // Non-consecutive: emit cursor position
      parts.push(encodeCursorPosition(cmd.row, 0));
    }
    parts.push(cmd.content);
    parts.push('\r\n');
    lastRow = cmd.row;
  }

  return parts.join('');
}

/** Encode a cursor position escape sequence (1-based for terminals). */
function encodeCursorPosition(row: number, col: number): string {
  return `\x1b[${String(row + 1)};${String(col + 1)}H`;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash — fast, low collision for short strings. */
export function fnv1a(str: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0; // Ensure unsigned
}
