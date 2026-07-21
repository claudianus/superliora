import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityKind =
  | 'tool-start'
  | 'tool-progress'
  | 'tool-result'
  | 'tool-error'
  | 'thinking'
  | 'decision'
  | 'file-read'
  | 'file-write'
  | 'command'
  | 'agent-spawn'
  | 'agent-done'
  | 'info';

export interface ActivityEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly kind: ActivityKind;
  readonly label: string;
  readonly detail?: string;
  readonly durationMs?: number;
  readonly isError?: boolean;
}

// ---------------------------------------------------------------------------
// ActivityFeed — shared event bus
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 200;

let nextEntryId = 1;

export class ActivityFeed {
  private entries: ActivityEntry[] = [];
  private listeners: Array<() => void> = [];

  push(kind: ActivityKind, label: string, detail?: string, isError = false): string {
    const id = `act-${nextEntryId++}`;
    const entry: ActivityEntry = {
      id,
      timestamp: Date.now(),
      kind,
      label,
      detail,
      isError,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.notify();
    return id;
  }

  complete(id: string, durationMs: number, isError = false): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry === undefined) return;
    // Mutate in place (entries are readonly-typed but we own the array)
    (entry as { durationMs?: number }).durationMs = durationMs;
    if (isError) (entry as { isError?: boolean }).isError = true;
    this.notify();
  }

  getEntries(): readonly ActivityEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<ActivityKind, string> = {
  'tool-start': '⚡',
  'tool-progress': '…',
  'tool-result': '✓',
  'tool-error': '✗',
  thinking: '◌',
  decision: '◆',
  'file-read': '📖',
  'file-write': '✏',
  command: '▶',
  'agent-spawn': '⑂',
  'agent-done': '⑁',
  info: 'ℹ',
};

// ---------------------------------------------------------------------------
// ActivityTransparencyPanel
// ---------------------------------------------------------------------------

export class ActivityTransparencyPanel implements PanelDefinition {
  readonly id = 'activity-feed';
  readonly title = 'Activity';
  readonly icon = '◎';
  readonly minWidth = 28;
  readonly minHeight = 6;

  private readonly feed: ActivityFeed;
  private scrollTop = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | null = null;
  private filterKind: ActivityKind | null = null;

  constructor(feed: ActivityFeed) {
    this.feed = feed;
    this.unsubscribe = feed.onChange(() => {
      if (this.autoScroll) {
        this.scrollToBottom();
      }
    });
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    const entries = this.getFilteredEntries();
    const lines: string[] = [];

    // Header
    const filterLabel = this.filterKind !== null ? ` [${this.filterKind}]` : '';
    const countLabel = `${String(entries.length)} events${filterLabel}`;
    lines.push(this.pad(` ${countLabel}`, width));

    if (entries.length === 0) {
      lines.push(this.pad(this.dim('  (no activity yet)'), width));
      return this.fillLines(lines, height, width);
    }

    // Clamp scroll
    const visibleRows = height - 2; // header + hint
    const maxScroll = Math.max(0, entries.length - visibleRows);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    // Render visible entries (newest at bottom)
    const end = Math.min(entries.length, this.scrollTop + visibleRows);
    for (let i = this.scrollTop; i < end; i++) {
      const entry = entries[i]!;
      let line = this.formatEntry(entry, width);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        line = this.highlightSearch(line, searchQuery);
      }
      lines.push(line);
    }

    // Hint bar
    const hint = focused
      ? this.dim(' j/k:scroll c:clear f:filter a:auto')
      : this.dim(this.autoScroll ? ' ●live' : ' ○paused');
    lines.push(this.pad(hint, width));

