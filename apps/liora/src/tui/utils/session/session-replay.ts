/**
 * SessionReplay — time-travel debugging for agent sessions.
 *
 * Records and replays agent sessions for debugging and review:
 * - Records all events (messages, tool calls, state changes)
 * - Playback with variable speed (0.5x, 1x, 2x, 4x, max)
 * - Step-by-step execution (next event, next tool call, next message)
 * - Seek to any point in time
 * - Event filtering (show only tool calls, only errors, etc.)
 * - State snapshots at key points
 * - Export to JSON for offline analysis
 *
 * Use cases:
 * - Debug agent behavior after the fact
 * - Review agent decisions during code review
 * - Train new team members on agent workflows
 * - Identify patterns in agent failures
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayEventType =
  | 'message'
  | 'tool-call'
  | 'tool-result'
  | 'state-change'
  | 'error'
  | 'user-input'
  | 'compaction'
  | 'approval'
  | 'streaming-start'
  | 'streaming-end';

export interface ReplayEvent {
  readonly id: string;
  readonly type: ReplayEventType;
  readonly timestamp: number;
  readonly data: ReplayEventData;
  /** Duration for events that span time (tool calls, streaming). */
  readonly durationMs?: number;
}

export type ReplayEventData =
  | MessageEventData
  | ToolCallEventData
  | ToolResultEventData
  | StateChangeEventData
  | ErrorEventData
  | UserInputEventData
  | CompactionEventData
  | ApprovalEventData
  | StreamingEventData;

export interface MessageEventData {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly tokens?: number;
}

export interface ToolCallEventData {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly callId: string;
}

export interface ToolResultEventData {
  readonly callId: string;
  readonly result: string;
  readonly isError: boolean;
}

export interface StateChangeEventData {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

export interface ErrorEventData {
  readonly code: string;
  readonly message: string;
  readonly stack?: string;
}

export interface UserInputEventData {
  readonly input: string;
  readonly source: 'keyboard' | 'paste' | 'command';
}

export interface CompactionEventData {
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly reason: string;
}

export interface ApprovalEventData {
  readonly toolName: string;
  readonly approved: boolean;
  readonly waitedMs: number;
}

export interface StreamingEventData {
  readonly model: string;
  readonly tokensPerSecond?: number;
}

export interface ReplayState {
  readonly isPlaying: boolean;
  readonly speed: number;
  readonly currentIndex: number;
  readonly currentTimeMs: number;
  readonly totalEvents: number;
  readonly totalDurationMs: number;
  readonly filters: ReadonlySet<ReplayEventType>;
}

export interface ReplayMarker {
  readonly id: string;
  readonly eventIndex: number;
  readonly label: string;
  readonly color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8, 0]; // 0 = max speed

const EVENT_GLYPH: Record<ReplayEventType, string> = {
  'message': '💬',
  'tool-call': '⚙',
  'tool-result': '✓',
  'state-change': '🔄',
  'error': '✗',
  'user-input': '⌨',
  'compaction': '📦',
  'approval': '⏳',
  'streaming-start': '▶',
  'streaming-end': '⏹',
};

const EVENT_COLOR: Record<ReplayEventType, string> = {
  'message': 'text',
  'tool-call': 'warning',
  'tool-result': 'success',
  'state-change': 'textMuted',
  'error': 'error',
  'user-input': 'accent',
  'compaction': 'textMuted',
  'approval': 'warning',
  'streaming-start': 'accent',
  'streaming-end': 'textMuted',
};

// ---------------------------------------------------------------------------
// SessionRecorder
// ---------------------------------------------------------------------------

export class SessionRecorder {
  private events: ReplayEvent[] = [];
  private eventCounter = 0;
  private startTimeMs = 0;
  private recording = false;

  /** Start recording a session. */
  start(): void {
    this.events = [];
    this.eventCounter = 0;
    this.startTimeMs = Date.now();
    this.recording = true;
  }

