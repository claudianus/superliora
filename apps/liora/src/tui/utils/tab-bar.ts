/**
 * TabBar — multi-tab management with close buttons and overflow.
 *
 * Provides browser/editor-quality tab management:
 * - Tab rendering with icons, titles, and close buttons
 * - Active tab highlighting with underline/accent
 * - Overflow handling: scroll arrows or dropdown for many tabs
 * - Tab reordering (drag state management)
 * - Tab pinning (pinned tabs are compact, no close button)
 * - Modified indicator (dot or icon for unsaved changes)
 * - Tab context (session ID, agent status)
 * - Keyboard navigation (Ctrl+Tab, Ctrl+1-9)
 * - Tab grouping with separators
 * - Maximum tab width with ellipsis truncation
 * - New tab button (+)
 * - Tab count badge
 *
 * Visual style:
 * - Active: bold + accent underline
 * - Inactive: dim text
 * - Modified: ● dot before title
 * - Pinned: icon only (compact)
 * - Overflow: ◂ ▸ scroll arrows or … dropdown
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tab {
  readonly id: string;
  title: string;
  readonly icon?: string;
  readonly pinned?: boolean;
  modified?: boolean;
  readonly closable?: boolean;
  readonly sessionId?: string;
  readonly status?: 'active' | 'idle' | 'error' | 'working';
  readonly group?: string;
}

export interface TabBarState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string | null;
  readonly scrollOffset: number;
  readonly overflowStart: number;
  readonly overflowEnd: number;
}

export interface TabBarRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TAB_WIDTH = 24;
const MIN_TAB_WIDTH = 8;
const PINNED_TAB_WIDTH = 5;
const TAB_PADDING = 2; // Space on each side of title
const CLOSE_BUTTON = '✕';
const NEW_TAB_BUTTON = '+';
const STATUS_ICONS: Record<string, string> = {
  active: '●',
  idle: '○',
  error: '✗',
  working: '◌',
};

// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------

export class TabBar {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private scrollOffset = 0;
  private dragTabId: string | null = null;
  private dragTargetIndex: number | null = null;

  // ─── Tab Management ──────────────────────────────────────────────

  /** Add a new tab. Returns the tab ID. */
  addTab(tab: Omit<Tab, 'id'> & { id?: string }): string {
    const id = tab.id ?? `tab-${String(this.tabs.length + 1)}-${String(Date.now())}`;
    this.tabs.push({ ...tab, id });
    if (!this.activeTabId) this.activeTabId = id;
    return id;
  }

  /** Remove a tab by ID. */
  removeTab(id: string): boolean {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return false;

    const tab = this.tabs[idx]!;
    if (tab.pinned) return false; // Can't close pinned tabs directly

    this.tabs.splice(idx, 1);

    // Update active tab
    if (this.activeTabId === id) {
      const newIdx = Math.min(idx, this.tabs.length - 1);
      this.activeTabId = this.tabs[newIdx]?.id ?? null;
    }

    return true;
  }

  /** Close all tabs except the active one. */
  closeOthers(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id === id || t.pinned);
    this.activeTabId = id;
  }

  /** Close all tabs to the right. */
  closeToRight(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tabs = this.tabs.filter((t, i) => i <= idx || t.pinned);
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = id;
    }
  }

  /** Set the active tab. */
  setActive(id: string): void {
    if (this.tabs.some((t) => t.id === id)) {
      this.activeTabId = id;
    }
  }

  /** Toggle pin state. */
  togglePin(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) {
      (tab as { pinned: boolean | undefined }).pinned = !tab.pinned;
      // Move pinned tabs to the front
      this.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    }
  }

  /** Mark a tab as modified. */
  setModified(id: string, modified: boolean): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) tab.modified = modified;
  }

  /** Update a tab's title. */
  setTitle(id: string, title: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) tab.title = title;
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Activate the next tab. */
  nextTab(): void {
    if (this.tabs.length === 0) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIdx = (idx + 1) % this.tabs.length;
    this.activeTabId = this.tabs[nextIdx]!.id;
  }

  /** Activate the previous tab. */
  prevTab(): void {
    if (this.tabs.length === 0) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const prevIdx = (idx - 1 + this.tabs.length) % this.tabs.length;
    this.activeTabId = this.tabs[prevIdx]!.id;
  }

  /** Activate tab by index (1-based, for Ctrl+1-9). */
  activateByIndex(index: number): void {
    if (index >= 1 && index <= this.tabs.length) {
      this.activeTabId = this.tabs[index - 1]!.id;
    }
  }

  /** Move active tab left. */
  moveTabLeft(): void {
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx > 0) {
      [this.tabs[idx - 1], this.tabs[idx]] = [this.tabs[idx]!, this.tabs[idx - 1]!];
    }
  }

  /** Move active tab right. */
  moveTabRight(): void {
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx < this.tabs.length - 1) {
      [this.tabs[idx], this.tabs[idx + 1]] = [this.tabs[idx + 1]!, this.tabs[idx]!];
    }
  }

  // ─── Drag Reorder ────────────────────────────────────────────────

  /** Start dragging a tab. */
  startDrag(id: string): void {
    this.dragTabId = id;
  }

  /** Update drag target position. */
  dragTo(targetIndex: number): void {
    this.dragTargetIndex = targetIndex;
  }

  /** Complete the drag operation. */
  endDrag(): void {
    if (this.dragTabId && this.dragTargetIndex !== null) {
      const fromIdx = this.tabs.findIndex((t) => t.id === this.dragTabId);
      if (fromIdx >= 0 && this.dragTargetIndex >= 0 && this.dragTargetIndex < this.tabs.length) {
        const [tab] = this.tabs.splice(fromIdx, 1);
        this.tabs.splice(this.dragTargetIndex, 0, tab!);
      }
    }
    this.dragTabId = null;
    this.dragTargetIndex = null;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  get activeId(): string | null {
    return this.activeTabId;
  }

  get tabCount(): number {
    return this.tabs.length;
  }

  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  getTabs(): readonly Tab[] {
    return this.tabs;
  }

  getState(): TabBarState {
    return {
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      scrollOffset: this.scrollOffset,
      overflowStart: 0,
      overflowEnd: this.tabs.length,
    };
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the tab bar. */
  render(options: TabBarRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    if (this.tabs.length === 0) {
      lines.push(dimFg('textMuted', ` ${NEW_TAB_BUTTON} No tabs`));
      lines.push(dimFg('textDim', '─'.repeat(width)));
      return lines;
    }

    // Calculate available width for tabs
    const newTabWidth = 4; // " + " button
    const availableWidth = width - newTabWidth - 2;

    // Render tabs
    let tabLine = ' ';
    let usedWidth = 1;
    let overflow = false;

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!;
      const isActive = tab.id === this.activeTabId;
      const tabStr = this.renderTab(tab, isActive, options);
      const tabLen = stripAnsiLen(tabStr);

      if (usedWidth + tabLen + 1 > availableWidth) {
        // Overflow: show count
        const remaining = this.tabs.length - i;
        tabLine += dimFg('textMuted', ` …${String(remaining)}`);
        overflow = true;
        break;
      }

      tabLine += tabStr + ' ';
      usedWidth += tabLen + 1;
    }

    // New tab button
    tabLine += fg('textMuted', ` ${NEW_TAB_BUTTON} `);

    lines.push(tabLine);

    // Underline bar with active indicator
    let underline = '';
    let activeStart = 0;
    let activeWidth = 0;

    // Recalculate active tab position for underline
    let pos = 1;
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!;
      const tabStr = this.renderTab(tab, tab.id === this.activeTabId, options);
      const tabLen = stripAnsiLen(tabStr) + 1;

      if (tab.id === this.activeTabId) {
        activeStart = pos;
        activeWidth = tabLen - 1;
      }
      pos += tabLen;
      if (pos > availableWidth) break;
    }

    for (let i = 0; i < width; i++) {
      if (i >= activeStart && i < activeStart + activeWidth) {
        underline += fg('accent', '━');
      } else {
        underline += dimFg('textDim', '─');
      }
    }
    lines.push(underline);

    return lines;
  }

  private renderTab(tab: Tab, isActive: boolean, options: TabBarRenderOptions): string {
    const { fg, boldFg, dimFg } = options;

    // Pinned tabs: icon only
    if (tab.pinned) {
      const icon = tab.icon ?? '📌';
      const mod = tab.modified ? fg('warning', '●') : '';
      return isActive ? boldFg('accent', `${icon}${mod}`) : dimFg('textMuted', `${icon}${mod}`);
    }

    // Status icon
    const statusIcon = tab.status ? STATUS_ICONS[tab.status] ?? '' : '';
    const statusColor = tab.status === 'error' ? 'error' : tab.status === 'working' ? 'success' : 'textMuted';

    // Modified indicator
    const modDot = tab.modified ? fg('warning', '● ') : '';

    // Title (truncated)
    const maxTitleLen = MAX_TAB_WIDTH - TAB_PADDING * 2 - (statusIcon ? 2 : 0) - (tab.modified ? 2 : 0);
    const title = truncate(tab.title, maxTitleLen);

    // Close button
    const closable = tab.closable !== false;
    const closeBtn = closable ? (isActive ? fg('textMuted', ` ${CLOSE_BUTTON}`) : '') : '';

    // Icon
    const icon = tab.icon ? `${tab.icon} ` : '';

    // Compose
    const status = statusIcon ? fg(statusColor, `${statusIcon} `) : '';
    const label = isActive
      ? boldFg('text', `${icon}${modDot}${status}${title}${closeBtn}`)
      : dimFg('textMuted', `${icon}${modDot}${status}${title}`);

    return label;
  }

  /** Render a compact tab count indicator. */
  renderBadge(options: TabBarRenderOptions): string {
    const { fg, dimFg } = options;
    const modifiedCount = this.tabs.filter((t) => t.modified).length;
    let badge = fg('text', `${String(this.tabs.length)} tabs`);
    if (modifiedCount > 0) {
      badge += fg('warning', ` ●${String(modifiedCount)}`);
    }
    return badge;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}