    return this.fillLines(lines, height, width);
  }

  /** Highlight search query matches in a line. */
  private highlightSearch(line: string, query: string): string {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerLine.indexOf(lowerQuery);
    if (idx === -1) return line;

    // Wrap match in highlight ANSI codes (reverse video)
    const before = line.slice(0, idx);
    const match = line.slice(idx, idx + query.length);
    const after = line.slice(idx + query.length);
    return `${before}\u001B[7m${match}\u001B[0m${after}`;
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    if (event.key === 'up') {
      this.scrollTop = Math.max(0, this.scrollTop - 1);
      this.autoScroll = false;
      return true;
    }
    if (event.key === 'down') {
      this.scrollTop++;
      this.checkAutoScroll();
      return true;
    }

    if (event.key === 'character' && event.text !== undefined) {
      const ch = event.text;
      if (ch === 'k') {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
        this.autoScroll = false;
        return true;
      }
      if (ch === 'j') {
        this.scrollTop++;
        this.checkAutoScroll();
        return true;
      }
      if (ch === 'g') {
        this.scrollTop = 0;
        this.autoScroll = false;
        return true;
      }
      if (ch === 'G') {
        this.scrollToBottom();
        return true;
      }
      if (ch === 'c') {
        this.feed.clear();
        this.scrollTop = 0;
        return true;
      }
      if (ch === 'a') {
        this.autoScroll = !this.autoScroll;
        if (this.autoScroll) this.scrollToBottom();
        return true;
      }
      if (ch === 'f') {
        // Cycle filter
        this.cycleFilter();
        return true;
      }
    }

    return false;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private getFilteredEntries(): readonly ActivityEntry[] {
    if (this.filterKind === null) return this.feed.getEntries();
    return this.feed.getEntries().filter((e) => e.kind === this.filterKind);
  }

  private cycleFilter(): void {
    const kinds: Array<ActivityKind | null> = [
      null,
      'tool-start',
      'thinking',
      'file-read',
      'file-write',
      'command',
      'decision',
      'agent-spawn',
    ];
    const currentIdx = kinds.indexOf(this.filterKind);
    this.filterKind = kinds[(currentIdx + 1) % kinds.length]!;
    this.scrollTop = 0;
  }

  private scrollToBottom(): void {
    const entries = this.getFilteredEntries();
    this.scrollTop = Math.max(0, entries.length - 20);
    this.autoScroll = true;
  }

  private checkAutoScroll(): void {
    const entries = this.getFilteredEntries();
    const visibleRows = 20;
    if (this.scrollTop >= entries.length - visibleRows) {
      this.autoScroll = true;
    }
  }

  private formatEntry(entry: ActivityEntry, width: number): string {
    const icon = KIND_ICONS[entry.kind] ?? '·';
    const time = formatTime(entry.timestamp);
    const duration =
      entry.durationMs !== undefined ? ` ${formatDuration(entry.durationMs)}` : '';

    const prefix = `${time} ${icon} `;
    const maxLabel = width - prefix.length - duration.length;
    const label = truncate(entry.label, Math.max(4, maxLabel));

    let line = `${prefix}${label}${duration}`;

    // Color coding
    if (entry.isError) {
      line = `\x1b[31m${line}\x1b[0m`;
    } else if (entry.kind === 'tool-result') {
      line = `\x1b[32m${line}\x1b[0m`;
    } else if (entry.kind === 'decision' || entry.kind === 'thinking') {
      line = `\x1b[33m${line}\x1b[0m`;
    } else if (entry.kind === 'agent-spawn' || entry.kind === 'agent-done') {
      line = `\x1b[35m${line}\x1b[0m`;
    }

    return this.pad(line, width);
  }

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  private pad(text: string, width: number): string {
    // Account for ANSI escape codes in length calculation
    const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (visibleLen >= width) return text;
    return text + ' '.repeat(width - visibleLen);
  }

  private fillLines(lines: string[], height: number, width: number): string[] {
    const result = lines.slice(0, height);
    while (result.length < height) {
      result.push(' '.repeat(width));
    }
    return result;
  }

  private dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${String(min)}m${String(Math.floor(sec % 60))}s`;
}