  /** Stop recording. */
  stop(): void {
    this.recording = false;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  /** Record an event. */
  record(type: ReplayEventType, data: ReplayEventData, durationMs?: number): string {
    if (!this.recording) return '';

    const id = `evt-${String(++this.eventCounter)}`;
    this.events.push({
      id,
      type,
      timestamp: Date.now(),
      data,
      durationMs,
    });
    return id;
  }

  /** Record a message event. */
  recordMessage(role: 'user' | 'assistant' | 'system', content: string, tokens?: number): string {
    return this.record('message', { role, content, tokens });
  }

  /** Record a tool call event. */
  recordToolCall(toolName: string, args: Record<string, unknown>, callId: string): string {
    return this.record('tool-call', { toolName, args, callId });
  }

  /** Record a tool result event. */
  recordToolResult(callId: string, result: string, isError: boolean): string {
    return this.record('tool-result', { callId, result, isError });
  }

  /** Record an error event. */
  recordError(code: string, message: string, stack?: string): string {
    return this.record('error', { code, message, stack });
  }

  /** Record user input. */
  recordUserInput(input: string, source: 'keyboard' | 'paste' | 'command' = 'keyboard'): string {
    return this.record('user-input', { input, source });
  }

  /** Get all recorded events. */
  getEvents(): readonly ReplayEvent[] {
    return this.events;
  }

  /** Export recording to JSON. */
  export(): string {
    return JSON.stringify({
      version: 1,
      startTimeMs: this.startTimeMs,
      events: this.events,
    }, null, 2);
  }

  /** Get recording statistics. */
  getStats(): {
    totalEvents: number;
    durationMs: number;
    eventsByType: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;
    }
    return {
      totalEvents: this.events.length,
      durationMs: this.events.length > 0
        ? this.events[this.events.length - 1]!.timestamp - this.startTimeMs
        : 0,
      eventsByType,
    };
  }

  get eventCount(): number {
    return this.events.length;
  }
}

// ---------------------------------------------------------------------------
// SessionReplay
// ---------------------------------------------------------------------------

export class SessionReplay {
  private events: ReplayEvent[] = [];
  private currentIndex = 0;
  private isPlaying = false;
  private speed = 1;
  private filters: Set<ReplayEventType> = new Set();
  private markers: ReplayMarker[] = [];
  private startTimeMs = 0;
  private playbackStartMs = 0;

  /** Load events for replay. */
  load(events: readonly ReplayEvent[]): void {
    this.events = [...events];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.startTimeMs = events.length > 0 ? events[0]!.timestamp : 0;
    this.playbackStartMs = Date.now();
  }

  /** Load from exported JSON. */
  loadFromJson(json: string): void {
    try {
      const data = JSON.parse(json) as { events: ReplayEvent[] };
      this.load(data.events);
    } catch {
      // Ignore invalid JSON
    }
  }

  // ─── Playback Control ─────────────────────────────────────────────

  /** Start or resume playback. */
  play(): void {
    if (this.events.length === 0) return;
    this.isPlaying = true;
    this.playbackStartMs = Date.now();
  }

  /** Pause playback. */
  pause(): void {
    this.isPlaying = false;
  }

  /** Toggle play/pause. */
  togglePlay(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Stop and reset to beginning. */
  stop(): void {
    this.isPlaying = false;
    this.currentIndex = 0;
  }

  /** Step to next event. */
  stepForward(): ReplayEvent | null {
    if (this.currentIndex < this.events.length - 1) {
      this.currentIndex++;
      return this.currentEvent;
    }
    return null;
  }

  /** Step to previous event. */
  stepBackward(): ReplayEvent | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.currentEvent;
    }
    return null;
  }

  /** Step to next event of a specific type. */
  stepToType(type: ReplayEventType): ReplayEvent | null {
    for (let i = this.currentIndex + 1; i < this.events.length; i++) {
      if (this.events[i]!.type === type) {
        this.currentIndex = i;
        return this.currentEvent;
      }
    }
    return null;
  }

  /** Step to next tool call. */
  stepToToolCall(): ReplayEvent | null {
    return this.stepToType('tool-call');
  }

  /** Step to next error. */
  stepToError(): ReplayEvent | null {
    return this.stepToType('error');
  }

  /** Seek to a specific event index. */
  seekTo(index: number): void {
    this.currentIndex = Math.max(0, Math.min(this.events.length - 1, index));
  }

