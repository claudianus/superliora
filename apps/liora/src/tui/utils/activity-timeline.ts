/**
 * ActivityTimeline — visual timeline of agent actions for the TUI.
 *
 * Renders a compact, scrollable timeline showing:
 * - Tool calls (with duration bars)
 * - Thinking/reasoning phases
 * - File operations (read/write/edit)
 * - Errors and recoveries
 * - Compaction events
 * - User interactions
 *
 * The timeline uses a horizontal time axis with activity lanes,
 * similar to Chrome DevTools Performance tab but adapted for terminal.
 *
 * Features:
 * - Zoomable time axis (1s to 10min per screen width)
 * - Color-coded activity types
 * - Duration bars with proportional width
 * - Hover/selection for detail inspection
 * - Auto-scroll to follow live activity
 * - Compact mode for narrow terminals
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | 'tool-call'
  | 'thinking'
  | 'file-read'
  | 'file-write'
  | 'file-edit'
  | 'error'
  | 'recovery'
  | 'compaction'
  | 'user-input'
  | 'streaming'
  | 'approval'
  | 'network';

export interface TimelineEvent {
  readonly id: string;
  readonly type: TimelineEventType;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number | null; // null = in progress
  readonly detail?: string;
  readonly success?: boolean;
  /** Nested sub-events (e.g. tool call with sub-steps). */
  readonly children?: readonly TimelineEvent[];
}

export interface TimelineLane {
  readonly id: string;
  readonly label: string;
  readonly events: TimelineEvent[];
}

export interface TimelineViewState {
  /** Start of visible time window (ms since epoch). */
  readonly windowStartMs: number;
  /** End of visible time window. */
  readonly windowEndMs: number;
  /** Whether auto-scroll is enabled (follow live). */
  readonly autoScroll: boolean;
  /** Selected event id (for detail view). */
  readonly selectedEventId: string | null;
  /** Zoom level: ms per character column. */
  readonly msPerColumn: number;
}

export interface TimelineRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_GLYPH: Record<TimelineEventType, string> = {
  'tool-call': '⚙',
  'thinking': '◐',
  'file-read': '📖',
  'file-write': '✏',
  'file-edit': '✂',
  'error': '✗',
  'recovery': '↺',
  'compaction': '📦',
  'user-input': '⌨',
  'streaming': '▊',
  'approval': '⏳',
  'network': '🌐',
};

const EVENT_COLOR: Record<TimelineEventType, string> = {
  'tool-call': 'warning',
  'thinking': 'accent',
  'file-read': 'textMuted',
  'file-write': 'primary',
  'file-edit': 'primary',
  'error': 'error',
  'recovery': 'success',
  'compaction': 'textMuted',
  'user-input': 'text',
  'streaming': 'accent',
  'approval': 'warning',
  'network': 'textMuted',
};

const EVENT_BAR_CHAR: Record<TimelineEventType, string> = {
  'tool-call': '█',
  'thinking': '░',
  'file-read': '▒',
  'file-write': '█',
  'file-edit': '▓',
  'error': '✗',
  'recovery': '↺',
  'compaction': '▬',
  'user-input': '▏',
  'streaming': '▊',
  'approval': '◌',
  'network': '─',
};

/** Zoom presets: ms per column. */
const ZOOM_PRESETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

const LANE_LABEL_WIDTH = 12;
const MIN_BAR_WIDTH = 1;

// ---------------------------------------------------------------------------
// ActivityTimeline
// ---------------------------------------------------------------------------

