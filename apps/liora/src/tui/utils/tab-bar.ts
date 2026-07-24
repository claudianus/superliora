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
 * - Active: brand-wave title framed by ╭╮ notches + head→tail gradient underline
 *   (static bold label + solid accent underline when effects are off)
 * - Inactive: dim text
 * - Modified: ● dot before title
 * - Pinned: icon only (compact)
 * - Overflow: ◂ ▸ scroll arrows or … dropdown
 */

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import {
  mixHexColor,
  renderRendererStyledTextRunsAnsi,
  truncateToWidth,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  enterBeatDurationMs,
  renderEnterBeat,
  renderExitBeat,
  renderSpectacularText,
  resolveAmbientEffectMode,
  type AmbientEffectMode,
} from '#/tui/utils/appearance-effects';

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
  /** Appearance preferences gating brand-wave / gradient / slide effects ('off' → static legacy render). */
  readonly appearance?: AppearancePreferences;
  /** Deterministic animation clock override; defaults to the shared appearance clock. */
  readonly nowMs?: number;
}

/** In-flight underline slide between two active-tab segments (B2). */
interface UnderlineSlide {
  readonly fromStart: number;
  readonly fromWidth: number;
  readonly fromTabId: string;
  readonly toTabId: string;
  readonly startedAtMs: number;
}

interface ResolvedUnderlineSlide extends UnderlineSlide {
  readonly progress: number;
  readonly currentStart: number;
  readonly currentWidth: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TAB_WIDTH = 24;
const MIN_TAB_WIDTH = 8;
const PINNED_TAB_WIDTH = 5;
const TAB_PADDING = 2; // Space on each side of title
/** Monospace-safe close glyph — dingbats like ✕ break under Nerd Font + kitty symbol_map. */
export const CLOSE_BUTTON = 'x';
export const NEW_TAB_BUTTON = '+';
export const STATUS_ICONS: Record<string, string> = {
  active: '●',
  idle: '○',
  error: '×', // U+00D7: monospace-safe stand-in for dingbat ✗
  working: '◌',
};
/** Browser-style rounded notches framing the active tab (box-drawing, monospace-safe). */
export const NOTCH_LEFT = '╭';
export const NOTCH_RIGHT = '╮';
/** How far the gradient underline tail fades toward textDim (0 = accent, 1 = textDim). */
const UNDERLINE_TAIL_FADE = 0.72;

// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------

export class TabBar {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private scrollOffset = 0;
  private dragTabId: string | null = null;
  private dragTargetIndex: number | null = null;

  // Underline slide tracking (B2): geometry of the previously rendered active segment.
  private lastActiveTabId: string | null = null;
  private lastActiveGeometry: { start: number; width: number } | null = null;
  private underlineSlide: UnderlineSlide | null = null;

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
    const { width, fg, dimFg } = options;
    const appearance = options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const nowMs = options.nowMs ?? appearanceAnimationNow();
    // 'off' (reduced motion / low-color env / minimal profile) → fully static legacy render.
    const effectMode = resolveAmbientEffectMode(appearance);
    const lines: string[] = [];

    if (this.tabs.length === 0) {
      this.updateUnderlineSlide(null, -1, 0, effectMode, nowMs);
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
      const tabStr = this.renderTab(tab, isActive, options, effectMode);
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
    let activeStart = 0;
    let activeWidth = 0;

    // Recalculate active tab position for underline
    let pos = 1;
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!;
      const tabStr = this.renderTab(tab, tab.id === this.activeTabId, options, effectMode);
      const tabLen = stripAnsiLen(tabStr) + 1;

      if (tab.id === this.activeTabId) {
        activeStart = pos;
        activeWidth = tabLen - 1;
      }
      pos += tabLen;
      if (pos > availableWidth) break;
    }

    this.updateUnderlineSlide(this.activeId, activeStart, activeWidth, effectMode, nowMs);

    lines.push(
      effectMode === 'off'
        ? this.renderStaticUnderline(width, activeStart, activeWidth, options)
        : this.renderEffectUnderline(width, activeStart, activeWidth, appearance, nowMs),
    );

    return lines;
  }

  /**
   * Track the active-tab segment geometry so the gradient underline can slide
   * between tabs (B2). When the active tab changes while effects are enabled,
   * record an in-flight slide from the previous segment to the new one; the
   * render path interpolates it until it settles. With effects 'off' (or no
   * prior geometry) the slide is skipped and only the geometry is refreshed.
   */
  private updateUnderlineSlide(
    activeTabId: string | null,
    activeStart: number,
    activeWidth: number,
    effectMode: AmbientEffectMode,
    nowMs: number,
  ): void {
    const geometry =
      activeTabId !== null && activeWidth > 0 ? { start: activeStart, width: activeWidth } : null;
    const tabChanged = activeTabId !== this.lastActiveTabId;

    if (tabChanged) {
      if (
        effectMode !== 'off' &&
        geometry &&
        this.lastActiveGeometry &&
        activeTabId !== null &&
        this.lastActiveTabId !== null
      ) {
        this.underlineSlide = {
          fromStart: this.lastActiveGeometry.start,
          fromWidth: this.lastActiveGeometry.width,
          fromTabId: this.lastActiveTabId,
          toTabId: activeTabId,
          startedAtMs: nowMs,
        };
      } else {
        this.underlineSlide = null;
      }
    }

    this.lastActiveTabId = activeTabId;
    this.lastActiveGeometry = geometry;
  }