  /** Seek to a specific time offset (ms from start). */
  seekToTime(offsetMs: number): void {
    const targetTime = this.startTimeMs + offsetMs;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i]!.timestamp >= targetTime) {
        this.currentIndex = i;
        return;
      }
    }
    this.currentIndex = this.events.length - 1;
  }

  /** Seek to a percentage of the total duration. */
  seekToPercent(percent: number): void {
    const totalMs = this.totalDurationMs;
    this.seekToTime(totalMs * (percent / 100));
  }

  // ─── Speed Control ────────────────────────────────────────────────

  /** Set playback speed. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Cycle through speed options. */
  cycleSpeed(): void {
    const idx = SPEED_OPTIONS.indexOf(this.speed);
    const nextIdx = (idx + 1) % SPEED_OPTIONS.length;
    this.speed = SPEED_OPTIONS[nextIdx]!;
  }

  get currentSpeed(): number {
    return this.speed;
  }

  // ─── Filtering ────────────────────────────────────────────────────

  /** Toggle filter for an event type. */
  toggleFilter(type: ReplayEventType): void {
    if (this.filters.has(type)) {
      this.filters.delete(type);
    } else {
      this.filters.add(type);
    }
  }

  /** Clear all filters (show everything). */
  clearFilters(): void {
    this.filters.clear();
  }

  /** Set filters to show only specific types. */
  setFilters(types: readonly ReplayEventType[]): void {
    this.filters = new Set(types);
  }

  /** Get filtered events. */
  getFilteredEvents(): ReplayEvent[] {
    if (this.filters.size === 0) return this.events;
    return this.events.filter((e) => this.filters.has(e.type));
  }

  // ─── Markers ──────────────────────────────────────────────────────

  /** Add a marker at the current position. */
  addMarker(label: string, color: string = 'accent'): void {
    this.markers.push({
      id: `marker-${String(this.markers.length + 1)}`,
      eventIndex: this.currentIndex,
      label,
      color,
    });
  }

  /** Remove a marker. */
  removeMarker(id: string): void {
    this.markers = this.markers.filter((m) => m.id !== id);
  }

  /** Get all markers. */
  getMarkers(): readonly ReplayMarker[] {
    return this.markers;
  }

  /** Jump to next marker. */
  jumpToNextMarker(): void {
    const next = this.markers.find((m) => m.eventIndex > this.currentIndex);
    if (next) {
      this.currentIndex = next.eventIndex;
    }
  }

  /** Jump to previous marker. */
  jumpToPrevMarker(): void {
    const prev = [...this.markers].reverse().find((m) => m.eventIndex < this.currentIndex);
    if (prev) {
      this.currentIndex = prev.eventIndex;
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────

  get currentEvent(): ReplayEvent | null {
    return this.events[this.currentIndex] ?? null;
  }

  get state(): ReplayState {
    return {
      isPlaying: this.isPlaying,
      speed: this.speed,
      currentIndex: this.currentIndex,
      currentTimeMs: this.currentTimeMs,
      totalEvents: this.events.length,
      totalDurationMs: this.totalDurationMs,
      filters: this.filters,
    };
  }

  get currentTimeMs(): number {
    const event = this.currentEvent;
    if (!event) return 0;
    return event.timestamp - this.startTimeMs;
  }

  get totalDurationMs(): number {
    if (this.events.length === 0) return 0;
    return this.events[this.events.length - 1]!.timestamp - this.startTimeMs;
  }

  get progress(): number {
    if (this.totalDurationMs === 0) return 0;
    return (this.currentTimeMs / this.totalDurationMs) * 100;
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render the replay timeline. */
  renderTimeline(
    width: number,
    fg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string {
    const chars = new Array<string>(width).fill(dimFg('textMuted', '─'));

    // Plot events
    for (const event of this.events) {
      const pos = Math.floor((event.timestamp - this.startTimeMs) / this.totalDurationMs * width);
      if (pos >= 0 && pos < width) {
        chars[pos] = fg(EVENT_COLOR[event.type], EVENT_GLYPH[event.type]);
      }
    }

    // Plot markers
    for (const marker of this.markers) {
      const event = this.events[marker.eventIndex];
      if (event) {
        const pos = Math.floor((event.timestamp - this.startTimeMs) / this.totalDurationMs * width);
        if (pos >= 0 && pos < width) {
          chars[pos] = fg(marker.color, '◆');
        }
      }
    }

    // Current position indicator
    const currentPos = Math.floor(this.progress / 100 * width);
    if (currentPos >= 0 && currentPos < width) {
      chars[currentPos] = fg('primary', '●');
    }

    return chars.join('');
  }

  /** Render the current event details. */
  renderEventDetail(
    event: ReplayEvent,
    width: number,
    fg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string[] {
    const lines: string[] = [];
    const glyph = EVENT_GLYPH[event.type];
    const color = EVENT_COLOR[event.type];
    const time = formatTime(event.timestamp - this.startTimeMs);

    lines.push(fg(color, `${glyph} ${event.type} ${dimFg('textMuted', `@ ${time}`)}`));

    switch (event.type) {
      case 'message': {
        const data = event.data as MessageEventData;
        lines.push(dimFg('textMuted', `  Role: ${data.role}`));
        lines.push(fg('text', `  ${truncate(data.content, width - 4)}`));
        break;
      }
      case 'tool-call': {
        const data = event.data as ToolCallEventData;
        lines.push(dimFg('textMuted', `  Tool: ${data.toolName}`));
        lines.push(dimFg('textMuted', `  Args: ${truncate(JSON.stringify(data.args), width - 10)}`));
        break;
      }
      case 'tool-result': {
        const data = event.data as ToolResultEventData;
        const status = data.isError ? fg('error', '✗ error') : fg('success', '✓ ok');
        lines.push(dimFg('textMuted', `  Result: ${status}`));
        lines.push(fg('text', `  ${truncate(data.result, width - 4)}`));
        break;
      }
      case 'error': {
        const data = event.data as ErrorEventData;
        lines.push(fg('error', `  ${data.code}: ${data.message}`));
        break;
      }
      default:
        lines.push(dimFg('textMuted', `  ${truncate(JSON.stringify(event.data), width - 4)}`));
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}
