/**
 * SessionSplitPanel — side-by-side monitoring of two active sessions.
 *
 * Renders a vertical split showing the latest activity from two sessions
 * simultaneously, allowing the user to monitor parallel agent work without
 * switching contexts. Each half shows:
 * - Session title / last prompt
 * - Current activity (thinking, tool call, composing)
 * - Last few transcript lines (truncated)
 * - Elapsed time and token usage
 *
 * Key bindings (when focused):
 *   Tab / →   Switch focus between left and right pane
 *   ←         Switch focus back
 *   r         Refresh both sessions
 *   1 / 2     Focus left / right pane
 *   s         Swap left and right
 *   f         Toggle full-screen for focused pane
 *   Esc       Close panel
 */

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SplitSessionData {
  readonly id: string;
  readonly title: string;
  readonly lastPrompt: string | null;
  readonly activity: SplitActivityState;
  readonly recentLines: string[];
  readonly elapsedMs: number;
  readonly tokenUsage: { input: number; output: number } | null;
  readonly model: string | null;
}

export type SplitActivityState =
  | 'idle'
  | 'thinking'
  | 'composing'
  | 'tool-call'
  | 'waiting'
  | 'error';

export interface SessionSplitCallbacks {
  /** Fetch data for a session by id. */
  getSessionData(id: string): Promise<SplitSessionData | null>;
  /** Get the list of active session ids. */
  getActiveSessions(): Promise<string[]>;
  /** Get the current session id. */
  currentSessionId(): string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVITY_GLYPH: Record<SplitActivityState, string> = {
  idle: '○',
  thinking: '◐',
  composing: '●',
  'tool-call': '⚙',
  waiting: '◌',
  error: '✗',
};

const ACTIVITY_TOKEN: Record<SplitActivityState, string> = {
  idle: 'textMuted',
  thinking: 'accent',
  composing: 'primary',
  'tool-call': 'warning',
  waiting: 'textMuted',
  error: 'error',
};

const DIVIDER_CHAR = '│';

// ---------------------------------------------------------------------------
// SessionSplitPanel
// ---------------------------------------------------------------------------

export class SessionSplitPanel implements PanelDefinition {
  readonly id = 'session-split';
  readonly title = 'Split View';
  readonly icon = '◫';
  readonly minWidth = 60;
  readonly minHeight = 12;

  private readonly callbacks: SessionSplitCallbacks;
  private leftSessionId: string | null = null;
  private rightSessionId: string | null = null;
  private leftData: SplitSessionData | null = null;
  private rightData: SplitSessionData | null = null;
  private focusedPane: 'left' | 'right' = 'left';
  private fullscreenPane: 'left' | 'right' | null = null;
  private lastRefresh = 0;
  private loading = false;

