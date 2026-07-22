/**
 * LogViewer — structured log viewing with filtering and search.
 *
 * Provides a terminal log viewer:
 * - Level-based coloring (trace/debug/info/warn/error/fatal)
 * - Filter by level, source, time range
 * - Full-text search with highlighting
 * - Tail mode (follow new entries)
 * - Fold/collapse multi-line entries
 * - Timestamp formatting (relative/absolute)
 * - Column alignment (time | level | source | message)
 * - Bookmark important lines
 * - Export filtered view
 * - Statistics summary (count by level)
 *
 * Visual style:
 * ┌─ Logs ─────────────────────────────── [542 entries] ┐
 * │ 14:32:01 INFO  server   Listening on :3000         │
 * │ 14:32:03 DEBUG db       Pool initialized (size=10)  │
 * │ 14:32:05 WARN  auth     Token expiring in 5min      │
 * │ 14:32:07 ERROR api      Failed to fetch /users      │
 * │ 14:32:09 INFO  worker   Job #42 completed (1.2s)    │
 * │                                                     │
 * │ Filter: [ERROR+] Search: "fetch" | 3/542 shown     │
 * └─────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly details?: string; // Multi-line detail
  readonly bookmarked?: boolean;
}

export interface LogFilter {
  readonly levels?: LogLevel[];
  readonly sources?: string[];
  readonly search?: string;
  readonly timeFrom?: number;
  readonly timeTo?: number;
  readonly bookmarkedOnly?: boolean;
}

export interface LogStats {
  readonly total: number;
  readonly byLevel: Record<LogLevel, number>;
  readonly sources: string[];
  readonly timeSpan: { from: number; to: number };
}

export interface LogRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showTimestamp?: boolean;
  readonly showSource?: boolean;
  readonly relativeTime?: boolean;
  readonly highlightSearch?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// LogViewer
// ---------------------------------------------------------------------------

const LEVEL_ORDER: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_ICONS: Record<LogLevel, string> = {
  trace: '·', debug: '◇', info: 'ℹ', warn: '⚡', error: '✖', fatal: '☠',
};
const LEVEL_TOKENS: Record<LogLevel, string> = {
  trace: 'textMuted', debug: 'textDim', info: 'primary', warn: 'warning', error: 'error', fatal: 'error',
};

export class LogViewer {
  private entries: LogEntry[] = [];
  private filter: LogFilter = {};
  private counter = 0;
  private scrollOffset = 0;
  private tailMode = true;
  private collapsedIds: Set<number> = new Set();

  // ─── Entry Management ────────────────────────────────────────────

  /** Add a log entry. */
  addEntry(level: LogLevel, source: string, message: string, details?: string): number {
    const id = ++this.counter;
    this.entries.push({ id, timestamp: Date.now(), level, source, message, details });
    return id;
  }

  /** Add entry with explicit timestamp. */
  addEntryAt(timestamp: number, level: LogLevel, source: string, message: string, details?: string): number {
    const id = ++this.counter;
    this.entries.push({ id, timestamp, level, source, message, details });
    return id;
  }

  /** Toggle bookmark on an entry. */
  toggleBookmark(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      const idx = this.entries.indexOf(entry);
      this.entries[idx] = { ...entry, bookmarked: !entry.bookmarked };
    }
  }

  /** Toggle collapse on an entry. */
  toggleCollapse(id: number): void {
    if (this.collapsedIds.has(id)) {
      this.collapsedIds.delete(id);
    } else {
      this.collapsedIds.add(id);
    }
  }

  /** Get total entry count. */
  get totalCount(): number {
    return this.entries.length;
  }

  // ─── Filtering ───────────────────────────────────────────────────

  /** Set the filter. */
  setFilter(filter: LogFilter): void {
    this.filter = filter;
    this.scrollOffset = 0;
  }

  /** Get current filter. */
  getFilter(): LogFilter {
    return this.filter;
  }

  /** Get filtered entries. */
  getFilteredEntries(): LogEntry[] {
    let result = this.entries;

    if (this.filter.levels && this.filter.levels.length > 0) {
      result = result.filter((e) => this.filter.levels!.includes(e.level));
    }
    if (this.filter.sources && this.filter.sources.length > 0) {
      result = result.filter((e) => this.filter.sources!.includes(e.source));
    }
    if (this.filter.search) {
      const q = this.filter.search.toLowerCase();
      result = result.filter((e) => e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q));
    }
    if (this.filter.timeFrom) {
      result = result.filter((e) => e.timestamp >= this.filter.timeFrom!);
    }
    if (this.filter.timeTo) {
      result = result.filter((e) => e.timestamp <= this.filter.timeTo!);
    }
    if (this.filter.bookmarkedOnly) {
      result = result.filter((e) => e.bookmarked);
    }

    return result;
  }

  /** Get statistics. */
  getStats(): LogStats {
    const byLevel: Record<LogLevel, number> = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    const sources = new Set<string>();

    for (const entry of this.entries) {
      byLevel[entry.level]++;
      sources.add(entry.source);
    }

    return {
      total: this.entries.length,
      byLevel,
      sources: [...sources],
      timeSpan: {
        from: this.entries[0]?.timestamp ?? 0,
        to: this.entries[this.entries.length - 1]?.timestamp ?? 0,
      },
    };
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Scroll up. */
  scrollUp(lines = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    this.tailMode = false;
  }

  /** Scroll down. */
  scrollDown(lines = 1): void {
    this.scrollOffset += lines;
    const filtered = this.getFilteredEntries();
    const maxOffset = Math.max(0, filtered.length - 10);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
  }

  /** Enable tail mode (follow latest). */
  enableTail(): void {
    this.tailMode = true;
  }

  /** Check if in tail mode. */
  get isTailing(): boolean {
    return this.tailMode;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the log viewer. */
  render(options: LogRenderOptions): string[] {
    const { width, height, showTimestamp = true, showSource = true, relativeTime = false, highlightSearch = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const filtered = this.getFilteredEntries();
    const innerWidth = width - 2;

    // Header
    const filterDesc = this.describeFilter();
    const headerTitle = ` Logs ${filterDesc ? `[${filterDesc}]` : ''}`;
    const headerCount = `${filtered.length}/${this.entries.length} `;
    lines.push(fg('textMuted', `┌─${boldFg('text', headerTitle)}${'─'.repeat(Math.max(0, innerWidth - headerTitle.length - headerCount.length - 2))}${dimFg('textMuted', headerCount)}┐`));

    // Calculate visible window
    const contentHeight = height - 3; // header + footer + border
    let startIdx: number;
    if (this.tailMode) {
      startIdx = Math.max(0, filtered.length - contentHeight);
    } else {
      startIdx = this.scrollOffset;
    }
    const visibleEntries = filtered.slice(startIdx, startIdx + contentHeight);

    // Render entries
    for (const entry of visibleEntries) {
      const line = this.renderEntry(entry, innerWidth, { showTimestamp, showSource, relativeTime, highlightSearch, fg, boldFg, dimFg });
      lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));

      // Show details if not collapsed
      if (entry.details && !this.collapsedIds.has(entry.id)) {
        const detailLines = entry.details.split('\n').slice(0, 3);
        for (const dl of detailLines) {
          const detailStr = dimFg('textMuted', `  │ ${dl.slice(0, innerWidth - 6)}`);
          lines.push(fg('textMuted', '│') + padRight(detailStr, innerWidth) + fg('textMuted', '│'));
        }
      }
    }

    // Pad remaining height
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer with filter/search info
    const tailIcon = this.tailMode ? fg('success', '⏵ tail') : dimFg('textMuted', '⏸ scroll');
    const searchInfo = this.filter.search ? ` Search: "${this.filter.search}"` : '';
    const footer = ` ${tailIcon}${searchInfo}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderEntry(entry: LogEntry, width: number, options: LogRenderOptions): string {
    const { showTimestamp = true, showSource = true, relativeTime = false, highlightSearch = true, fg, boldFg, dimFg } = options;
    let parts: string[] = [];
    let usedWidth = 0;

    // Bookmark indicator
    const bookmark = entry.bookmarked ? fg('warning', '★') : ' ';
    parts.push(bookmark);
    usedWidth += 1;

    // Timestamp
    if (showTimestamp) {
      const ts = relativeTime ? formatRelativeTime(entry.timestamp) : formatTime(entry.timestamp);
      parts.push(dimFg('textMuted', ts) + ' ');
      usedWidth += ts.length + 1;
    }

    // Level
    const levelIcon = LEVEL_ICONS[entry.level];
    const levelToken = LEVEL_TOKENS[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);
    parts.push(fg(levelToken, `${levelIcon} ${levelStr}`) + ' ');
    usedWidth += 8;

    // Source
    if (showSource) {
      const src = entry.source.padEnd(8).slice(0, 8);
      parts.push(fg('accent', src) + ' ');
      usedWidth += 9;
    }

    // Message with search highlighting
    const remainingWidth = width - usedWidth - 1;
    let message = entry.message.slice(0, remainingWidth);
    if (highlightSearch && this.filter.search) {
      message = highlightMatch(message, this.filter.search, fg);
    }
    parts.push(fg('text', message));

    // Collapse indicator
    if (entry.details) {
      const collapseIcon = this.collapsedIds.has(entry.id) ? dimFg('textMuted', ' ▸') : dimFg('textMuted', ' ▾');
      parts.push(collapseIcon);
    }

    const result = parts.join('');
    return padRight(result, width);
  }

  private describeFilter(): string {
    const parts: string[] = [];
    if (this.filter.levels && this.filter.levels.length > 0 && this.filter.levels.length < 6) {
      parts.push(this.filter.levels.map((l) => l.toUpperCase()).join('+'));
    }
    if (this.filter.sources && this.filter.sources.length > 0) {
      parts.push(this.filter.sources.join(','));
    }
    return parts.join(' | ');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function highlightMatch(text: string, query: string, fg: (token: string, text: string) => string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${before}${fg('warning', match)}${after}`;
}

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo log viewer with sample entries. */
export function createDemoLogViewer(): LogViewer {
  const viewer = new LogViewer();
  const baseTime = Date.now() - 60000;

  viewer.addEntryAt(baseTime, 'info', 'server', 'Listening on :3000');
  viewer.addEntryAt(baseTime + 2000, 'debug', 'db', 'Pool initialized (size=10)');
  viewer.addEntryAt(baseTime + 5000, 'info', 'auth', 'User login: alice@example.com');
  viewer.addEntryAt(baseTime + 8000, 'warn', 'auth', 'Token expiring in 5min', 'JWT expires at 14:37:00\nConsider refreshing');
  viewer.addEntryAt(baseTime + 12000, 'error', 'api', 'Failed to fetch /users', 'HTTP 503: Service Unavailable\nRetry-After: 30');
  viewer.addEntryAt(baseTime + 15000, 'info', 'worker', 'Job #42 completed (1.2s)');
  viewer.addEntryAt(baseTime + 18000, 'debug', 'cache', 'Cache hit ratio: 94.2%');
  viewer.addEntryAt(baseTime + 22000, 'error', 'api', 'Timeout fetching /orders', 'ETIMEDOUT after 30000ms');
  viewer.addEntryAt(baseTime + 25000, 'fatal', 'db', 'Connection pool exhausted');
  viewer.addEntryAt(baseTime + 28000, 'info', 'server', 'Graceful restart initiated');

  return viewer;
}
