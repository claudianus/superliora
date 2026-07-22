/**
 * ScrollViewport — virtual scrolling with smooth scroll and scrollbar.
 *
 * Provides efficient viewport management for large content:
 * - Virtual scrolling: only renders visible lines (+ overscan)
 * - Smooth scroll animation (ease-out interpolation)
 * - Scrollbar rendering (thin/full, position indicator)
 * - Mouse wheel support (configurable scroll speed)
 * - Page up/down, Home/End navigation
 * - Scroll momentum (inertial scrolling)
 * - Scroll position persistence per content ID
 * - Horizontal scrolling for wide content
 * - Scroll event callbacks
 * - Content height tracking with dynamic updates
 * - Jump-to-line functionality
 *
 * Architecture:
 * - Content is an array of pre-rendered lines (strings)
 * - Viewport shows a window of [scrollY, scrollY + height) lines
 * - Smooth scroll interpolates between current and target position
 * - Scrollbar shows proportional position indicator
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewportState {
  readonly scrollY: number;
  readonly targetScrollY: number;
  readonly scrollX: number;
  readonly contentHeight: number;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  readonly isScrolling: boolean;
  readonly maxScrollY: number;
  readonly scrollRatio: number; // 0-1 position
}

export interface ScrollbarStyle {
  readonly type: 'thin' | 'full' | 'none';
  readonly position: 'right' | 'left';
  readonly char: string;
  readonly trackChar: string;
  readonly activeColor: string;
  readonly trackColor: string;
}

export interface ScrollRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface ScrollEvent {
  readonly type: 'scroll' | 'scroll-start' | 'scroll-end' | 'top' | 'bottom';
  readonly scrollY: number;
  readonly maxScroll: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCROLL_SPEED = 3; // Lines per wheel tick
const SMOOTH_FACTOR = 0.2; // Interpolation speed (0-1, higher = faster)
const OVERSCAN = 2; // Extra lines above/below viewport
const MOMENTUM_DECAY = 0.92; // Velocity decay per frame
const MIN_VELOCITY = 0.1; // Stop threshold

const DEFAULT_SCROLLBAR: ScrollbarStyle = {
  type: 'thin',
  position: 'right',
  char: '█',
  trackChar: '░',
  activeColor: 'textMuted',
  trackColor: 'textDim',
};

// ---------------------------------------------------------------------------
// ScrollViewport
// ---------------------------------------------------------------------------

export class ScrollViewport {
  private scrollY = 0;
  private targetScrollY = 0;
  private scrollX = 0;
  private velocity = 0;
  private contentHeight = 0;
  private viewportHeight = 0;
  private viewportWidth = 0;
  private scrollbarStyle: ScrollbarStyle = DEFAULT_SCROLLBAR;
  private onScroll: ((event: ScrollEvent) => void) | null = null;
  private savedPositions: Map<string, number> = new Map();

  // ─── Configuration ───────────────────────────────────────────────

  /** Set the viewport dimensions. */
  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clampScroll();
  }

  /** Set the total content height (number of lines). */
  setContentHeight(height: number): void {
    this.contentHeight = height;
    this.clampScroll();
  }

  /** Set the scrollbar style. */
  setScrollbarStyle(style: Partial<ScrollbarStyle>): void {
    this.scrollbarStyle = { ...this.scrollbarStyle, ...style };
  }

  /** Set scroll event callback. */
  setScrollHandler(handler: (event: ScrollEvent) => void): void {
    this.onScroll = handler;
  }

  // ─── Scrolling ───────────────────────────────────────────────────

  /** Scroll by a delta (positive = down, negative = up). */
  scrollBy(delta: number): void {
    this.targetScrollY += delta;
    this.clampTarget();
    this.emitEvent('scroll');
  }

  /** Scroll to an absolute position. */
  scrollTo(position: number): void {
    this.targetScrollY = position;
    this.clampTarget();
    this.emitEvent('scroll');
  }

  /** Smooth scroll to a position. */
  smoothScrollTo(position: number): void {
    this.targetScrollY = Math.max(0, Math.min(this.maxScroll, position));
  }

  /** Scroll by pages. */
  pageDown(): void {
    this.scrollBy(this.viewportHeight - 1);
  }

  pageUp(): void {
    this.scrollBy(-(this.viewportHeight - 1));
  }

  /** Scroll to top. */
  scrollToTop(): void {
    this.targetScrollY = 0;
    this.emitEvent('top');
  }

  /** Scroll to bottom. */
  scrollToBottom(): void {
    this.targetScrollY = this.maxScroll;
    this.emitEvent('bottom');
  }

  /** Jump to a specific line (centers it in viewport). */
  jumpToLine(line: number): void {
    this.targetScrollY = Math.max(0, line - Math.floor(this.viewportHeight / 2));
    this.clampTarget();
  }

  /** Handle mouse wheel input. */
  handleWheel(deltaY: number): void {
    this.velocity += deltaY * SCROLL_SPEED * 0.3;
    this.targetScrollY += deltaY * SCROLL_SPEED;
    this.clampTarget();
    this.emitEvent('scroll');
  }

  /** Apply momentum (call each frame for inertial scrolling). */
  applyMomentum(): void {
    if (Math.abs(this.velocity) > MIN_VELOCITY) {
      this.targetScrollY += this.velocity;
      this.velocity *= MOMENTUM_DECAY;
      this.clampTarget();
    } else {
      this.velocity = 0;
    }
  }

  // ─── Animation Tick ──────────────────────────────────────────────

  /** Advance smooth scroll animation. Call each frame. */
  tick(): boolean {
    this.applyMomentum();

    const diff = this.targetScrollY - this.scrollY;
    if (Math.abs(diff) < 0.01) {
      if (this.scrollY !== this.targetScrollY) {
        this.scrollY = this.targetScrollY;
        this.emitEvent('scroll-end');
      }
      return false;
    }

    this.scrollY += diff * SMOOTH_FACTOR;
    return true; // Still animating
  }

  // ─── Viewport Queries ────────────────────────────────────────────

  /** Get the range of visible lines [start, end). */
  getVisibleRange(): { start: number; end: number } {
    const start = Math.max(0, Math.floor(this.scrollY) - OVERSCAN);
    const end = Math.min(this.contentHeight, Math.ceil(this.scrollY + this.viewportHeight) + OVERSCAN);
    return { start, end };
  }

  /** Get the current viewport state. */
  getState(): ViewportState {
    return {
      scrollY: this.scrollY,
      targetScrollY: this.targetScrollY,
      scrollX: this.scrollX,
      contentHeight: this.contentHeight,
      viewportHeight: this.viewportHeight,
      viewportWidth: this.viewportWidth,
      isScrolling: Math.abs(this.targetScrollY - this.scrollY) > 0.01,
      maxScrollY: this.maxScroll,
      scrollRatio: this.maxScroll > 0 ? this.scrollY / this.maxScroll : 0,
    };
  }

  get maxScroll(): number {
    return Math.max(0, this.contentHeight - this.viewportHeight);
  }

  get isAtTop(): boolean {
    return this.scrollY <= 0;
  }

  get isAtBottom(): boolean {
    return this.scrollY >= this.maxScroll - 0.5;
  }

  get isScrolling(): boolean {
    return Math.abs(this.targetScrollY - this.scrollY) > 0.01;
  }

  // ─── Position Persistence ────────────────────────────────────────

  /** Save scroll position for a content ID. */
  savePosition(id: string): void {
    this.savedPositions.set(id, this.scrollY);
  }

  /** Restore scroll position for a content ID. */
  restorePosition(id: string): boolean {
    const saved = this.savedPositions.get(id);
    if (saved !== undefined) {
      this.scrollY = saved;
      this.targetScrollY = saved;
      return true;
    }
    return false;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render visible content lines with scrollbar. */
  render(content: readonly string[], options: ScrollRenderOptions): string[] {
    const { width, height, fg, dimFg } = options;
    const { start, end } = this.getVisibleRange();
    const lines: string[] = [];
    const showScrollbar = this.scrollbarStyle.type !== 'none' && this.contentHeight > height;
    const contentWidth = showScrollbar ? width - 1 : width;

    for (let i = 0; i < height; i++) {
      const contentIdx = Math.floor(this.scrollY) + i;
      let line: string;

      if (contentIdx >= 0 && contentIdx < content.length) {
        line = content[contentIdx] ?? '';
        // Horizontal scroll
        if (this.scrollX > 0) {
          line = line.slice(this.scrollX);
        }
        // Truncate to width
        if (line.length > contentWidth) {
          line = line.slice(0, contentWidth - 1) + '…';
        }
      } else {
        line = '';
      }

      // Pad to content width
      const padded = line + ' '.repeat(Math.max(0, contentWidth - stripAnsiLen(line)));

      // Add scrollbar
      if (showScrollbar) {
        const scrollbarChar = this.getScrollbarChar(i, height);
        lines.push(`${padded}${scrollbarChar}`);
      } else {
        lines.push(padded);
      }
    }

    return lines;
  }

  /** Render just the scrollbar (for overlay positioning). */
  renderScrollbar(height: number, options: ScrollRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];

    for (let i = 0; i < height; i++) {
      lines.push(this.getScrollbarChar(i, height));
    }

    return lines;
  }

  /** Render scroll position indicator (for status bars). */
  renderPositionIndicator(options: ScrollRenderOptions): string {
    const { fg, dimFg } = options;
    const state = this.getState();

    if (this.isAtTop && this.isAtBottom) {
      return dimFg('textMuted', 'All');
    }
    if (this.isAtTop) {
      return fg('primary', 'Top');
    }
    if (this.isAtBottom) {
      return fg('primary', 'Bot');
    }

    const percent = Math.round(state.scrollRatio * 100);
    return dimFg('textMuted', `${String(percent)}%`);
  }

  /** Render a minimap-style overview. */
  renderMinimap(content: readonly string[], minimapHeight: number, options: ScrollRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];
    const scale = this.contentHeight / minimapHeight;

    for (let i = 0; i < minimapHeight; i++) {
      const contentIdx = Math.floor(i * scale);
      const line = content[contentIdx] ?? '';
      // Compress line to 1-char density indicator
      const density = Math.min(4, Math.ceil(stripAnsiLen(line.trim()) / 20));
      const chars = [' ', '░', '▒', '▓', '█'];
      const char = chars[density] ?? ' ';

      // Highlight viewport region
      const viewStart = this.scrollY / scale;
      const viewEnd = (this.scrollY + this.viewportHeight) / scale;
      const inViewport = i >= viewStart && i < viewEnd;

      if (inViewport) {
        lines.push(fg('accent', char));
      } else {
        lines.push(dimFg('textDim', char));
      }
    }

    return lines;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private getScrollbarChar(row: number, height: number): string {
    const { fg, dimFg } = { fg: (t: string, s: string) => s, dimFg: (t: string, s: string) => s, ...this._renderOpts };
    const style = this.scrollbarStyle;

    if (this.maxScroll === 0) return dimFg(style.trackColor, style.trackChar);

    // Calculate thumb position and size
    const thumbRatio = this.viewportHeight / this.contentHeight;
    const thumbHeight = Math.max(1, Math.round(thumbRatio * height));
    const thumbStart = Math.round((this.scrollY / this.maxScroll) * (height - thumbHeight));
    const thumbEnd = thumbStart + thumbHeight;

    if (row >= thumbStart && row < thumbEnd) {
      return fg(style.activeColor, style.char);
    }
    return dimFg(style.trackColor, style.trackChar);
  }

  private _renderOpts: { fg: (t: string, s: string) => string; dimFg: (t: string, s: string) => string } = {
    fg: (_t, s) => s,
    dimFg: (_t, s) => s,
  };

  /** Set render options for scrollbar coloring. */
  setRenderOpts(opts: { fg: (t: string, s: string) => string; dimFg: (t: string, s: string) => string }): void {
    this._renderOpts = opts;
  }

  private clampScroll(): void {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY));
    this.targetScrollY = Math.max(0, Math.min(this.maxScroll, this.targetScrollY));
  }

  private clampTarget(): void {
    this.targetScrollY = Math.max(0, Math.min(this.maxScroll, this.targetScrollY));
  }

  private emitEvent(type: ScrollEvent['type']): void {
    if (this.onScroll) {
      this.onScroll({ type, scrollY: this.scrollY, maxScroll: this.maxScroll });
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}
