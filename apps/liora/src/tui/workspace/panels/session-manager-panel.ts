import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';
import {
  renderPulseText,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInfo {
  readonly id: string;
  readonly title: string | null;
  readonly lastPrompt: string | null;
  readonly workDir: string;
  readonly updatedAt: number;
}

export interface SessionManagerCallbacks {
  /** Fetch the list of sessions. */
  listSessions(): Promise<SessionInfo[]>;
  /** Switch to a session by id. Returns true on success. */
  switchSession(id: string): Promise<boolean>;
  /** Create a new session. Returns true on success. */
  createSession?(): Promise<boolean>;
  /** Get the current session id. */
  currentSessionId(): string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (diffSec < 60) return 'now';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d`;
}

/** Theme-aware relative time with recency-based coloring. */
function styledRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  const label = formatRelativeTime(ts);
  if (diffSec < 60) return currentTheme.fg('success', label);
  if (diffSec < 300) return currentTheme.fg('accent', label);
  if (diffSec < 3600) return currentTheme.fg('primary', label);
  return currentTheme.dimFg('textMuted', label);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

// ---------------------------------------------------------------------------
// SessionManagerPanel
// ---------------------------------------------------------------------------

export class SessionManagerPanel implements PanelDefinition {
  readonly id = 'session-manager';
  readonly title = 'Sessions';
  readonly icon = '◈';
  readonly minWidth = 28;
  readonly minHeight = 6;

  private readonly callbacks: SessionManagerCallbacks;
  private sessions: SessionInfo[] = [];
  private cursorIndex = 0;
  private scrollTop = 0;
  private loading = false;
  private lastRefresh = 0;
  private statusMessage: string | null = null;
  private sortMode: 'time' | 'name' = 'time';

  constructor(callbacks: SessionManagerCallbacks) {
    this.callbacks = callbacks;
    void this.refresh();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    // Auto-refresh every 10 seconds
    const now = Date.now();
    if (now - this.lastRefresh > 10_000 && !this.loading) {
      void this.refresh();
    }

    const lines: string[] = [];
    const currentId = this.callbacks.currentSessionId();
    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);

    // Filter sessions by search query
    const filtered = searchQuery && searchQuery.length > 0
      ? this.sessions.filter((s) => {
          const title = (s.title ?? s.lastPrompt ?? s.id).toLowerCase();
          return title.includes(searchQuery.toLowerCase());
        })
      : this.sessions;

    // Header line
    const countLabel = this.loading ? '…' : String(this.sessions.length);
    const searchInfo = searchQuery && searchQuery.length > 0
      ? currentTheme.dimFg('textMuted', ` (${String(filtered.length)} match)`)
      : '';
    const header = this.loading && animate
      ? renderPulseText(` ${countLabel} sessions`, 'sessions:loading', 'primary', appearance)
      : currentTheme.boldFg('primary', ` ${countLabel} sessions`) + searchInfo;
    lines.push(this.pad(header, width));

    if (this.loading && this.sessions.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', 'Loading…')}`, width));
      return this.fillLines(lines, height, width);
    }

    if (this.sessions.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', '(no sessions)')}`, width));
      return this.fillLines(lines, height, width);
    }

    if (filtered.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', `(no match for "${searchQuery}")`)}`, width));
      return this.fillLines(lines, height, width);
    }

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, filtered.length - 1));

    // Ensure cursor is visible
    const visibleRows = height - 2; // header + status
    if (this.cursorIndex < this.scrollTop) {
      this.scrollTop = this.cursorIndex;
    } else if (this.cursorIndex >= this.scrollTop + visibleRows) {
      this.scrollTop = this.cursorIndex - visibleRows + 1;
    }

    // Render visible sessions
    const end = Math.min(filtered.length, this.scrollTop + visibleRows);
    for (let i = this.scrollTop; i < end; i++) {
      const session = filtered[i]!;
      const isCurrent = session.id === currentId;
      const isSelected = i === this.cursorIndex && focused;

      const marker = isCurrent
        ? currentTheme.fg('success', '●')
        : isSelected
          ? currentTheme.fg('primary', '▸')
          : ' ';
      let title = session.title ?? session.lastPrompt ?? session.id.slice(0, 8);
      const time = styledRelativeTime(session.updatedAt);

      // Highlight search matches in title
      if (searchQuery && searchQuery.length > 0) {
        title = this.highlightSearch(title, searchQuery);
      }

      // Line 1: marker + title + time
      const timeStr = time.length > 0 ? ` ${time}` : '';
      const maxTitle = width - 3 - timeStr.length;
      const line1 = `${marker} ${truncate(title, maxTitle)}${timeStr}`;
      lines.push(this.styleLine(line1, width, isSelected, isCurrent));

      // Line 2 (if space): work_dir abbreviated + session age
      if (visibleRows > this.sessions.length) {
        const dir = session.workDir.replace(/^.*\//, '');
        const ageSec = Math.floor(Math.max(0, Date.now() - session.updatedAt) / 1000);
        const ageLabel = ageSec < 3600
          ? `${String(Math.floor(ageSec / 60))}m`
          : ageSec < 86400
            ? `${String(Math.floor(ageSec / 3600))}h${String(Math.floor((ageSec % 3600) / 60))}m`
            : `${String(Math.floor(ageSec / 86400))}d`;
        const ageStr = currentTheme.dimFg('textMuted', ` · ${ageLabel}`);
        const line2 = `   ${truncate(dir, width - 10)}${ageStr}`;
        lines.push(this.pad(line2, width));
      }
    }

    // Status bar
    if (this.statusMessage !== null) {
      const statusStyled = this.statusMessage.includes('✓')
        ? currentTheme.fg('success', ` ${this.statusMessage}`)
        : this.statusMessage.includes('error') || this.statusMessage.includes('failed')
          ? currentTheme.fg('error', ` ${this.statusMessage}`)
          : animate
            ? renderPulseText(` ${this.statusMessage}`, 'sessions:status', 'accent', appearance)
            : currentTheme.fg('accent', ` ${this.statusMessage}`);
      lines.push(this.pad(statusStyled, width));
    } else {
      const sortLabel = this.sortMode === 'name' ? ' [name]' : '';
      const hint = focused ? ` ↵switch r:refresh n:new s:sort${sortLabel} j/k:nav` : '';
      lines.push(this.pad(this.dim(hint), width));
    }

    return this.fillLines(lines, height, width);
  }

  /** Highlight search query matches in a line. */
  private highlightSearch(line: string, query: string): string {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerLine.indexOf(lowerQuery);
    if (idx === -1) return line;

    const before = line.slice(0, idx);
    const match = line.slice(idx, idx + query.length);
    const after = line.slice(idx + query.length);
    return `${before}${currentTheme.bg('selectionBg', currentTheme.fg('selectionText', match))}${after}`;
  }

  onInput(event: NativeInputEvent): boolean {
    // Mouse wheel support
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        this.cursorIndex = Math.max(0, this.cursorIndex - 3);
        this.requestRender();
        return true;
      }
      if (event.button === 'wheel-down') {
        this.cursorIndex = Math.min(this.sessions.length - 1, this.cursorIndex + 3);
        this.requestRender();
        return true;
      }
      return false;
    }

    if (event.type !== 'key') return false;

    // Handle named keys
    if (event.key === 'up') {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'down') {
      this.cursorIndex = Math.min(this.sessions.length - 1, this.cursorIndex + 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'enter') {
      void this.switchToSelected();
      return true;
    }

    // Handle character keys
    if (event.key === 'character' && event.text !== undefined) {
      const ch = event.text;
      if (ch === 'k') {
        this.cursorIndex = Math.max(0, this.cursorIndex - 1);
        this.requestRender();
        return true;
      }
      if (ch === 'j') {
        this.cursorIndex = Math.min(this.sessions.length - 1, this.cursorIndex + 1);
        this.requestRender();
        return true;
      }
      if (ch === 'r') {
        void this.refresh();
        return true;
      }
      if (ch === 'n') {
        void this.createNew();
        return true;
      }
      if (ch === 'g') {
        this.cursorIndex = 0;
        this.scrollTop = 0;
        this.requestRender();
        return true;
      }
      if (ch === 'G') {
        this.cursorIndex = this.sessions.length - 1;
        this.requestRender();
        return true;
      }
      if (ch === 's') {
        this.sortMode = this.sortMode === 'time' ? 'name' : 'time';
        this.applySorting();
        this.requestRender();
        return true;
      }
    }

    return false;
  }

  dispose(): void {
    this.sessions = [];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.sessions = await this.callbacks.listSessions();
      this.applySorting();
      this.statusMessage = null;
    } catch {
      this.statusMessage = 'fetch failed';
    } finally {
      this.loading = false;
      this.lastRefresh = Date.now();
      this.requestRender();
    }
  }

  private async switchToSelected(): Promise<void> {
    const session = this.sessions[this.cursorIndex];
    if (session === undefined) return;
    const currentId = this.callbacks.currentSessionId();
    if (session.id === currentId) {
      this.statusMessage = 'already active';
      this.requestRender();
      return;
    }
    this.statusMessage = 'switching…';
    this.requestRender();
    try {
      const ok = await this.callbacks.switchSession(session.id);
      this.statusMessage = ok ? 'switched ✓' : 'switch failed';
    } catch {
      this.statusMessage = 'switch error';
    }
    this.requestRender();
    // Clear status after a moment
    setTimeout(() => {
      this.statusMessage = null;
      this.requestRender();
    }, 2000);
  }

  private async createNew(): Promise<void> {
    if (this.callbacks.createSession === undefined) return;
    this.statusMessage = 'creating…';
    this.requestRender();
    try {
      const ok = await this.callbacks.createSession();
      this.statusMessage = ok ? 'created ✓' : 'create failed';
      await this.refresh();
    } catch {
      this.statusMessage = 'create error';
    }
    this.requestRender();
  }

  private applySorting(): void {
    if (this.sortMode === 'name') {
      this.sessions.sort((a, b) => {
        const titleA = (a.title ?? a.lastPrompt ?? a.id).toLowerCase();
        const titleB = (b.title ?? b.lastPrompt ?? b.id).toLowerCase();
        return titleA.localeCompare(titleB);
      });
    } else {
      this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }
  }

  private requestRender(): void {
    // The workspace controller will pick up changes on next frame
  }

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  private pad(text: string, width: number): string {
    if (text.length >= width) return text.slice(0, width);
    return text + ' '.repeat(width - text.length);
  }

  private fillLines(lines: string[], height: number, width: number): string[] {
    const result = lines.slice(0, height);
    while (result.length < height) {
      result.push(' '.repeat(width));
    }
    return result;
  }

  private styleLine(text: string, width: number, selected: boolean, current: boolean): string {
    let styled = text;
    if (current) {
      styled = currentTheme.boldFg('primary', text);
    } else if (selected) {
      styled = currentTheme.bg('selectionBg', currentTheme.fg('selectionText', text));
    }
    // Pad with spaces (not styled) to fill width
    const padding = Math.max(0, width - text.length);
    return styled + ' '.repeat(padding);
  }

  private dim(text: string): string {
    return currentTheme.dimFg('textDim', text);
  }
}
