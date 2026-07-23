/**
 * TerminalMultiplexer — pane and window state management.
 *
 * Provides tmux-style terminal multiplexing state:
 * - Multiple windows (like tmux windows/tabs)
 * - Split panes within windows (horizontal/vertical)
 * - Active pane tracking
 * - Pane resizing
 * - Pane navigation (vim-style: h/j/k/l)
 * - Zoom mode (maximize single pane)
 * - Pane titles and status
 * - Session persistence structure
 * - Layout presets (even, main-horizontal, main-vertical, tiled)
 * - Synchronize panes mode
 * - Pane borders with status
 *
 * Visual style:
 * ┌─ window 0: editor ──────────────────────────────┐
 * │ ┌─ main.ts ─────────┐│┌─ terminal ────────────┐ │
 * │ │                    │││ $ npm run dev        │ │
 * │ │  code content      │││                      │ │
 * │ │                    │││ > ready              │ │
 * │ └────────────────────┘│└──────────────────────┘ │
 * │ ┌─ output ───────────────────────────────────┐  │
 * │ │ Build complete                              │  │
 * │ └─────────────────────────────────────────────┘  │
 * └──────────────────────────────────────────────────┘
 * [0:editor*] [1:logs] [2:git]
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pane {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly zoomed: boolean;
  readonly content?: string;
  readonly status?: 'running' | 'stopped' | 'error';
}

export interface Window {
  readonly id: string;
  readonly name: string;
  readonly panes: Pane[];
  readonly activePaneId: string | null;
  readonly layout: LayoutType;
}

export interface Session {
  readonly id: string;
  readonly name: string;
  readonly windows: Window[];
  readonly activeWindowId: string | null;
  readonly createdAt: number;
}

export type LayoutType = 'even-horizontal' | 'even-vertical' | 'main-horizontal' | 'main-vertical' | 'tiled';

export type SplitDirection = 'horizontal' | 'vertical';

export interface MultiplexerRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showStatusBar?: boolean;
  readonly showPaneBorders?: boolean;
  readonly showPaneTitles?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// TerminalMultiplexer
// ---------------------------------------------------------------------------

export class TerminalMultiplexer {
  private session: Session;
  private counter = 0;

  constructor(sessionName = 'main') {
    this.session = {
      id: `session-${String(++this.counter)}`,
      name: sessionName,
      windows: [],
      activeWindowId: null,
      createdAt: Date.now(),
    };
  }

  // ─── Window Management ───────────────────────────────────────────

  /** Create a new window. */
  createWindow(name: string): string {
    const id = `win-${String(++this.counter)}`;
    const window: Window = {
      id,
      name,
      panes: [],
      activePaneId: null,
      layout: 'even-horizontal',
    };

    // Create initial pane
    const paneId = this.createPaneInWindow(window, 'shell');
    window.activePaneId = paneId;

    this.session.windows.push(window);
    if (!this.session.activeWindowId) {
      this.session.activeWindowId = id;
    }

    return id;
  }

  /** Close a window. */
  closeWindow(id: string): void {
    this.session.windows = this.session.windows.filter((w) => w.id !== id);
    if (this.session.activeWindowId === id) {
      this.session.activeWindowId = this.session.windows[0]?.id ?? null;
    }
  }

  /** Switch to a window. */
  switchWindow(id: string): void {
    if (this.session.windows.some((w) => w.id === id)) {
      this.session.activeWindowId = id;
    }
  }

  /** Get active window. */
  getActiveWindow(): Window | null {
    return this.session.windows.find((w) => w.id === this.session.activeWindowId) ?? null;
  }

  /** Get all windows. */
  getWindows(): readonly Window[] {
    return this.session.windows;
  }

  // ─── Pane Management ─────────────────────────────────────────────

  private createPaneInWindow(window: Window, title: string): string {
    const id = `pane-${String(++this.counter)}`;
    const pane: Pane = {
      id,
      title,
      x: 0,
      y: 0,
      width: 80,
      height: 24,
      active: false,
      zoomed: false,
    };
    window.panes.push(pane);
    return id;
  }

  /** Split the active pane. */
  splitPane(direction: SplitDirection, title?: string): string | null {
    const window = this.getActiveWindow();
    if (!window || !window.activePaneId) return null;

    const activePane = window.panes.find((p) => p.id === window.activePaneId);
    if (!activePane) return null;

    const newId = this.createPaneInWindow(window, title ?? 'shell');

    // Recalculate layout
    this.applyLayout(window);

    return newId;
  }

  /** Close a pane. */
  closePane(paneId: string): void {
    const window = this.getActiveWindow();
    if (!window) return;

    window.panes = window.panes.filter((p) => p.id !== paneId);

    if (window.activePaneId === paneId) {
      window.activePaneId = window.panes[0]?.id ?? null;
    }

    this.applyLayout(window);
  }

  /** Switch to a pane. */
  switchPane(paneId: string): void {
    const window = this.getActiveWindow();
    if (window && window.panes.some((p) => p.id === paneId)) {
      window.activePaneId = paneId;
    }
  }

  /** Navigate to pane in direction (vim-style). */
  navigatePane(direction: 'h' | 'j' | 'k' | 'l'): void {
    const window = this.getActiveWindow();
    if (!window || !window.activePaneId) return;

    const active = window.panes.find((p) => p.id === window.activePaneId);
    if (!active) return;

    // Find pane in direction
    let target: Pane | null = null;
    let bestScore = Infinity;

    for (const pane of window.panes) {
      if (pane.id === active.id) continue;

      const dx = pane.x - active.x;
      const dy = pane.y - active.y;

      let valid = false;
      let score = 0;

      switch (direction) {
        case 'h': // left
          valid = dx < 0;
          score = -dx + Math.abs(dy) * 2;
          break;
        case 'l': // right
          valid = dx > 0;
          score = dx + Math.abs(dy) * 2;
          break;
        case 'k': // up
          valid = dy < 0;
          score = -dy + Math.abs(dx) * 2;
          break;
        case 'j': // down
          valid = dy > 0;
          score = dy + Math.abs(dx) * 2;
          break;
      }

      if (valid && score < bestScore) {
        bestScore = score;
        target = pane;
      }
    }

    if (target) {
      window.activePaneId = target.id;
    }
  }

  /** Toggle zoom mode for active pane. */
  toggleZoom(): void {
    const window = this.getActiveWindow();
    if (!window || !window.activePaneId) return;

    const active = window.panes.find((p) => p.id === window.activePaneId);
    if (!active) return;

    // Toggle zoom on all panes
    const newZoomed = !active.zoomed;
    window.panes = window.panes.map((p) => ({
      ...p,
      zoomed: p.id === active.id ? newZoomed : false,
    }));

    this.applyLayout(window);
  }

  /** Set window layout. */
  setLayout(layout: LayoutType): void {
    const window = this.getActiveWindow();
    if (window) {
      window.layout = layout;
      this.applyLayout(window);
    }
  }

  private applyLayout(window: Window): void {
    const panes = window.panes;
    if (panes.length === 0) return;

    const totalWidth = 80;
    const totalHeight = 24;

    // Check for zoomed pane
    const zoomedPane = panes.find((p) => p.zoomed);
    if (zoomedPane) {
      window.panes = panes.map((p) =>
        p.id === zoomedPane.id
          ? { ...p, x: 0, y: 0, width: totalWidth, height: totalHeight }
          : { ...p, x: 0, y: 0, width: 0, height: 0 },
      );
      return;
    }

    switch (window.layout) {
      case 'even-horizontal': {
        const paneWidth = Math.floor(totalWidth / panes.length);
        window.panes = panes.map((p, i) => ({
          ...p,
          x: i * paneWidth,
          y: 0,
          width: i === panes.length - 1 ? totalWidth - i * paneWidth : paneWidth,
          height: totalHeight,
        }));
        break;
      }

      case 'even-vertical': {
        const paneHeight = Math.floor(totalHeight / panes.length);
        window.panes = panes.map((p, i) => ({
          ...p,
          x: 0,
          y: i * paneHeight,
          width: totalWidth,
          height: i === panes.length - 1 ? totalHeight - i * paneHeight : paneHeight,
        }));
        break;
      }

      case 'main-horizontal': {
        const mainHeight = Math.floor(totalHeight * 0.7);
        const restHeight = totalHeight - mainHeight;
        const restWidth = Math.floor(totalWidth / Math.max(1, panes.length - 1));

        window.panes = panes.map((p, i) => {
          if (i === 0) {
            return { ...p, x: 0, y: 0, width: totalWidth, height: mainHeight };
          }
          return {
            ...p,
            x: (i - 1) * restWidth,
            y: mainHeight,
            width: i === panes.length - 1 ? totalWidth - (i - 1) * restWidth : restWidth,
            height: restHeight,
          };
        });
        break;
      }

      case 'main-vertical': {
        const mainWidth = Math.floor(totalWidth * 0.7);
        const restWidth = totalWidth - mainWidth;
        const restHeight = Math.floor(totalHeight / Math.max(1, panes.length - 1));

        window.panes = panes.map((p, i) => {
          if (i === 0) {
            return { ...p, x: 0, y: 0, width: mainWidth, height: totalHeight };
          }
          return {
            ...p,
            x: mainWidth,
            y: (i - 1) * restHeight,
            width: restWidth,
            height: i === panes.length - 1 ? totalHeight - (i - 1) * restHeight : restHeight,
          };
        });
        break;
      }

      case 'tiled': {
        const cols = Math.ceil(Math.sqrt(panes.length));
        const rows = Math.ceil(panes.length / cols);
        const paneWidth = Math.floor(totalWidth / cols);
        const paneHeight = Math.floor(totalHeight / rows);

        window.panes = panes.map((p, i) => ({
          ...p,
          x: (i % cols) * paneWidth,
          y: Math.floor(i / cols) * paneHeight,
          width: paneWidth,
          height: paneHeight,
        }));
        break;
      }
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get session info. */
  getSession(): Session {
    return this.session;
  }

  /** Get active pane. */
  getActivePane(): Pane | null {
    const window = this.getActiveWindow();
    if (!window || !window.activePaneId) return null;
    return window.panes.find((p) => p.id === window.activePaneId) ?? null;
  }

  /** Get window count. */
  get windowCount(): number {
    return this.session.windows.length;
  }

  /** Get pane count in active window. */
  get paneCount(): number {
    return this.getActiveWindow()?.panes.length ?? 0;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the multiplexer state. */
  render(options: MultiplexerRenderOptions): string[] {
    const { width, height, showStatusBar = true, showPaneBorders = true, showPaneTitles = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const window = this.getActiveWindow();
    if (!window) {
      return [dimFg('textMuted', '  (no windows)')];
    }

    // Window frame
    const windowTitle = ` ${window.name} `;
    lines.push(fg('textMuted', `┌─${boldFg('text', windowTitle)}${'─'.repeat(Math.max(0, width - windowTitle.length - 3))}┐`));

    // Render panes
    const bodyHeight = height - (showStatusBar ? 3 : 2);
    const visiblePanes = window.panes.filter((p) => p.width > 0 && p.height > 0);

    if (visiblePanes.length === 0) {
      lines.push(`│${' '.repeat(width - 2)}│`);
    } else {
      // Simple horizontal layout for rendering
      const paneWidth = Math.floor((width - 2) / visiblePanes.length);

      for (let row = 0; row < bodyHeight; row++) {
        let line = '│';

        for (let pi = 0; pi < visiblePanes.length; pi++) {
          const pane = visiblePanes[pi]!;
          const isActive = pane.id === window.activePaneId;
          const isLast = pi === visiblePanes.length - 1;
          const actualWidth = isLast ? width - 2 - pi * paneWidth : paneWidth;

          // Pane content
          let content: string;
          if (row === 0 && showPaneTitles) {
            const title = this.truncate(pane.title, actualWidth - 4);
            content = isActive
              ? boldFg('primary', ` ${title} `)
              : dimFg('textMuted', ` ${title} `);
          } else if (row === 1) {
            const status = pane.status ?? 'running';
            const statusIcon = status === 'running' ? '◉' : status === 'error' ? '✗' : '○';
            const statusColor = status === 'running' ? 'success' : status === 'error' ? 'error' : 'textMuted';
            content = ` ${fg(statusColor, statusIcon)} ${dimFg('textDim', pane.id)}`;
          } else {
            content = ' '.repeat(actualWidth - 1);
          }

          // Pad content
          const plainLen = content.replace(/\x1b\[[0-9;]*m/g, '').length;
          content += ' '.repeat(Math.max(0, actualWidth - 1 - plainLen));

          // Border
          if (showPaneBorders && pi > 0) {
            line += fg('textMuted', '│');
          }

          line += content;
        }

        line += '│';
        lines.push(line);
      }
    }

    // Bottom border
    lines.push(fg('textMuted', `└${'─'.repeat(width - 2)}┘`));

    // Status bar (window list)
    if (showStatusBar) {
      const windowTabs = this.session.windows.map((w, i) => {
        const isActive = w.id === this.session.activeWindowId;
        const paneCount = w.panes.length;
        const label = `${String(i)}:${w.name}`;

        if (isActive) {
          return boldFg('primary', `[${label}*]`);
        }
        return dimFg('textMuted', `[${label}]`);
      });

      lines.push(windowTabs.join(' '));
    }

    return lines;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }
}
