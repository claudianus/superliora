/**
 * AgentTimeline — visual timeline of agent actions and tool calls.
 *
 * Provides transparent monitoring of agent activity:
 * - Chronological event stream with timestamps
 * - Event types: tool-call, response, decision, error, approval, file-edit
 * - Duration bars for long-running operations
 * - Nested events (tool call → sub-steps)
 * - Status indicators (running, complete, failed, pending)
 * - Token usage per event
 * - Cost tracking per operation
 * - Collapsible event groups
 * - Filter by event type or status
 * - Search within timeline
 * - Auto-scroll to latest event
 * - Compact/expanded view modes
 * - Color-coded by event type and severity
 *
 * Visual style:
 * - Vertical timeline with │ connector
 * - Event nodes: ● (complete) ◉ (running) ○ (pending) ✗ (failed)
 * - Duration bars: ├──████████──┤
 * - Indentation for nested events
 * - Timestamps in left gutter
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | 'tool-call'
  | 'response'
  | 'decision'
  | 'error'
  | 'approval'
  | 'file-edit'
  | 'bash'
  | 'search'
  | 'think'
  | 'system';

export type TimelineEventStatus = 'running' | 'complete' | 'failed' | 'pending' | 'cancelled';

export interface TimelineEvent {
  readonly id: string;
  readonly type: TimelineEventType;
  readonly title: string;
  readonly detail?: string;
  readonly status: TimelineEventStatus;
  readonly startTime: number;
  readonly endTime?: number;
  readonly tokensUsed?: number;
  readonly costUsd?: number;
  readonly parentId?: string;
  readonly children?: string[];
  readonly collapsed?: boolean;
  readonly metadata?: Record<string, string>;
}

export interface TimelineRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly mode: 'compact' | 'expanded';
  readonly showTimestamps?: boolean;
  readonly showTokens?: boolean;
  readonly showCost?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface TimelineFilter {
  readonly types?: readonly TimelineEventType[];
  readonly statuses?: readonly TimelineEventStatus[];
  readonly searchQuery?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<TimelineEventType, string> = {
  'tool-call': '🔧',
  'response': '💬',
  'decision': '🧠',
  'error': '❌',
  'approval': '✅',
  'file-edit': '📝',
  'bash': '⚡',
  'search': '🔍',
  'think': '💭',
  'system': '⚙️',
};

const STATUS_ICONS: Record<TimelineEventStatus, string> = {
  running: '◉',
  complete: '●',
  failed: '✗',
  pending: '○',
  cancelled: '⊘',
};

const STATUS_COLORS: Record<TimelineEventStatus, string> = {
  running: 'primary',
  complete: 'success',
  failed: 'error',
  pending: 'textMuted',
  cancelled: 'textDim',
};

const TYPE_COLORS: Record<TimelineEventType, string> = {
  'tool-call': 'primary',
  'response': 'text',
  'decision': 'accent',
  'error': 'error',
  'approval': 'success',
  'file-edit': 'warning',
  'bash': 'primary',
  'search': 'textMuted',
  'think': 'accent',
  'system': 'textMuted',
};

// ---------------------------------------------------------------------------
// AgentTimeline
// ---------------------------------------------------------------------------

export class AgentTimeline {
  private events: Map<string, TimelineEvent> = new Map();
  private rootIds: string[] = [];
  private scrollOffset = 0;
  private filter: TimelineFilter = {};
  private eventCounter = 0;

  // ─── Event Management ────────────────────────────────────────────

  /** Add a new event to the timeline. Returns the event ID. */
  addEvent(options: {
    type: TimelineEventType;
    title: string;
    detail?: string;
    status?: TimelineEventStatus;
    parentId?: string;
    tokensUsed?: number;
    costUsd?: number;
    metadata?: Record<string, string>;
  }): string {
    const id = `evt-${String(++this.eventCounter)}`;
    const event: TimelineEvent = {
      id,
      type: options.type,
      title: options.title,
      detail: options.detail,
      status: options.status ?? 'running',
      startTime: Date.now(),
      parentId: options.parentId,
      tokensUsed: options.tokensUsed,
      costUsd: options.costUsd,
      metadata: options.metadata,
    };

    this.events.set(id, event);

    if (options.parentId) {
      const parent = this.events.get(options.parentId);
      if (parent) {
        const children = parent.children ?? [];
        this.events.set(options.parentId, { ...parent, children: [...children, id] });
      }
    } else {
      this.rootIds.push(id);
    }

    return id;
  }

  /** Update an event's status. */
  updateStatus(id: string, status: TimelineEventStatus): void {
    const event = this.events.get(id);
    if (event) {
      this.events.set(id, {
        ...event,
        status,
        endTime: status === 'complete' || status === 'failed' || status === 'cancelled'
          ? Date.now()
          : event.endTime,
      });
    }
  }

  /** Mark an event as complete. */
  complete(id: string, options?: { tokensUsed?: number; costUsd?: number }): void {
    const event = this.events.get(id);
    if (event) {
      this.events.set(id, {
        ...event,
        status: 'complete',
        endTime: Date.now(),
        tokensUsed: options?.tokensUsed ?? event.tokensUsed,
        costUsd: options?.costUsd ?? event.costUsd,
      });
    }
  }

  /** Mark an event as failed. */
  fail(id: string, error?: string): void {
    const event = this.events.get(id);
    if (event) {
      this.events.set(id, {
        ...event,
        status: 'failed',
        endTime: Date.now(),
        detail: error ?? event.detail,
      });
    }
  }

  /** Toggle collapse state for an event with children. */
  toggleCollapse(id: string): void {
    const event = this.events.get(id);
    if (event && event.children && event.children.length > 0) {
      this.events.set(id, { ...event, collapsed: !event.collapsed });
    }
  }

  // ─── Filtering ───────────────────────────────────────────────────

  /** Set filter criteria. */
  setFilter(filter: TimelineFilter): void {
    this.filter = filter;
  }

  /** Clear all filters. */
  clearFilter(): void {
    this.filter = {};
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all events (flat list). */
  getAllEvents(): TimelineEvent[] {
    return [...this.events.values()];
  }

  /** Get root-level events. */
  getRootEvents(): TimelineEvent[] {
    return this.rootIds.map((id) => this.events.get(id)!).filter(Boolean);
  }

  /** Get event by ID. */
  getEvent(id: string): TimelineEvent | null {
    return this.events.get(id) ?? null;
  }

  /** Get total token usage. */
  getTotalTokens(): number {
    return [...this.events.values()].reduce((sum, e) => sum + (e.tokensUsed ?? 0), 0);
  }

  /** Get total cost. */
  getTotalCost(): number {
    return [...this.events.values()].reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  }

  /** Get event count by status. */
  getStatusCounts(): Record<TimelineEventStatus, number> {
    const counts: Record<TimelineEventStatus, number> = {
      running: 0, complete: 0, failed: 0, pending: 0, cancelled: 0,
    };
    for (const event of this.events.values()) {
      counts[event.status]++;
    }
    return counts;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the timeline. */
  render(options: TimelineRenderOptions): string[] {
    const { width, height, mode, showTimestamps = true, showTokens = false, showCost = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Header
    const counts = this.getStatusCounts();
    const totalTokens = this.getTotalTokens();
    const headerParts: string[] = [boldFg('text', ' Timeline')];
    if (counts.running > 0) headerParts.push(fg('primary', ` ◉${String(counts.running)}`));
    if (counts.complete > 0) headerParts.push(fg('success', ` ●${String(counts.complete)}`));
    if (counts.failed > 0) headerParts.push(fg('error', ` ✗${String(counts.failed)}`));
    if (showTokens && totalTokens > 0) headerParts.push(dimFg('textMuted', ` ${formatTokens(totalTokens)} tok`));
    lines.push(headerParts.join(''));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 60))));

    // Render events
    const filteredRoots = this.applyFilter(this.getRootEvents());
    let rendered = 0;

    for (const event of filteredRoots) {
      if (rendered >= height - 3) break;
      const eventLines = this.renderEvent(event, 0, mode, options);
      for (const line of eventLines) {
        if (rendered >= height - 3) break;
        lines.push(line);
        rendered++;
      }
    }

    if (filteredRoots.length === 0) {
      lines.push(dimFg('textMuted', '  (no events)'));
    }

    return lines;
  }

  private renderEvent(event: TimelineEvent, depth: number, mode: 'compact' | 'expanded', options: TimelineRenderOptions): string[] {
    const { width, showTimestamps, showTokens, showCost, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const indent = '  '.repeat(depth);
    const connector = depth > 0 ? dimFg('textDim', '│ ') : '';

    // Status icon
    const statusIcon = fg(STATUS_COLORS[event.status], STATUS_ICONS[event.status]);
    const typeIcon = EVENT_ICONS[event.type] ?? '•';

    // Timestamp
    let timeStr = '';
    if (showTimestamps) {
      const elapsed = (event.endTime ?? Date.now()) - event.startTime;
      timeStr = dimFg('textMuted', `${formatDuration(elapsed).padStart(6)} `);
    }

    // Title
    const titleColor = TYPE_COLORS[event.type];
    const title = event.status === 'running'
      ? boldFg(titleColor, event.title)
      : fg(titleColor, event.title);

    // Duration bar for running events
    let durationBar = '';
    if (event.status === 'running') {
      const elapsed = Date.now() - event.startTime;
      const barLen = Math.min(10, Math.max(1, Math.floor(elapsed / 1000)));
      durationBar = dimFg('textMuted', ` ${'─'.repeat(barLen)}▶`);
    }

    // Tokens/cost
    let meta = '';
    if (showTokens && event.tokensUsed) {
      meta += dimFg('textMuted', ` ${formatTokens(event.tokensUsed)}t`);
    }
    if (showCost && event.costUsd) {
      meta += dimFg('textMuted', ` $${event.costUsd.toFixed(3)}`);
    }

    // Compose line
    const collapseIcon = event.children && event.children.length > 0
      ? (event.collapsed ? dimFg('textMuted', '▸ ') : dimFg('textMuted', '▾ '))
      : '';

    if (mode === 'compact') {
      lines.push(`${indent}${connector}${statusIcon} ${timeStr}${typeIcon} ${title}${durationBar}${meta}`);
    } else {
      lines.push(`${indent}${connector}${statusIcon} ${timeStr}${collapseIcon}${typeIcon} ${title}${durationBar}${meta}`);
      // Detail line
      if (event.detail && !event.collapsed) {
        lines.push(`${indent}${connector}  ${dimFg('textMuted', truncate(event.detail, width - 10))}`);
      }
    }

    // Children
    if (event.children && !event.collapsed) {
      for (const childId of event.children) {
        const child = this.events.get(childId);
        if (child) {
          const childLines = this.renderEvent(child, depth + 1, mode, options);
          lines.push(...childLines);
        }
      }
    }

    return lines;
  }

  private applyFilter(events: TimelineEvent[]): TimelineEvent[] {
    let filtered = events;

    if (this.filter.types && this.filter.types.length > 0) {
      filtered = filtered.filter((e) => this.filter.types!.includes(e.type));
    }
    if (this.filter.statuses && this.filter.statuses.length > 0) {
      filtered = filtered.filter((e) => this.filter.statuses!.includes(e.status));
    }
    if (this.filter.searchQuery) {
      const q = this.filter.searchQuery.toLowerCase();
      filtered = filtered.filter((e) =>
        e.title.toLowerCase().includes(q) || (e.detail ?? '').toLowerCase().includes(q)
      );
    }

    return filtered;
  }

  /** Render a summary line (for status bars). */
  renderSummary(options: TimelineRenderOptions): string {
    const { fg, dimFg } = options;
    const counts = this.getStatusCounts();
    const parts: string[] = [];

    if (counts.running > 0) parts.push(fg('primary', `◉${String(counts.running)}`));
    if (counts.complete > 0) parts.push(fg('success', `●${String(counts.complete)}`));
    if (counts.failed > 0) parts.push(fg('error', `✗${String(counts.failed)}`));

    const totalCost = this.getTotalCost();
    if (totalCost > 0) parts.push(dimFg('textMuted', `$${totalCost.toFixed(2)}`));

    return parts.join(' ');
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m${String(seconds % 60)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}
