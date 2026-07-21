import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';
import {
  renderPulseText,
  renderShimmerPrefix,
  appearanceAnimationNow,
  shouldRenderAmbientEffects,
  resolveQualityAdjustedAmbientEffectMode,
  getActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import type { ColorToken } from '#/tui/theme';

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
  | 'agent-progress'
  | 'info';

export interface ActivityEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly kind: ActivityKind;
  readonly label: string;
  readonly detail?: string;
  readonly durationMs?: number;
  readonly isError?: boolean;
  /** For in-progress entries: when the operation started (for elapsed time). */
  readonly startedAtMs?: number;
  /** Progress 0-1 for determinate operations. */
  readonly progress?: number;
}

// ---------------------------------------------------------------------------
// ActivityFeed — shared event bus
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 200;

let nextEntryId = 1;

export class ActivityFeed {
  private entries: ActivityEntry[] = [];
  private listeners: Array<() => void> = [];

  push(kind: ActivityKind, label: string, detail?: string, isError = false, startedAtMs?: number): string {
    const id = `act-${nextEntryId++}`;
    const entry: ActivityEntry = {
      id,
      timestamp: Date.now(),
      kind,
      label,
      detail,
      isError,
      startedAtMs,
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

  updateProgress(id: string, progress: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry === undefined) return;
    (entry as { progress?: number }).progress = Math.min(1, Math.max(0, progress));
    this.notify();
  }

  getEntries(): readonly ActivityEntry[] {
    return this.entries;
  }

  /** Count of currently active (in-progress) entries. */
  getActiveCount(): number {
    return this.entries.filter((e) => e.durationMs === undefined && !e.isError).length;
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
  'agent-progress': '⟳',
  info: 'ℹ',
};

/** Semantic color token for each activity kind. */
const KIND_TOKENS: Record<ActivityKind, 'primary' | 'accent' | 'success' | 'error' | 'warning' | 'textDim' | 'particle' | 'glow' | 'shellMode'> = {
  'tool-start': 'primary',
  'tool-progress': 'accent',
  'tool-result': 'success',
  'tool-error': 'error',
  thinking: 'warning',
  decision: 'glow',
  'file-read': 'textDim',
  'file-write': 'accent',
  command: 'primary',
  'agent-spawn': 'particle',
  'agent-done': 'success',
  'agent-progress': 'particle',
  info: 'textDim',
};

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

/** Pulse interval for active entries (ms). */
const ACTIVE_PULSE_MS = 320;
/** Progress bar width in characters. */
const PROGRESS_BAR_WIDTH = 12;
/** Progress bar characters. */
const PROGRESS_FILLED = '━';
const PROGRESS_EMPTY = '┄';

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
  /** Render cache: avoids re-computing lines when nothing changed. */
  private renderCache: { lines: string[]; key: string } | null = null;
  private lastEntryCount = 0;
  private lastEntryVersion = 0;

  constructor(feed: ActivityFeed) {
    this.feed = feed;
    this.unsubscribe = feed.onChange(() => {
      this.lastEntryVersion++;
      if (this.autoScroll) {
        this.scrollToBottom();
      }
    });
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    // Fast-path: return cached lines when content hasn't changed and no
    // animation is active (static panels don't need per-frame repaints).
    const entries = this.getFilteredEntries();
    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);
    const cacheKey = `${width}:${height}:${focused}:${searchQuery ?? ''}:${this.scrollTop}:${this.filterKind ?? ''}:${String(this.lastEntryVersion)}`;
    if (!animate && this.renderCache !== null && this.renderCache.key === cacheKey) {
      return this.renderCache.lines;
    }

    const lines: string[] = [];
    const now = appearanceAnimationNow();

    // Header with live status
    const activeCount = this.feed.getActiveCount();
    const filterLabel = this.filterKind !== null ? ` ${this.filterKind}` : '';
    let headerText = `${String(entries.length)} events${filterLabel}`;
    if (activeCount > 0) {
      headerText += ` · ${String(activeCount)} active`;
    }
    // Activity rate sparkline (last 30s, 10 buckets)
    const sparkline = this.renderActivitySparkline(now, width);
    if (animate && activeCount > 0) {
      lines.push(this.pad(` ${renderPulseText(headerText, 'activity-header', 'primary', appearance)}${sparkline}`, width));
    } else {
      lines.push(this.pad(` ${currentTheme.boldFg('primary', headerText)}${sparkline}`, width));
    }

    if (entries.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', '(no activity yet)')}`, width));
      return this.fillLines(lines, height, width);
    }

    // Current operation spotlight: show the latest active entry prominently
    if (activeCount > 0 && height > 4) {
      const activeEntry = this.findLatestActiveEntry(entries);
      if (activeEntry !== undefined) {
        const icon = KIND_ICONS[activeEntry.kind] ?? '·';
        const token = KIND_TOKENS[activeEntry.kind] ?? 'primary';
        const elapsed = activeEntry.startedAtMs !== undefined
          ? ` ${formatElapsedTime(activeEntry.startedAtMs, now)}`
          : '';
        const opText = `${icon} ${activeEntry.label}${elapsed}`;
        const spotlight = animate
          ? renderPulseText(opText, `spotlight:${activeEntry.id}`, token, appearance)
          : currentTheme.fg(token, opText);
        lines.push(this.pad(` ${spotlight}`, width));
      }
    }

    // Clamp scroll
    const visibleRows = height - (activeCount > 0 && height > 4 ? 3 : 2); // header + spotlight + hint
    const maxScroll = Math.max(0, entries.length - visibleRows);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    // Render visible entries (newest at bottom)
    const end = Math.min(entries.length, this.scrollTop + visibleRows);
    for (let i = this.scrollTop; i < end; i++) {
      const entry = entries[i]!;
      let line = this.formatEntry(entry, width, now, animate);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        line = this.highlightSearch(line, searchQuery);
      }
      lines.push(line);
    }

