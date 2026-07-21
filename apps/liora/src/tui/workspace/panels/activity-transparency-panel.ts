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
// Event grouping
// ---------------------------------------------------------------------------

/** Time window (ms) within which consecutive same-kind events are grouped. */
const GROUP_WINDOW_MS = 2_000;
/** Minimum consecutive events of the same kind before grouping kicks in. */
const GROUP_THRESHOLD = 3;

interface ActivityGroup {
  readonly kind: ActivityKind;
  readonly entries: readonly ActivityEntry[];
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
}

/**
 * Group consecutive same-kind entries that occur within GROUP_WINDOW_MS.
 * Returns a mixed array of individual entries and groups.
 */
function groupEntries(entries: readonly ActivityEntry[]): Array<ActivityEntry | ActivityGroup> {
  if (entries.length < GROUP_THRESHOLD) return [...entries];

  const result: Array<ActivityEntry | ActivityGroup> = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i]!;
    // Only group "noisy" kinds that benefit from collapsing
    const groupable = entry.kind === 'file-read' || entry.kind === 'file-write' ||
      entry.kind === 'tool-result' || entry.kind === 'info';

    if (!groupable) {
      result.push(entry);
      i++;
      continue;
    }

    // Collect consecutive same-kind entries within the time window
    const group: ActivityEntry[] = [entry];
    let j = i + 1;
    while (j < entries.length) {
      const next = entries[j]!;
      if (next.kind !== entry.kind) break;
      if (next.timestamp - (group[group.length - 1]?.timestamp ?? 0) > GROUP_WINDOW_MS) break;
      group.push(next);
      j++;
    }

    if (group.length >= GROUP_THRESHOLD) {
      result.push({
        kind: entry.kind,
        entries: group,
        firstTimestamp: group[0]!.timestamp,
        lastTimestamp: group[group.length - 1]!.timestamp,
      });
    } else {
      for (const e of group) result.push(e);
    }
    i = j;
  }

  return result;
}

