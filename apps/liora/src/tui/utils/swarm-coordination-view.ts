/**
 * SwarmCoordinationView — monitoring and coordination for parallel agents.
 *
 * Provides a comprehensive view of multi-agent swarm operations:
 * - Grid/list view of all active agents with status
 * - Real-time activity feed per agent
 * - Resource usage tracking (tokens, time, cost)
 * - Dependency graph visualization
 * - Coordination timeline (who's doing what when)
 * - Alert aggregation (errors, approvals needed)
 * - Quick actions (pause, resume, terminate agents)
 *
 * View modes:
 * - Grid: Compact cards for each agent (best for many agents)
 * - List: Detailed rows with progress bars
 * - Timeline: Gantt-style coordination view
 * - Graph: Dependency relationships
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'tool-call'
  | 'waiting-approval'
  | 'error'
  | 'complete'
  | 'paused';

export interface SwarmAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: AgentStatus;
  readonly currentTask: string | null;
  readonly progress: number; // 0-1
  readonly tokensUsed: number;
  readonly elapsedMs: number;
  readonly costUsd: number;
  readonly lastActivityMs: number;
  readonly errorCount: number;
  readonly dependencies: readonly string[]; // Agent IDs this depends on
}

export interface SwarmStats {
  readonly totalAgents: number;
  readonly activeAgents: number;
  readonly completedAgents: number;
  readonly errorAgents: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly totalElapsedMs: number;
  readonly pendingApprovals: number;
}

export interface SwarmAlert {
  readonly id: string;
  readonly agentId: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly timestamp: number;
  acknowledged: boolean;
}

export type SwarmViewMode = 'grid' | 'list' | 'timeline' | 'graph';

export interface SwarmViewOptions {
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

const STATUS_GLYPH: Record<AgentStatus, string> = {
  idle: '○',
  thinking: '◐',
  working: '●',
  'tool-call': '⚙',
  'waiting-approval': '⏳',
  error: '✗',
  complete: '✓',
  paused: '⏸',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'textMuted',
  thinking: 'accent',
  working: 'primary',
  'tool-call': 'warning',
  'waiting-approval': 'warning',
  error: 'error',
  complete: 'success',
  paused: 'textDim',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  working: 'Working',
  'tool-call': 'Tool Call',
  'waiting-approval': 'Approval',
  error: 'Error',
  complete: 'Done',
  paused: 'Paused',
};

// ---------------------------------------------------------------------------
// SwarmCoordinator
// ---------------------------------------------------------------------------

export class SwarmCoordinator {
  private agents: Map<string, SwarmAgent> = new Map();
  private alerts: SwarmAlert[] = [];
  private alertCounter = 0;
  private viewMode: SwarmViewMode = 'grid';
  private selectedAgentId: string | null = null;
  private sortField: 'name' | 'status' | 'progress' | 'cost' = 'status';

  // ─── Agent Management ─────────────────────────────────────────────

  /** Register a new agent. */
  addAgent(agent: SwarmAgent): void {
    this.agents.set(agent.id, agent);
  }

  /** Update an agent's state. */
  updateAgent(id: string, patch: Partial<SwarmAgent>): void {
    const existing = this.agents.get(id);
    if (existing) {
      this.agents.set(id, { ...existing, ...patch });
    }
  }

  /** Remove an agent. */
  removeAgent(id: string): void {
    this.agents.delete(id);
  }

  /** Get an agent by ID. */
  getAgent(id: string): SwarmAgent | undefined {
    return this.agents.get(id);
  }

  /** Get all agents. */
  getAgents(): SwarmAgent[] {
    return [...this.agents.values()];
  }

  /** Get agents sorted by the current sort field. */
  getSortedAgents(): SwarmAgent[] {
    const agents = this.getAgents();
    switch (this.sortField) {
      case 'name':
        return agents.sort((a, b) => a.name.localeCompare(b.name));
      case 'status':
        return agents.sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
      case 'progress':
        return agents.sort((a, b) => b.progress - a.progress);
      case 'cost':
        return agents.sort((a, b) => b.costUsd - a.costUsd);
    }
  }

  // ─── Alerts ─────────────────────────────────────────────────────

  /** Add an alert. */
  addAlert(agentId: string, severity: SwarmAlert['severity'], message: string): string {
    const id = `alert-${String(++this.alertCounter)}`;
    this.alerts.push({
      id,
      agentId,
      severity,
      message,
      timestamp: Date.now(),
      acknowledged: false,
    });
    return id;
  }

  /** Acknowledge an alert. */
  acknowledgeAlert(id: string): void {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /** Acknowledge all alerts. */
  acknowledgeAll(): void {
    for (const alert of this.alerts) {
      alert.acknowledged = true;
    }
  }

  /** Get unacknowledged alerts. */
  getPendingAlerts(): SwarmAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /** Get all alerts. */
  getAlerts(): readonly SwarmAlert[] {
    return this.alerts;
  }

  // ─── Statistics ─────────────────────────────────────────────────

  /** Get aggregate statistics. */
  getStats(): SwarmStats {
    const agents = this.getAgents();
    let totalTokens = 0;
    let totalCostUsd = 0;
    let totalElapsedMs = 0;
    let activeCount = 0;
    let completedCount = 0;
    let errorCount = 0;
    let pendingApprovals = 0;

    for (const agent of agents) {
      totalTokens += agent.tokensUsed;
      totalCostUsd += agent.costUsd;
      totalElapsedMs = Math.max(totalElapsedMs, agent.elapsedMs);

      if (agent.status === 'working' || agent.status === 'thinking' || agent.status === 'tool-call') {
        activeCount++;
      }
      if (agent.status === 'complete') {
        completedCount++;
      }
      if (agent.status === 'error') {
        errorCount++;
      }
      if (agent.status === 'waiting-approval') {
        pendingApprovals++;
      }
    }

    return {
      totalAgents: agents.length,
      activeAgents: activeCount,
      completedAgents: completedCount,
      errorAgents: errorCount,
      totalTokens,
      totalCostUsd,
      totalElapsedMs,
      pendingApprovals,
    };
  }

  // ─── View Control ───────────────────────────────────────────────

  /** Set the view mode. */
  setViewMode(mode: SwarmViewMode): void {
    this.viewMode = mode;
  }

  /** Cycle through view modes. */
  cycleViewMode(): void {
    const modes: SwarmViewMode[] = ['grid', 'list', 'timeline', 'graph'];
    const idx = modes.indexOf(this.viewMode);
    this.viewMode = modes[(idx + 1) % modes.length]!;
  }

  get currentViewMode(): SwarmViewMode {
    return this.viewMode;
  }

  /** Select an agent for detail view. */
  selectAgent(id: string | null): void {
    this.selectedAgentId = id;
  }

  get selectedAgent(): SwarmAgent | null {
    if (!this.selectedAgentId) return null;
    return this.agents.get(this.selectedAgentId) ?? null;
  }

  /** Set the sort field. */
  setSortField(field: typeof this.sortField): void {
    this.sortField = field;
  }

  // ─── Rendering ──────────────────────────────────────────────────

  /** Render the swarm view. */
  render(options: SwarmViewOptions): string[] {
    switch (this.viewMode) {
      case 'grid':
        return this.renderGrid(options);
      case 'list':
        return this.renderList(options);
      case 'timeline':
        return this.renderTimeline(options);
      case 'graph':
        return this.renderGraph(options);
    }
  }

  private renderGrid(options: SwarmViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];
    const agents = this.getSortedAgents();
    const stats = this.getStats();

    // Header
    lines.push(boldFg('text', ` Swarm: ${String(stats.activeAgents)}/${String(stats.totalAgents)} active`));
    if (stats.pendingApprovals > 0) {
      lines.push(fg('warning', ` ⚠ ${String(stats.pendingApprovals)} pending approvals`));
    }
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 50))));

    // Grid layout: 2-3 columns depending on width
    const cardWidth = Math.floor((width - 4) / (width > 120 ? 3 : 2));
    const cardsPerRow = Math.floor((width - 2) / (cardWidth + 1));

    for (let i = 0; i < agents.length && lines.length < height - 2; i += cardsPerRow) {
      const rowAgents = agents.slice(i, i + cardsPerRow);
      const cardLines: string[][] = rowAgents.map((agent) =>
        this.renderAgentCard(agent, cardWidth, fg, boldFg, dimFg, bg)
      );

      // Merge cards side by side (ANSI-aware padding)
      const maxCardHeight = Math.max(...cardLines.map((c) => c.length));
      for (let row = 0; row < maxCardHeight && lines.length < height - 2; row++) {
        const rowParts = cardLines.map((card) =>
          ansiPadEnd(ansiTruncate(card[row] ?? '', cardWidth), cardWidth)
        );
        lines.push(rowParts.join(' '));
      }
    }

    return lines.slice(0, height);
  }

  private renderAgentCard(
    agent: SwarmAgent,
    width: number,
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string[] {
    const lines: string[] = [];
    const isSelected = agent.id === this.selectedAgentId;
    const statusColor = STATUS_COLOR[agent.status];
    const glyph = STATUS_GLYPH[agent.status];

    // Border
    const border = isSelected ? fg('primary', '┌' + '─'.repeat(width - 2) + '┐') : dimFg('textMuted', '┌' + '─'.repeat(width - 2) + '┐');
    lines.push(border);

    // Name + status
    const name = truncate(agent.name, width - 8);
    const statusStr = fg(statusColor, `${glyph} ${STATUS_LABEL[agent.status]}`);
    const nameLine = ` ${boldFg('text', name)} ${statusStr}`;
    lines.push(dimFg('textMuted', '│') + ansiPadEnd(nameLine, width - 3) + dimFg('textMuted', '│'));

    // Task
    const task = agent.currentTask ? truncate(agent.currentTask, width - 6) : dimFg('textMuted', '(idle)');
    lines.push(dimFg('textMuted', '│') + ansiPadEnd(` ${task}`, width - 3) + dimFg('textMuted', '│'));

    // Progress bar
    const barWidth = width - 8;
    const filled = Math.round(agent.progress * barWidth);
    const bar = fg(statusColor, '█'.repeat(filled)) + dimFg('textMuted', '░'.repeat(barWidth - filled));
    lines.push(dimFg('textMuted', '│') + ` ${bar} ${String(Math.round(agent.progress * 100))}%`.padStart(4) + dimFg('textMuted', '│'));

    // Stats
    const tokens = formatTokens(agent.tokensUsed);
    const cost = `$${agent.costUsd.toFixed(3)}`;
    lines.push(dimFg('textMuted', '│') + ansiPadEnd(dimFg('textMuted', ` ${tokens} tok · ${cost}`), width - 3) + dimFg('textMuted', '│'));

    // Bottom border
    const bottomBorder = isSelected ? fg('primary', '└' + '─'.repeat(width - 2) + '┘') : dimFg('textMuted', '└' + '─'.repeat(width - 2) + '┘');
    lines.push(bottomBorder);

    return lines;
  }

  private renderList(options: SwarmViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const agents = this.getSortedAgents();

    // Header
    lines.push(boldFg('text', ' Agent List'));
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 60))));

    // Column headers
    const nameW = 15;
    const statusW = 12;
    const progressW = 20;
    const taskW = width - nameW - statusW - progressW - 10;

    lines.push(dimFg('textMuted',
      'Name'.padEnd(nameW) +
      'Status'.padEnd(statusW) +
      'Progress'.padEnd(progressW) +
      'Task'
    ));

    for (const agent of agents.slice(0, height - 4)) {
      const isSelected = agent.id === this.selectedAgentId;
      const prefix = isSelected ? fg('primary', '▸ ') : '  ';
      const statusColor = STATUS_COLOR[agent.status];

      const name = truncate(agent.name, nameW - 2).padEnd(nameW);
      const status = fg(statusColor, `${STATUS_GLYPH[agent.status]} ${STATUS_LABEL[agent.status]}`.padEnd(statusW));

      const barW = progressW - 6;
      const filled = Math.round(agent.progress * barW);
      const bar = fg(statusColor, '█'.repeat(filled)) + dimFg('textMuted', '░'.repeat(barW - filled));
      const progress = `${bar} ${String(Math.round(agent.progress * 100)).padStart(3)}%`;

      const task = truncate(agent.currentTask ?? '', taskW);

      lines.push(`${prefix}${name}${status}${progress} ${dimFg('textMuted', task)}`);
    }

    return lines.slice(0, height);
  }

  private renderTimeline(options: SwarmViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const agents = this.getAgents();
    const stats = this.getStats();

    lines.push(boldFg('text', ' Coordination Timeline'));
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 60))));

    // Time axis
    const timeWidth = width - 20;
    const maxTime = stats.totalElapsedMs || 60000;
    const tickInterval = niceTimeInterval(maxTime, timeWidth);

    let axis = ' '.repeat(15);
    for (let t = 0; t <= maxTime; t += tickInterval) {
      const pos = Math.floor((t / maxTime) * timeWidth);
      const label = formatTime(t);
      axis = axis.slice(0, 15 + pos) + dimFg('textMuted', label) + axis.slice(15 + pos + label.length);
    }
    lines.push(axis.slice(0, width));

    // Agent timelines
    for (const agent of agents.slice(0, height - 5)) {
      const name = truncate(agent.name, 14).padEnd(15);
      const barStart = 0;
      const barEnd = Math.floor((agent.elapsedMs / maxTime) * timeWidth);
      const statusColor = STATUS_COLOR[agent.status];

      let timeline = ' '.repeat(timeWidth);
      const bar = fg(statusColor, '█'.repeat(Math.max(1, barEnd - barStart)));
      timeline = timeline.slice(0, barStart) + bar + timeline.slice(barEnd);

      lines.push(dimFg('textMuted', name) + timeline.slice(0, timeWidth));
    }

    return lines.slice(0, height);
  }

  private renderGraph(options: SwarmViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const agents = this.getAgents();

    lines.push(boldFg('text', ' Dependency Graph'));
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 60))));

    // Simple text-based graph
    for (const agent of agents.slice(0, height - 4)) {
      const statusColor = STATUS_COLOR[agent.status];
      const glyph = STATUS_GLYPH[agent.status];
      const deps = agent.dependencies.length > 0
        ? dimFg('textMuted', ` ← [${agent.dependencies.join(', ')}]`)
        : '';

      lines.push(` ${fg(statusColor, glyph)} ${boldFg('text', agent.name)}${deps}`);

      // Show dependents
      const dependents = agents.filter((a) => a.dependencies.includes(agent.id));
      for (const dep of dependents.slice(0, 3)) {
        lines.push(dimFg('textMuted', `   └→ ${dep.name}`));
      }
    }

    return lines.slice(0, height);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusPriority(status: AgentStatus): number {
  const priorities: Record<AgentStatus, number> = {
    'waiting-approval': 0,
    'error': 1,
    'working': 2,
    'tool-call': 3,
    'thinking': 4,
    'paused': 5,
    'idle': 6,
    'complete': 7,
  };
  return priorities[status];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m`;
}

function niceTimeInterval(maxMs: number, width: number): number {
  const targetTicks = Math.floor(width / 8);
  const rawInterval = maxMs / Math.max(1, targetTicks);
  const intervals = [1000, 5000, 10000, 30000, 60000, 300000, 600000];
  for (const interval of intervals) {
    if (interval >= rawInterval) return interval;
  }
  return 600000;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

/** Strip ANSI escape sequences for width calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Pad a string to a target width, accounting for ANSI escape sequences. */
function ansiPadEnd(s: string, targetWidth: number): string {
  const visibleLen = stripAnsi(s).length;
  const padding = Math.max(0, targetWidth - visibleLen);
  return s + ' '.repeat(padding);
}

/** Truncate a string to a target visible width, preserving ANSI codes. */
function ansiTruncate(s: string, maxWidth: number): string {
  const visible = stripAnsi(s);
  if (visible.length <= maxWidth) return s;
  // Walk through the string counting visible chars
  let visibleCount = 0;
  let result = '';
  let inEscape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\u001B') { inEscape = true; result += ch; continue; }
    if (inEscape) { result += ch; if (ch === 'm') inEscape = false; continue; }
    if (visibleCount >= maxWidth - 1) { result += '…'; break; }
    result += ch;
    visibleCount++;
  }
  return result + '\u001B[0m';
}