    // Hint bar
    let hint: string;
    if (focused) {
      hint = currentTheme.dimFg('textMuted', ' j/k:scroll c:clear f:filter a:auto');
    } else if (this.autoScroll) {
      const liveDot = animate
        ? renderPulseText('●', 'live-dot', 'success', appearance)
        : currentTheme.fg('success', '●');
      hint = ` ${liveDot}${currentTheme.dimFg('textMuted', 'live')}`;
    } else {
      hint = ` ${currentTheme.dimFg('textMuted', '○ paused')}`;
    }
    lines.push(this.pad(hint, width));

    const result = this.fillLines(lines, height, width);
    this.renderCache = { lines: result, key: cacheKey };
    return result;
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
    if (event.type === 'mouse') {
      if (event.action === 'wheel') {
        if (event.button === 'wheel-up') {
          this.scrollTop = Math.max(0, this.scrollTop - 3);
          this.autoScroll = false;
          return true;
        }
        if (event.button === 'wheel-down') {
          this.scrollTop += 3;
          this.checkAutoScroll();
          return true;
        }
      }
      return false;
    }

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

  /** Find the most recent in-progress entry for the spotlight row. */
  private findLatestActiveEntry(entries: readonly ActivityEntry[]): ActivityEntry | undefined {
    const ACTIVE_KINDS = new Set<ActivityKind>([
      'tool-start', 'tool-progress', 'thinking', 'agent-spawn', 'agent-progress', 'command',
    ]);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.durationMs === undefined && !e.isError && ACTIVE_KINDS.has(e.kind)) return e;
    }
    return undefined;
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
      'agent-progress',
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

  private formatEntry(entry: ActivityEntry, width: number, now: number, animate: boolean): string {
    const icon = KIND_ICONS[entry.kind] ?? '·';
    const token = KIND_TOKENS[entry.kind] ?? 'textDim';
    const time = formatTime(entry.timestamp);

    // Active entry: show elapsed time + pulse
    const isActive = entry.durationMs === undefined && !entry.isError &&
      (entry.kind === 'tool-start' || entry.kind === 'tool-progress' ||
       entry.kind === 'thinking' || entry.kind === 'agent-spawn' ||
       entry.kind === 'agent-progress' || entry.kind === 'command');

    let timePart: string;
    if (isActive && entry.startedAtMs !== undefined) {
      const elapsed = formatElapsedTime(entry.startedAtMs, now);
      timePart = animate
        ? renderPulseText(elapsed, `elapsed:${entry.id}`, 'primary', getActiveAppearancePreferences())
        : currentTheme.fg('primary', elapsed);
    } else {
      timePart = currentTheme.dimFg('textMuted', time);
    }

    const iconPart = currentTheme.fg(token, icon);

    // Duration or progress
    let trailing = '';
    if (entry.durationMs !== undefined) {
      trailing = ` ${currentTheme.dimFg('textMuted', formatDuration(entry.durationMs))}`;
    } else if (entry.progress !== undefined && entry.progress > 0) {
      trailing = ` ${this.renderProgressBar(entry.progress, animate)}`;
    }

    const prefixVisibleLen = time.length + 1 + icon.length + 1; // "HH:MM:SS icon "
    const trailingVisibleLen = trailing.replace(/\x1b\[[0-9;]*m/g, '').length;
    const maxLabel = width - prefixVisibleLen - trailingVisibleLen;
    const label = truncate(entry.label, Math.max(4, maxLabel));

    // Label color: active entries pulse, errors are bold error, done are normal
    let labelPart: string;
    if (entry.isError) {
      labelPart = currentTheme.boldFg('error', label);
    } else if (isActive && animate) {
      labelPart = renderPulseText(label, `label:${entry.id}`, token, getActiveAppearancePreferences());
    } else if (entry.kind === 'tool-result' || entry.kind === 'agent-done') {
      labelPart = currentTheme.fg('success', label);
    } else {
      labelPart = currentTheme.fg(token, label);
    }

    // Detail line (dimmed, truncated)
    let detailPart = '';
    if (entry.detail !== undefined && entry.detail.length > 0) {
      const detailMax = width - 4;
      detailPart = currentTheme.dimFg('textMuted', truncate(entry.detail, detailMax));
    }

    const mainLine = `${timePart} ${iconPart} ${labelPart}${trailing}`;
    return this.pad(detailPart.length > 0 ? `${mainLine}` : mainLine, width);
  }

  /** Render a compact progress bar using theme colors. */
  private renderProgressBar(progress: number, animate: boolean): string {
    const filled = Math.round(progress * PROGRESS_BAR_WIDTH);
    const empty = PROGRESS_BAR_WIDTH - filled;
    const pct = Math.round(progress * 100);
    const appearance = getActiveAppearancePreferences();

    let bar: string;
    if (animate && progress < 1) {
      bar = renderPulseText(
        PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(empty),
        `progress:${pct}`,
        'accent',
        appearance,
      );
    } else {
      bar = currentTheme.fg('accent', PROGRESS_FILLED.repeat(filled)) +
            currentTheme.dimFg('textMuted', PROGRESS_EMPTY.repeat(empty));
    }
    return `${bar} ${currentTheme.dimFg('textMuted', `${String(pct)}%`)}`;
  }

  /** Render a compact activity rate sparkline (last 30s in 10 buckets). */
  private renderActivitySparkline(now: number, width: number): string {
    if (width < 20) return ''; // Too narrow for sparkline
    const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
    const BUCKET_COUNT = 10;
    const BUCKET_MS = 3_000; // 3s per bucket = 30s window
    const entries = this.feed.getEntries();
    const buckets = new Array<number>(BUCKET_COUNT).fill(0);
    for (const entry of entries) {
      const age = now - entry.timestamp;
      if (age < 0 || age >= BUCKET_COUNT * BUCKET_MS) continue;
      const idx = BUCKET_COUNT - 1 - Math.floor(age / BUCKET_MS);
      if (idx >= 0 && idx < BUCKET_COUNT) buckets[idx] = (buckets[idx] ?? 0) + 1;
    }
    const max = Math.max(1, ...buckets);
    const spark = buckets.map((count) => {
      const level = Math.min(SPARK_CHARS.length - 1, Math.round((count / max) * (SPARK_CHARS.length - 1)));
      return SPARK_CHARS[level]!;
    }).join('');
    return ` ${currentTheme.dimFg('textMuted', spark)}`;
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
