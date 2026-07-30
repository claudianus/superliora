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

export { SessionReplay } from './session-replay-player';