  /** Resolve the in-flight underline slide into concrete segment geometry. */
  private resolveUnderlineSlide(
    activeStart: number,
    activeWidth: number,
    appearance: AppearancePreferences,
    nowMs: number,
  ): ResolvedUnderlineSlide | null {
    const slide = this.underlineSlide;
    if (!slide) return null;
    const duration = Math.max(1, enterBeatDurationMs(appearance));
    const raw = (nowMs - slide.startedAtMs) / duration;
    const progress = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
    // Smoothstep easing so the segment settles instead of snapping.
    const eased = progress * progress * (3 - 2 * progress);
    const currentStart = Math.round(slide.fromStart + (activeStart - slide.fromStart) * eased);
    const currentWidth = Math.max(
      1,
      Math.round(slide.fromWidth + (activeWidth - slide.fromWidth) * eased),
    );
    return { ...slide, progress, currentStart, currentWidth };
  }

  /** Static underline for reduced-motion / low-color / 'off' mode (legacy look). */
  private renderStaticUnderline(
    width: number,
    activeStart: number,
    activeWidth: number,
    options: TabBarRenderOptions,
  ): string {
    const { fg, dimFg } = options;
    let underline = '';
    for (let i = 0; i < width; i++) {
      if (i >= activeStart && i < activeStart + activeWidth) {
        underline += fg('accent', '━');
      } else {
        underline += dimFg('textDim', '─');
      }
    }
    return underline;
  }

  /** Head→tail brand gradient underline with slide-between-tabs animation (B1/B2). */
  private renderEffectUnderline(
    width: number,
    activeStart: number,
    activeWidth: number,
    appearance: AppearancePreferences,
    nowMs: number,
  ): string {
    const palette = currentTheme.palette;
    const headHex = palette.accent;
    const tailHex = mixHexColor(palette.accent, palette.textDim, UNDERLINE_TAIL_FADE);
    const dimHex = palette.textDim;

    const resolved = this.resolveUnderlineSlide(activeStart, activeWidth, appearance, nowMs);
    const rawStart = resolved ? resolved.currentStart : activeStart;
    const rawWidth = resolved ? resolved.currentWidth : activeWidth;
    const segStart = Math.min(Math.max(0, rawStart), width);
    const segEnd = Math.min(width, segStart + Math.max(0, rawWidth));

    const runs: RendererStyledTextRun[] = [];
    if (segStart > 0) {
      runs.push({ text: '─'.repeat(segStart), style: { fg: dimHex, dim: true } });
    }
    const span = segEnd - segStart;
    for (let i = segStart; i < segEnd; i++) {
      const t = span <= 1 ? 0 : (i - segStart) / (span - 1);
      runs.push({ text: '━', style: { fg: mixHexColor(headHex, tailHex, t) } });
    }
    if (segEnd < width) {
      runs.push({ text: '─'.repeat(width - segEnd), style: { fg: dimHex, dim: true } });
    }
    return renderRendererStyledTextRunsAnsi(runs);
  }

  private renderTab(
    tab: Tab,
    isActive: boolean,
    options: TabBarRenderOptions,
    effectMode: AmbientEffectMode,
  ): string {
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

    // Title (truncated). The active tab reserves cells for the ╭╮ notches (B3).
    const notchCells = isActive ? NOTCH_LEFT.length + NOTCH_RIGHT.length : 0;
    const maxTitleLen =
      MAX_TAB_WIDTH - TAB_PADDING * 2 - (statusIcon ? 2 : 0) - (tab.modified ? 2 : 0) - notchCells;
    const rawTitle = truncate(tab.title, maxTitleLen);

    // Close button
    const closable = tab.closable !== false;
    const closeBtn = closable ? (isActive ? fg('textMuted', ` ${CLOSE_BUTTON}`) : '') : '';

    // Icon
    const icon = tab.icon ? `${tab.icon} ` : '';

    // Compose
    const status = statusIcon ? fg(statusColor, `${statusIcon} `) : '';
    if (!isActive) {
      return dimFg('textMuted', `${icon}${modDot}${status}${rawTitle}`);
    }
    // B1: brand wave on the active title; 'off' keeps the legacy bold label.
    const title =
      effectMode === 'off'
        ? boldFg('text', rawTitle)
        : renderSpectacularText(rawTitle, `tab:${tab.id}`, options.appearance, { intense: false });
    // B3: browser-style rounded notches frame the active tab (width-neutral vs. padding).
    return `${NOTCH_LEFT}${boldFg('text', `${icon}${modDot}${status}`)}${title}${boldFg('text', closeBtn)}${NOTCH_RIGHT}`;
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