function isGroup(item: ActivityEntry | ActivityGroup): item is ActivityGroup {
  return 'entries' in item;
}

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
  /** Set of expanded group indices (by first entry id). */
  private expandedGroups = new Set<string>();
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
    const errorCount = entries.filter((e) => e.isError).length;
    const filterLabel = this.filterKind !== null ? ` ${this.filterKind}` : '';
    const grouped = groupEntries(entries);
    // Uptime: time since first entry
    const firstTs = entries.length > 0 ? entries[0]!.timestamp : now;
    const uptimeSec = Math.floor((now - firstTs) / 1000);
    const uptimeLabel = uptimeSec >= 60 ? `${String(Math.floor(uptimeSec / 60))}m${String(uptimeSec % 60)}s` : `${String(uptimeSec)}s`;
    let headerText = `${String(entries.length)} events${filterLabel} · ${uptimeLabel}`;
    if (activeCount > 0) {
      headerText += ` · ${String(activeCount)} active`;
    }
    if (errorCount > 0) {
      headerText += ` · ${String(errorCount)} err`;
    }
    // Completion rate: percentage of entries that have finished
    const completedCount = entries.filter((e) => e.durationMs !== undefined).length;
    const completionRate = entries.length > 0 ? Math.round((completedCount / entries.length) * 100) : 0;
    if (entries.length > 0 && completionRate < 100) {
      headerText += ` · ${String(completionRate)}%✓`;
    }
    // Tool success rate: ratio of successful completions to total completed
    const toolResults = entries.filter((e) => e.kind === 'tool-result' || e.kind === 'tool-error');
    if (toolResults.length > 0) {
      const successes = toolResults.filter((e) => !e.isError).length;
      const successRate = Math.round((successes / toolResults.length) * 100);
      if (successRate < 100) {
        headerText += ` · ${String(successRate)}%ok`;
      }
    }
    // Activity rate sparkline (last 30s, 10 buckets)
    const sparkline = this.renderActivitySparkline(now, width);
    // Rate-of-change indicator (events/sec over last 5s)
    const rateIndicator = this.renderRateIndicator(now);
    // Burst detection: flag when rate is significantly above average
    const recentCount = entries.filter((e) => now - e.timestamp < 5000).length;
    const avgRate = entries.length > 0 ? entries.length / Math.max(1, (now - (entries[0]?.timestamp ?? now)) / 1000) : 0;
    const currentRate = recentCount / 5;
    const burstIndicator = currentRate > avgRate * 3 && currentRate > 2
      ? ` ${currentTheme.fg('warning', '⚡burst')}`
      : '';
    if (animate && activeCount > 0) {
      const headerStyled = errorCount > 0
        ? renderPulseText(headerText, 'activity-header', 'error', appearance)
        : renderPulseText(headerText, 'activity-header', 'primary', appearance);
      lines.push(this.pad(` ${headerStyled}${sparkline}${rateIndicator}${burstIndicator}`, width));
    } else {
      const headerToken = errorCount > 0 ? 'error' : 'primary';
      lines.push(this.pad(` ${currentTheme.boldFg(headerToken, headerText)}${sparkline}${rateIndicator}${burstIndicator}`, width));
    }

    // Filter chip row (visible when focused, compact single-row chips)
    if (focused && height > 5) {
      lines.push(this.pad(this.renderFilterChips(width), width));
    }

    // Session timeline bar (compact horizontal density map)
    if (height > 6 && entries.length > 0) {
      lines.push(this.pad(this.renderSessionTimeline(now, width), width));
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

    // Error summary row: show latest error when errors exist
    if (errorCount > 0 && height > 5) {
      const latestError = [...entries].reverse().find((e) => e.isError);
      if (latestError) {
        const errText = `✗ ${latestError.label}`;
        const errLine = animate
          ? renderPulseText(errText, 'error-summary', 'error', appearance)
          : currentTheme.boldFg('error', errText);
        lines.push(this.pad(` ${errLine}`, width));
      }
    }

    // Clamp scroll
    const headerRows = focused && height > 5 ? 2 : 1; // header + optional filter chips
    const visibleRows = height - headerRows - (activeCount > 0 && height > 4 ? 1 : 0) - 1; // spotlight + hint
    const maxScroll = Math.max(0, grouped.length - visibleRows);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    // Render visible entries (newest at bottom)
    const end = Math.min(grouped.length, this.scrollTop + visibleRows);
    for (let i = this.scrollTop; i < end; i++) {
      const item = grouped[i]!;
      if (isGroup(item)) {
        const groupKey = item.entries[0]?.id ?? `g${String(i)}`;
        const expanded = this.expandedGroups.has(groupKey);
        if (expanded) {
          // Render each entry in the group
          for (const entry of item.entries) {
            let line = this.formatEntry(entry, width, now, animate);
            if (searchQuery && searchQuery.length > 0) {
              line = this.highlightSearch(line, searchQuery);
            }
            lines.push(line);
          }
        } else {
          // Render collapsed group summary
          let line = this.formatGroupRow(item, width, now, animate);
          if (searchQuery && searchQuery.length > 0) {
            line = this.highlightSearch(line, searchQuery);
          }
          lines.push(line);
        }
      } else {
        let line = this.formatEntry(item, width, now, animate);
        if (searchQuery && searchQuery.length > 0) {
          line = this.highlightSearch(line, searchQuery);
        }
        lines.push(line);
      }
    }

    // Hint bar
    let hint: string;
    if (focused) {
      // Show scroll position when scrolled away from bottom
      const scrollPct = maxScroll > 0 ? Math.round((this.scrollTop / maxScroll) * 100) : 100;
      const scrollInfo = scrollPct < 100 ? ` ${currentTheme.fg('accent', `${String(scrollPct)}%`)}` : '';
      // Duration histogram (compact, shows distribution of completed ops)
      const histogram = this.renderDurationHistogram(width);
      if (histogram.length > 0 && height > 8) {
        lines.push(this.pad(histogram, width));
      }
      // Kind distribution bar (compact proportional segments)
      const kindBar = this.renderKindDistribution(width);
      if (kindBar.length > 0 && height > 10) {
        lines.push(this.pad(kindBar, width));
      }
      // Slowest operation indicator
      const slowest = this.findSlowestEntry(entries);
      if (slowest !== null && height > 12) {
        const slowLabel = `slowest: ${slowest.label.slice(0, 20)} ${formatDuration(slowest.durationMs!)}`;
        lines.push(this.pad(` ${currentTheme.fg('warning', '🐢')} ${currentTheme.dimFg('textMuted', slowLabel)}`, width));
      }
      // Error category breakdown (when errors exist)
      const errorEntries = entries.filter((e) => e.isError);
      if (errorEntries.length > 0 && height > 13) {
        const catCounts = new Map<string, number>();
        for (const e of errorEntries) {
          const cat = e.kind.replace(/-/g, ' ');
          catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        }
        const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        const catSummary = topCats.map(([cat, count]) => `${cat}×${String(count)}`).join(' ');
        lines.push(this.pad(` ${currentTheme.fg('error', '✗')} ${currentTheme.dimFg('textMuted', catSummary)}`, width));
      }
      // Peak activity time (busiest 10s window in the session)
      if (entries.length > 10 && height > 14) {
        const WINDOW = 10_000;
        let peakCount = 0;
        let peakStart = 0;
        for (let i = 0; i < entries.length; i++) {
          const windowEnd = entries[i]!.timestamp + WINDOW;
          let count = 0;
          for (let j = i; j < entries.length && entries[j]!.timestamp <= windowEnd; j++) count++;
          if (count > peakCount) {
            peakCount = count;
            peakStart = entries[i]!.timestamp;
          }
        }
        if (peakCount > 5) {
          const peakTime = new Date(peakStart);
          const peakLabel = `${String(peakTime.getHours()).padStart(2, '0')}:${String(peakTime.getMinutes()).padStart(2, '0')}`;
          lines.push(this.pad(` ${currentTheme.fg('accent', '⚡')} ${currentTheme.dimFg('textMuted', `peak ${peakLabel} (${String(peakCount)} ops/10s)`)}`, width));
        }
      }
      // Throughput mini-graph (ops per 5s window, last 6 windows)
      if (entries.length > 5 && height > 15) {
        const T_WINDOW = 5_000;
        const T_BUCKETS = 6;
        const tBuckets = new Array<number>(T_BUCKETS).fill(0);
        for (const e of entries) {
          const age = now - e.timestamp;
          if (age < 0 || age >= T_BUCKETS * T_WINDOW) continue;
          const idx = T_BUCKETS - 1 - Math.floor(age / T_WINDOW);
          if (idx >= 0 && idx < T_BUCKETS) tBuckets[idx] = (tBuckets[idx] ?? 0) + 1;
        }
        const tMax = Math.max(1, ...tBuckets);
        const GRAPH_W = Math.min(20, width - 8);
        const tGraph = tBuckets.map((count) => {
          const barLen = Math.round((count / tMax) * GRAPH_W);
          return currentTheme.fg('primary', '▓'.repeat(barLen)) + currentTheme.dimFg('border', '░'.repeat(GRAPH_W - barLen));
        });
        // Show as compact vertical bars (one row per bucket, newest at bottom)
        const tLabel = currentTheme.dimFg('textMuted', 'thru');
        lines.push(this.pad(` ${tLabel} ${tGraph[tGraph.length - 1] ?? ''}`, width));
      }
      hint = currentTheme.dimFg('textMuted', ' j/k c:clr f:filter a:auto e:exp') + scrollInfo;
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
      // Mouse click on filter chip row (row index 1 when focused)
      if (event.action === 'press' && event.button === 'left') {
        // Filter chips are on the second row (y offset 1 within the panel)
        if (event.y === 1) {
          const chipKinds: Array<ActivityKind | null> = [null, 'tool-start', 'thinking', 'file-read', 'file-write', 'command', 'agent-spawn'];
          // Approximate chip positions: each chip is ~7 chars wide + 1 separator
          const chipWidth = 8;
          const chipIndex = Math.floor((event.x - 1) / chipWidth);
          if (chipIndex >= 0 && chipIndex < chipKinds.length) {
            this.filterKind = chipKinds[chipIndex]!;
            this.scrollTop = 0;
            return true;
          }
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
      if (ch === 'e') {
        // Toggle expand/collapse for the group at the current scroll position
        this.toggleGroupAtCursor();
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

  /** Find the slowest completed entry for the slowest-op indicator. */
  private findSlowestEntry(entries: readonly ActivityEntry[]): ActivityEntry | null {
    let slowest: ActivityEntry | null = null;
    for (const e of entries) {
      if (e.durationMs !== undefined && e.durationMs > 0) {
        if (slowest === null || e.durationMs > (slowest.durationMs ?? 0)) {
          slowest = e;
        }
      }
    }
    // Only show if slowest is notably slow (>2s)
    return slowest !== null && (slowest.durationMs ?? 0) > 2000 ? slowest : null;
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

  /** Render a compact row of filter chips showing available kinds. */
  private renderFilterChips(width: number): string {
    const chips: Array<{ kind: ActivityKind | null; label: string; token: ColorToken }> = [
      { kind: null, label: 'all', token: 'textDim' },
      { kind: 'tool-start', label: '⚡tool', token: 'primary' },
      { kind: 'thinking', label: '◌think', token: 'warning' },
      { kind: 'file-read', label: '📖read', token: 'textDim' },
      { kind: 'file-write', label: '✏write', token: 'accent' },
      { kind: 'command', label: '▶cmd', token: 'primary' },
      { kind: 'agent-spawn', label: '⑂agent', token: 'particle' },
    ];

    const parts: string[] = [];
    for (const chip of chips) {
      const isActive = this.filterKind === chip.kind;
      if (isActive) {
        parts.push(currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ${chip.label} `)));
      } else {
        parts.push(currentTheme.dimFg('textMuted', ` ${chip.label} `));
      }
    }
    const row = parts.join(currentTheme.dimFg('border', '·'));
    // Truncate if too wide
    const visible = row.replace(/\x1b\[[0-9;]*m/g, '');
    if (visible.length > width) {
      return ` ${parts.slice(0, 4).join(currentTheme.dimFg('border', '·'))}`;
    }
    return ` ${row}`;
  }

  private scrollToBottom(): void {
    const entries = this.getFilteredEntries();
    this.scrollTop = Math.max(0, entries.length - 20);
    this.autoScroll = true;
  }

  private checkAutoScroll(): void {
    const entries = this.getFilteredEntries();
    const grouped = groupEntries(entries);
    const visibleRows = 20;
    if (this.scrollTop >= grouped.length - visibleRows) {
      this.autoScroll = true;
    }
  }

  /** Toggle expand/collapse for the group at the current cursor/scroll position. */
  private toggleGroupAtCursor(): void {
    const entries = this.getFilteredEntries();
    const grouped = groupEntries(entries);
    const item = grouped[this.scrollTop];
    if (item === undefined || !isGroup(item)) return;
    const groupKey = item.entries[0]?.id ?? '';
    if (this.expandedGroups.has(groupKey)) {
      this.expandedGroups.delete(groupKey);
    } else {
      this.expandedGroups.add(groupKey);
    }
  }

  /** Format a collapsed group row. */
  private formatGroupRow(group: ActivityGroup, width: number, now: number, animate: boolean): string {
    const icon = KIND_ICONS[group.kind] ?? '·';
    const token = KIND_TOKENS[group.kind] ?? 'textDim';
    const time = formatTime(group.firstTimestamp);
    const count = group.entries.length;
    const timePart = currentTheme.dimFg('textMuted', time);
    const iconPart = currentTheme.fg(token, icon);
    const countBadge = currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ×${String(count)} `));
    const label = `${iconPart} ${currentTheme.fg(token, group.kind.replace(/-/g, ' '))} ${countBadge}`;
    const expandHint = currentTheme.dimFg('textMuted', ' [e]');
    return this.pad(`${timePart} ${label}${expandHint}`, width);
  }

  private formatEntry(entry: ActivityEntry, width: number, now: number, animate: boolean): string {
    const icon = KIND_ICONS[entry.kind] ?? '·';
    const token = KIND_TOKENS[entry.kind] ?? 'textDim';
    const time = formatTime(entry.timestamp);

    // Subagent entries get a tree connector prefix for visual nesting
    const isSubagent = entry.kind === 'agent-spawn' || entry.kind === 'agent-done' || entry.kind === 'agent-progress';
    const treePrefix = isSubagent ? currentTheme.dimFg('border', '├─') : '';

    // Tool call chain depth: show nesting level for consecutive tool operations
    const isToolOp = entry.kind === 'tool-start' || entry.kind === 'tool-progress' || entry.kind === 'tool-result' || entry.kind === 'tool-error';
    let chainPrefix = '';
    if (isToolOp) {
      // Count how many tool-start entries precede this one without a non-tool entry between
      const entries = this.feed.getEntries();
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx > 0) {
        let depth = 0;
        for (let i = idx - 1; i >= 0 && i >= idx - 5; i--) {
          const prev = entries[i];
          if (prev && (prev.kind === 'tool-start' || prev.kind === 'tool-progress')) depth++;
          else break;
        }
        if (depth > 0) {
          chainPrefix = currentTheme.dimFg('border', '│'.repeat(Math.min(depth, 3)) + ' ');
        }
      }
    }

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
      labelPart = currentTheme.boldFg('error', `✗ ${label}`);
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
      detailPart = entry.isError
        ? currentTheme.fg('error', truncate(entry.detail, detailMax))
        : currentTheme.dimFg('textMuted', truncate(entry.detail, detailMax));
    }

    const mainLine = entry.isError
      ? `${timePart} ${chainPrefix}${treePrefix}${iconPart} ${labelPart}${trailing} ${currentTheme.dimFg('error', '⚠')}`
      : `${timePart} ${chainPrefix}${treePrefix}${iconPart} ${labelPart}${trailing}`;
    return this.pad(mainLine, width);
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

  /** Render a compact rate-of-change indicator (events/sec over last 5s). */
  private renderRateIndicator(now: number): string {
    const entries = this.feed.getEntries();
    const WINDOW_MS = 5_000;
    const recentCount = entries.filter((e) => now - e.timestamp < WINDOW_MS).length;
    const rate = recentCount / (WINDOW_MS / 1000);
    if (rate === 0) return '';
    // Arrow indicator: ↑ high rate, → moderate, ↓ low
    const arrow = rate > 3 ? '↑' : rate > 1 ? '→' : '↓';
    const token = rate > 3 ? 'accent' : rate > 1 ? 'primary' : 'textDim';
    return ` ${currentTheme.fg(token, `${arrow}${rate.toFixed(1)}/s`)}`;
  }

  /**
   * Render a compact session-wide timeline bar showing event density
   * across the entire session duration. Uses block characters with
   * theme-colored segments for different activity kinds.
   */
  /**
   * Render a compact duration histogram showing distribution of completed
   * operation durations. Buckets: <100ms, <500ms, <1s, <5s, <30s, >30s.
   */
  /**
   * Render a compact kind distribution bar showing proportional segments
   * for each activity kind present in the feed.
   */
  private renderKindDistribution(width: number): string {
    const entries = this.feed.getEntries();
    if (entries.length < 5) return '';

    const BAR_W = Math.min(width - 2, 30);
    const counts = new Map<ActivityKind, number>();
    for (const e of entries) {
      counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    }

    // Sort by count descending, take top kinds
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.length;
    const parts: string[] = [];
    let usedWidth = 0;

    for (const [kind, count] of sorted) {
      const segWidth = Math.max(1, Math.round((count / total) * BAR_W));
      if (usedWidth + segWidth > BAR_W) break;
      const token = KIND_TOKENS[kind] ?? 'textDim';
      parts.push(currentTheme.fg(token, '▓'.repeat(segWidth)));
      usedWidth += segWidth;
    }

    // Fill remaining
    if (usedWidth < BAR_W) {
      parts.push(currentTheme.dimFg('border', '░'.repeat(BAR_W - usedWidth)));
    }

    return ` ${parts.join('')}`;
  }

  private renderDurationHistogram(width: number): string {
    const entries = this.feed.getEntries();
    const completed = entries.filter((e) => e.durationMs !== undefined);
    if (completed.length < 3) return ''; // Not enough data

    // Compute median duration
    const durations = completed.map((e) => e.durationMs!).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] ?? 0;
    const medianLabel = median < 1000 ? `${String(median)}ms` : `${(median / 1000).toFixed(1)}s`;

    const BUCKETS = [100, 500, 1000, 5000, 30000, Infinity] as const;
    const LABELS = ['<.1s', '<.5s', '<1s', '<5s', '<30s', '>30s'] as const;
    const counts = new Array<number>(BUCKETS.length).fill(0);

    for (const entry of completed) {
      const ms = entry.durationMs!;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (ms < BUCKETS[i]!) {
          counts[i] = (counts[i] ?? 0) + 1;
          break;
        }
      }
    }

    const max = Math.max(1, ...counts);
    const BAR_H = 3; // 3-row mini histogram
    const parts: string[] = [];
    for (let i = 0; i < BUCKETS.length; i++) {
      const count = counts[i] ?? 0;
      const level = Math.round((count / max) * BAR_H);
      const bar = level > 0 ? currentTheme.fg('accent', '█'.repeat(level)) : currentTheme.dimFg('border', '░');
      parts.push(`${bar}${currentTheme.dimFg('textMuted', LABELS[i]!)}`);
    }
    return ` ${parts.join(' ')} ${currentTheme.dimFg('textMuted', `x̃${medianLabel}`)}`;
  }

  private renderSessionTimeline(now: number, width: number): string {
    const entries = this.feed.getEntries();
    if (entries.length === 0) return '';

    const BAR_WIDTH = Math.min(width - 2, 40);
    if (BAR_WIDTH < 8) return '';

    const firstTs = entries[0]?.timestamp ?? now;
    const duration = Math.max(1, now - firstTs);
    const buckets = new Array<number>(BAR_WIDTH).fill(0);

    for (const entry of entries) {
      const age = entry.timestamp - firstTs;
      const idx = Math.min(BAR_WIDTH - 1, Math.floor((age / duration) * BAR_WIDTH));
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }

    const max = Math.max(1, ...buckets);
    const DENSITY_CHARS = ['░', '▒', '▓', '█'] as const;

    const bar = buckets.map((count) => {
      if (count === 0) return currentTheme.dimFg('border', '·');
      const level = Math.min(DENSITY_CHARS.length - 1, Math.ceil((count / max) * DENSITY_CHARS.length) - 1);
      return currentTheme.fg('primary', DENSITY_CHARS[level]!);
    }).join('');

    // Current position marker (rightmost = now)
    return ` ${bar}`;
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