  constructor(callbacks: SessionSplitCallbacks, leftId?: string, rightId?: string) {
    this.callbacks = callbacks;
    this.leftSessionId = leftId ?? null;
    this.rightSessionId = rightId ?? null;
    void this.refresh();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    const now = Date.now();
    if (now - this.lastRefresh > 3000 && !this.loading) {
      void this.refresh();
    }

    if (this.loading && !this.leftData && !this.rightData) {
      return [currentTheme.dimFg('textMuted', '  Loading sessions…')];
    }

    // Fullscreen mode: one pane takes all width
    if (this.fullscreenPane) {
      const data = this.fullscreenPane === 'left' ? this.leftData : this.rightData;
      return this.renderPane(data, width, height, focused && this.focusedPane === this.fullscreenPane);
    }

    // Split mode: two panes side by side
    const dividerWidth = 1;
    const paneWidth = Math.floor((width - dividerWidth) / 2);
    const leftWidth = paneWidth;
    const rightWidth = width - dividerWidth - paneWidth;

    const leftLines = this.renderPane(this.leftData, leftWidth, height, focused && this.focusedPane === 'left');
    const rightLines = this.renderPane(this.rightData, rightWidth, height, focused && this.focusedPane === 'right');

    // Merge side by side with divider
    const lines: string[] = [];
    for (let row = 0; row < height; row++) {
      const left = (leftLines[row] ?? '').padEnd(leftWidth).slice(0, leftWidth);
      const right = (rightLines[row] ?? '').padEnd(rightWidth).slice(0, rightWidth);
      const divider = currentTheme.dimFg('textMuted', DIVIDER_CHAR);
      lines.push(`${left}${divider}${right}`);
    }

    return lines;
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    switch (event.key) {
      case 'tab':
      case 'right':
        this.focusedPane = this.focusedPane === 'left' ? 'right' : 'left';
        return true;
      case 'left':
        this.focusedPane = this.focusedPane === 'right' ? 'left' : 'right';
        return true;
      case 'character':
        return this.handleCharKey(event.text ?? '');
      case 'escape':
        if (this.fullscreenPane) {
          this.fullscreenPane = null;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  dispose(): void {
    this.leftData = null;
    this.rightData = null;
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private handleCharKey(text: string): boolean {
    switch (text) {
      case '1':
        this.focusedPane = 'left';
        return true;
      case '2':
        this.focusedPane = 'right';
        return true;
      case 's':
      case 'S': {
        // Swap panes
        const tmpId = this.leftSessionId;
        const tmpData = this.leftData;
        this.leftSessionId = this.rightSessionId;
        this.leftData = this.rightData;
        this.rightSessionId = tmpId;
        this.rightData = tmpData;
        return true;
      }
      case 'f':
      case 'F':
        // Toggle fullscreen for focused pane
        this.fullscreenPane = this.fullscreenPane === this.focusedPane ? null : this.focusedPane;
        return true;
      case 'r':
      case 'R':
        void this.refresh();
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.lastRefresh = Date.now();

    try {
      // Auto-assign sessions if not set
      if (!this.leftSessionId || !this.rightSessionId) {
        const sessions = await this.callbacks.getActiveSessions();
        const current = this.callbacks.currentSessionId();
        if (!this.leftSessionId && sessions.length > 0) {
          this.leftSessionId = current;
        }
        if (!this.rightSessionId && sessions.length > 1) {
          this.rightSessionId = sessions.find((s) => s !== current) ?? null;
        }
      }

      // Fetch data for both panes
      const [left, right] = await Promise.all([
        this.leftSessionId ? this.callbacks.getSessionData(this.leftSessionId) : null,
        this.rightSessionId ? this.callbacks.getSessionData(this.rightSessionId) : null,
      ]);

      this.leftData = left;
      this.rightData = right;
    } finally {
      this.loading = false;
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderPane(data: SplitSessionData | null, width: number, height: number, focused: boolean): string[] {
    if (!data) {
      return [
        '',
        currentTheme.dimFg('textMuted', '  (no session)'),
        '',
        currentTheme.dimFg('textMuted', '  Assign a session to monitor'),
      ];
    }

    const lines: string[] = [];

    // Header: activity glyph + title
    const glyph = currentTheme.fg(ACTIVITY_TOKEN[data.activity] as any, ACTIVITY_GLYPH[data.activity]);
    const title = truncate(data.title || data.lastPrompt || data.id, width - 6);
    const focusIndicator = focused ? currentTheme.fg('primary', '▸ ') : '  ';
    lines.push(`${focusIndicator}${glyph} ${currentTheme.boldFg(focused ? 'primary' : 'text', title)}`);

    // Activity status line
    const activityLabel = formatActivity(data.activity);
    const elapsed = formatElapsed(data.elapsedMs);
    lines.push(`  ${activityLabel} ${currentTheme.dimFg('textMuted', `· ${elapsed}`)}`);

    // Model + token usage
    if (data.model || data.tokenUsage) {
      const model = data.model ? currentTheme.dimFg('textMuted', data.model) : '';
      const tokens = data.tokenUsage
        ? currentTheme.dimFg('textMuted', ` ↑${formatTokens(data.tokenUsage.input)} ↓${formatTokens(data.tokenUsage.output)}`)
        : '';
      lines.push(`  ${model}${tokens}`);
    }

    // Separator
    lines.push(currentTheme.dimFg('textMuted', '  ' + '─'.repeat(Math.max(1, width - 4))));

    // Recent transcript lines
    const availableRows = height - lines.length - 1;
    const recentLines = data.recentLines.slice(-Math.max(1, availableRows));
    for (const line of recentLines) {
      lines.push('  ' + truncate(line, width - 4));
    }

    // Fill remaining space
    while (lines.length < height) {
      lines.push('');
    }

    return lines.slice(0, height);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function formatActivity(state: SplitActivityState): string {
  switch (state) {
    case 'idle': return currentTheme.dimFg('textMuted', 'idle');
    case 'thinking': return currentTheme.fg('accent', 'thinking…');
    case 'composing': return currentTheme.fg('primary', 'composing…');
    case 'tool-call': return currentTheme.fg('warning', 'running tool');
    case 'waiting': return currentTheme.dimFg('textMuted', 'waiting');
    case 'error': return currentTheme.fg('error', 'error');
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}