export class ActivityTimeline {
  private events: TimelineEvent[] = [];
  private view: TimelineViewState;
  private readonly maxEvents: number;

  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
    const now = Date.now();
    this.view = {
      windowStartMs: now - 60000, // Last 60 seconds
      windowEndMs: now,
      autoScroll: true,
      selectedEventId: null,
      msPerColumn: 1000, // 1 second per column
    };
  }

  // ─── Event Management ─────────────────────────────────────────────

  /** Add a completed event. */
  addEvent(event: TimelineEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    if (this.view.autoScroll && event.endMs !== null) {
      this.scrollToEnd();
    }
  }

  /** Start an in-progress event. Returns the event id. */
  startEvent(type: TimelineEventType, label: string, detail?: string): string {
    const id = `evt-${String(this.events.length + 1)}-${String(Date.now())}`;
    this.events.push({
      id,
      type,
      label,
      startMs: Date.now(),
      endMs: null,
      detail,
    });
    if (this.view.autoScroll) {
      this.scrollToEnd();
    }
    return id;
  }

  /** Complete an in-progress event. */
  endEvent(id: string, success = true): void {
    const event = this.events.find((e) => e.id === id);
    if (event && event.endMs === null) {
      // Replace with completed version (immutable pattern)
      const idx = this.events.indexOf(event);
      this.events[idx] = { ...event, endMs: Date.now(), success };
    }
  }

  /** Get all events in the current time window. */
  getVisibleEvents(): TimelineEvent[] {
    return this.events.filter((e) => {
      const end = e.endMs ?? Date.now();
      return end >= this.view.windowStartMs && e.startMs <= this.view.windowEndMs;
    });
  }

  /** Get event by id. */
  getEvent(id: string): TimelineEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  get eventCount(): number {
    return this.events.length;
  }

  // ─── View Control ─────────────────────────────────────────────────

  get viewState(): TimelineViewState {
    return this.view;
  }

  /** Scroll the time window by a delta (ms). */
  scroll(deltaMs: number): void {
    const windowSize = this.view.windowEndMs - this.view.windowStartMs;
    this.view = {
      ...this.view,
      windowStartMs: this.view.windowStartMs + deltaMs,
      windowEndMs: this.view.windowEndMs + deltaMs,
      autoScroll: false,
    };
    void windowSize;
  }

  /** Scroll to show the latest events. */
  scrollToEnd(): void {
    const now = Date.now();
    const windowSize = this.view.windowEndMs - this.view.windowStartMs;
    this.view = {
      ...this.view,
      windowStartMs: now - windowSize,
      windowEndMs: now,
      autoScroll: true,
    };
  }

  /** Zoom in/out. Positive = zoom in (less time per column). */
  zoom(direction: 1 | -1): void {
    const currentIdx = ZOOM_PRESETS.findIndex((z) => z >= this.view.msPerColumn);
    const nextIdx = Math.max(0, Math.min(ZOOM_PRESETS.length - 1, currentIdx - direction));
    const newMsPerCol = ZOOM_PRESETS[nextIdx]!;

    // Keep center of window stable
    const center = (this.view.windowStartMs + this.view.windowEndMs) / 2;
    const halfWindow = (newMsPerCol * 80) / 2; // Assume ~80 columns

    this.view = {
      ...this.view,
      msPerColumn: newMsPerCol,
      windowStartMs: center - halfWindow,
      windowEndMs: center + halfWindow,
    };
  }

  /** Toggle auto-scroll. */
  toggleAutoScroll(): void {
    this.view = { ...this.view, autoScroll: !this.view.autoScroll };
    if (this.view.autoScroll) {
      this.scrollToEnd();
    }
  }

  /** Select an event for detail view. */
  selectEvent(id: string | null): void {
    this.view = { ...this.view, selectedEventId: id };
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render the timeline as an array of themed lines. */
  render(options: TimelineRenderOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];
    const now = Date.now();

    // Header: time axis
    lines.push(this.renderTimeAxis(width, fg, dimFg));

    // Group events into lanes by type
    const lanes = this.computeLanes();
    const availableHeight = height - 3; // Header + footer + separator
    const laneHeight = Math.max(1, Math.floor(availableHeight / Math.max(1, lanes.length)));

    for (const lane of lanes) {
      if (lines.length >= height - 1) break;

      // Lane label
      const label = lane.label.padEnd(LANE_LABEL_WIDTH).slice(0, LANE_LABEL_WIDTH);
      const laneEvents = lane.events.filter((e) => {
        const end = e.endMs ?? now;
        return end >= this.view.windowStartMs && e.startMs <= this.view.windowEndMs;
      });

      // Render event bars
      const barWidth = width - LANE_LABEL_WIDTH - 2;
      const bar = this.renderEventBar(laneEvents, barWidth, now, fg, bg);
      lines.push(`${dimFg('textMuted', label)} ${bar}`);

      // Extra rows for lane height > 1 (show labels)
      if (laneHeight > 1 && laneEvents.length > 0) {
        const labelLine = this.renderEventLabels(laneEvents, barWidth, now, dimFg);
        lines.push(`${' '.repeat(LANE_LABEL_WIDTH)} ${labelLine}`);
      }
    }

    // Fill remaining space
    while (lines.length < height - 1) {
      lines.push('');
    }

    // Footer: controls
    const autoLabel = this.view.autoScroll ? fg('success', '● LIVE') : dimFg('textMuted', '○ PAUSED');
    const zoomLabel = dimFg('textMuted', `${formatDuration(this.view.msPerColumn * width)}/screen`);
    lines.push(`${autoLabel} ${zoomLabel} ${dimFg('textMuted', ' ←/→:scroll +/-:zoom a:live')}`);

    return lines.slice(0, height);
  }

  /** Render the detail view for the selected event. */
  renderDetail(width: number, fg: (t: string, s: string) => string, dimFg: (t: string, s: string) => string): string[] {
    if (!this.view.selectedEventId) return [];
    const event = this.getEvent(this.view.selectedEventId);
    if (!event) return [];

    const lines: string[] = [];
    const glyph = EVENT_GLYPH[event.type];
    const color = EVENT_COLOR[event.type];

    lines.push(fg(color, `${glyph} ${event.label}`));
    lines.push(dimFg('textMuted', `  Type: ${event.type}`));
    lines.push(dimFg('textMuted', `  Start: ${new Date(event.startMs).toLocaleTimeString()}`));

    if (event.endMs !== null) {
      const duration = event.endMs - event.startMs;
      lines.push(dimFg('textMuted', `  Duration: ${formatDuration(duration)}`));
      lines.push(dimFg('textMuted', `  Status: ${event.success === false ? '✗ failed' : '✓ ok'}`));
    } else {
      lines.push(fg('accent', '  Status: running…'));
    }

    if (event.detail) {
      lines.push(dimFg('textMuted', `  Detail: ${truncate(event.detail, width - 10)}`));
    }

    return lines;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private computeLanes(): TimelineLane[] {
    const laneMap = new Map<string, TimelineEvent[]>();

    for (const event of this.events) {
      const laneId = laneForType(event.type);
      const lane = laneMap.get(laneId) ?? [];
      lane.push(event);
      laneMap.set(laneId, lane);
    }

    const laneOrder = ['compute', 'io', 'interaction', 'system'];
    const laneLabels: Record<string, string> = {
      compute: '⚙ Compute',
      io: '📁 I/O',
      interaction: '⌨ Input',
      system: '⚡ System',
    };

    return laneOrder
      .filter((id) => laneMap.has(id))
      .map((id) => ({
        id,
        label: laneLabels[id] ?? id,
        events: laneMap.get(id) ?? [],
      }));
  }

  private renderTimeAxis(
    width: number,
    fg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string {
    const windowSize = this.view.windowEndMs - this.view.windowStartMs;
    const tickInterval = niceTickInterval(windowSize, width);
    const ticks: string[] = [];

    let t = Math.ceil(this.view.windowStartMs / tickInterval) * tickInterval;
    while (t <= this.view.windowEndMs) {
      const col = Math.floor(((t - this.view.windowStartMs) / windowSize) * width);
      const label = formatTimeTick(t);
      ticks.push(`${' '.repeat(Math.max(0, col - ticks.join('').length))}${dimFg('textMuted', label)}`);
      t += tickInterval;
    }

    const axis = ticks.join('').slice(0, width);
    return fg('textMuted', '─'.repeat(width)) + '\n' + axis.padEnd(width);
  }

  private renderEventBar(
    events: TimelineEvent[],
    width: number,
    now: number,
    fg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string {
    const windowSize = this.view.windowEndMs - this.view.windowStartMs;
    const chars = new Array<string>(width).fill(' ');

    for (const event of events) {
      const end = event.endMs ?? now;
      const startCol = Math.floor(((event.startMs - this.view.windowStartMs) / windowSize) * width);
      const endCol = Math.floor(((end - this.view.windowStartMs) / windowSize) * width);
      const colStart = Math.max(0, startCol);
      const colEnd = Math.min(width - 1, endCol);

      if (colEnd < colStart) continue;

      const barChar = EVENT_BAR_CHAR[event.type];
      const color = EVENT_COLOR[event.type];
      const isSelected = event.id === this.view.selectedEventId;

      for (let col = colStart; col <= colEnd; col++) {
        const text = barChar;
        chars[col] = isSelected ? bg('primary', text) : fg(color, text);
      }
    }

    return chars.join('');
  }

  private renderEventLabels(
    events: TimelineEvent[],
    width: number,
    now: number,
    dimFg: (t: string, s: string) => string,
  ): string {
    const windowSize = this.view.windowEndMs - this.view.windowStartMs;
    const chars = new Array<string>(width).fill(' ');

    for (const event of events) {
      const startCol = Math.floor(((event.startMs - this.view.windowStartMs) / windowSize) * width);
      if (startCol >= 0 && startCol < width - 3) {
        const label = truncate(event.label, Math.min(20, width - startCol));
        for (let i = 0; i < label.length && startCol + i < width; i++) {
          chars[startCol + i] = dimFg('textMuted', label[i]!);
        }
      }
    }

    return chars.join('');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function laneForType(type: TimelineEventType): string {
  switch (type) {
    case 'tool-call':
    case 'thinking':
    case 'streaming':
      return 'compute';
    case 'file-read':
    case 'file-write':
    case 'file-edit':
      return 'io';
    case 'user-input':
    case 'approval':
      return 'interaction';
    case 'error':
    case 'recovery':
    case 'compaction':
    case 'network':
      return 'system';
  }
}

function niceTickInterval(windowMs: number, width: number): number {
  const targetTicks = Math.floor(width / 12); // ~12 chars per tick label
  const rawInterval = windowMs / Math.max(1, targetTicks);

  // Round to nice intervals
  const niceIntervals = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  for (const nice of niceIntervals) {
    if (nice >= rawInterval) return nice;
  }
  return 600000; // 10 minutes
}

function formatTimeTick(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(Math.floor(seconds % 60))}s`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}
