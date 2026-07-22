/**
 * DynamicStatusBar — multi-segment status bar with mode indicators.
 *
 * Provides a rich, informative status bar:
 * - Multiple segments with priority-based overflow handling
 * - Mode indicator (normal/insert/visual/command/search)
 * - Git branch and status display
 * - Context usage meter (tokens used / budget)
 * - Agent activity indicator (working/waiting/idle)
 * - Session count and active pane info
 * - Clock / elapsed time
 * - Error/warning counters
 * - Keyboard hint area (contextual shortcuts)
 * - Notification badge
 * - Configurable segment order and visibility
 * - Animated transitions on mode change
 * - Compact mode for narrow terminals
 *
 * Layout: [mode] [git] [agent] [context] ... [hints] [clock]
 * Segments shrink/hide based on available width and priority.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusBarMode = 'normal' | 'insert' | 'visual' | 'command' | 'search' | 'agent';

export interface StatusSegment {
  readonly id: string;
  readonly priority: number; // Higher = more important (shown first when space limited)
  readonly minWidth: number;
  render(width: number): string;
  visible: boolean;
}

export interface GitStatus {
  readonly branch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly modified: number;
  readonly staged: number;
  readonly conflicts: number;
}

export interface AgentStatus {
  readonly state: 'working' | 'waiting' | 'idle' | 'error' | 'complete';
  readonly task: string;
  readonly progress: number; // 0-1
  readonly elapsedMs: number;
}

export interface ContextStatus {
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly pressure: 'low' | 'medium' | 'high' | 'critical';
}

export interface StatusBarData {
  readonly mode: StatusBarMode;
  readonly git?: GitStatus;
  readonly agent?: AgentStatus;
  readonly context?: ContextStatus;
  readonly sessionCount?: number;
  readonly activePane?: string;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notifications?: number;
  readonly keyHints?: readonly Array<{ keys: string; action: string }>;
  readonly clock?: string;
}

export interface StatusBarRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_CONFIG: Record<StatusBarMode, { label: string; color: string; symbol: string }> = {
  normal: { label: 'NORMAL', color: 'primary', symbol: '◆' },
  insert: { label: 'INSERT', color: 'success', symbol: '▎' },
  visual: { label: 'VISUAL', color: 'accent', symbol: '◈' },
  command: { label: 'CMD', color: 'warning', symbol: '⌘' },
  search: { label: 'SEARCH', color: 'primary', symbol: '⌕' },
  agent: { label: 'AGENT', color: 'accent', symbol: '⚡' },
};

const AGENT_STATE_CONFIG: Record<string, { symbol: string; color: string }> = {
  working: { symbol: '●', color: 'success' },
  waiting: { symbol: '◌', color: 'warning' },
  idle: { symbol: '○', color: 'textMuted' },
  error: { symbol: '✗', color: 'error' },
  complete: { symbol: '✓', color: 'success' },
};

// ---------------------------------------------------------------------------
// DynamicStatusBar
// ---------------------------------------------------------------------------

export class DynamicStatusBar {
  private data: StatusBarData = { mode: 'normal' };
  private animationPhase = 0;
  private lastMode: StatusBarMode = 'normal';
  private modeChangeTime = 0;

  // ─── Data Updates ────────────────────────────────────────────────

  /** Update the full status bar data. */
  update(data: Partial<StatusBarData>): void {
    if (data.mode && data.mode !== this.data.mode) {
      this.lastMode = this.data.mode;
      this.modeChangeTime = Date.now();
    }
    this.data = { ...this.data, ...data };
  }

  /** Set the current mode. */
  setMode(mode: StatusBarMode): void {
    this.update({ mode });
  }

  /** Update git status. */
  setGitStatus(git: GitStatus): void {
    this.update({ git });
  }

  /** Update agent status. */
  setAgentStatus(agent: AgentStatus): void {
    this.update({ agent });
  }

  /** Update context usage. */
  setContextStatus(context: ContextStatus): void {
    this.update({ context });
  }

  /** Advance animation (call each frame). */
  tick(): void {
    this.animationPhase = (this.animationPhase + 1) % 60;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the status bar (single line). */
  render(options: StatusBarRenderOptions): string {
    const { width, fg, boldFg, dimFg } = options;
    const segments = this.buildSegments(options);

    // Calculate total width needed
    const totalNeeded = segments.reduce((sum, s) => sum + stripAnsiLen(s.content) + 1, 0);

    // If everything fits, render all
    if (totalNeeded <= width) {
      return this.composeLine(segments.map((s) => s.content), width, options);
    }

    // Priority-based truncation
    const sorted = [...segments].sort((a, b) => b.priority - a.priority);
    const visible: Array<{ content: string; index: number }> = [];
    let usedWidth = 0;

    for (const seg of sorted) {
      const segWidth = stripAnsiLen(seg.content) + 1;
      if (usedWidth + segWidth <= width - 3) { // Reserve 3 for ellipsis
        visible.push({ content: seg.content, index: seg.index });
        usedWidth += segWidth;
      }
    }

    // Sort back to original order
    visible.sort((a, b) => a.index - b.index);
    return this.composeLine(visible.map((v) => v.content), width, options);
  }

  /** Render a two-line status bar (main + hints). */
  renderFull(options: StatusBarRenderOptions): string[] {
    const lines: string[] = [];
    lines.push(this.render(options));

    // Key hints line
    if (this.data.keyHints && this.data.keyHints.length > 0) {
      const { width, fg, dimFg } = options;
      const hints = this.data.keyHints
        .map((h) => `${fg('accent', h.keys)} ${dimFg('textMuted', h.action)}`)
        .join(dimFg('textMuted', ' │ '));
      const hintLine = ` ${truncateAnsi(hints, width - 2)}`;
      lines.push(hintLine);
    }

    return lines;
  }

  private buildSegments(options: StatusBarRenderOptions): Array<{ content: string; priority: number; index: number }> {
    const { fg, boldFg, dimFg } = options;
    const segments: Array<{ content: string; priority: number; index: number }> = [];
    let idx = 0;

    // Mode indicator (always highest priority)
    const modeConf = MODE_CONFIG[this.data.mode];
    const modeAnimated = this.getModeAnimation();
    segments.push({
      content: `${boldFg(modeConf.color, ` ${modeConf.symbol} ${modeConf.label}${modeAnimated} `)}`,
      priority: 100,
      index: idx++,
    });

    // Git status
    if (this.data.git) {
      const g = this.data.git;
      let gitStr = fg('textMuted', ' ') + fg('primary', ` ${g.branch}`);
      if (g.ahead > 0) gitStr += fg('success', `↑${String(g.ahead)}`);
      if (g.behind > 0) gitStr += fg('error', `↓${String(g.behind)}`);
      if (g.modified > 0) gitStr += fg('warning', ` ●${String(g.modified)}`);
      if (g.staged > 0) gitStr += fg('success', ` +${String(g.staged)}`);
      if (g.conflicts > 0) gitStr += fg('error', ` ✗${String(g.conflicts)}`);
      segments.push({ content: gitStr, priority: 80, index: idx++ });
    }

    // Agent status
    if (this.data.agent) {
      const a = this.data.agent;
      const stateConf = AGENT_STATE_CONFIG[a.state] ?? AGENT_STATE_CONFIG['idle']!;
      const spinner = a.state === 'working' ? this.getSpinner() : stateConf.symbol;
      let agentStr = fg(stateConf.color, ` ${spinner}`);
      agentStr += dimFg('textMuted', ` ${truncate(a.task, 15)}`);
      if (a.state === 'working') {
        agentStr += dimFg('textMuted', ` ${formatDuration(a.elapsedMs)}`);
      }
      segments.push({ content: agentStr, priority: 70, index: idx++ });
    }

    // Context usage
    if (this.data.context) {
      const c = this.data.context;
      const ratio = c.usedTokens / c.budgetTokens;
      const percent = Math.round(ratio * 100);
      const color = c.pressure === 'critical' ? 'error' : c.pressure === 'high' ? 'warning' : c.pressure === 'medium' ? 'primary' : 'textMuted';
      const bar = renderTinyBar(ratio, 8);
      segments.push({
        content: ` ${fg(color, bar)} ${fg(color, `${String(percent)}%`)}`,
        priority: 60,
        index: idx++,
      });
    }

    // Session count
    if (this.data.sessionCount && this.data.sessionCount > 1) {
      segments.push({
        content: dimFg('textMuted', ` ⧉${String(this.data.sessionCount)}`),
        priority: 40,
        index: idx++,
      });
    }

    // Errors/Warnings
    if ((this.data.errors ?? 0) > 0 || (this.data.warnings ?? 0) > 0) {
      let ewStr = '';
      if (this.data.errors! > 0) ewStr += fg('error', ` ✗${String(this.data.errors)}`);
      if (this.data.warnings! > 0) ewStr += fg('warning', ` ⚠${String(this.data.warnings)}`);
      segments.push({ content: ewStr, priority: 75, index: idx++ });
    }

    // Notifications
    if ((this.data.notifications ?? 0) > 0) {
      segments.push({
        content: fg('accent', ` 🔔${String(this.data.notifications)}`),
        priority: 35,
        index: idx++,
      });
    }

    // Clock (lowest priority, right-aligned)
    if (this.data.clock) {
      segments.push({
        content: dimFg('textMuted', ` ${this.data.clock} `),
        priority: 10,
        index: idx++,
      });
    }

    return segments;
  }

  private composeLine(segments: string[], width: number, options: StatusBarRenderOptions): string {
    const { dimFg } = options;
    const sep = dimFg('textMuted', '│');
    const content = segments.join(` ${sep} `);
    const contentLen = stripAnsiLen(content);
    const padding = Math.max(0, width - contentLen - 2);

    // Fill with dim background
    return ` ${content}${' '.repeat(padding)} `;
  }

  // ─── Animations ──────────────────────────────────────────────────

  private getSpinner(): string {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[this.animationPhase % frames.length] ?? '⠋';
  }

  private getModeAnimation(): string {
    const elapsed = Date.now() - this.modeChangeTime;
    if (elapsed > 500) return ''; // Animation done

    const frames = ['·', '··', '···', '··', '·', ''];
    const frameIdx = Math.min(frames.length - 1, Math.floor(elapsed / 80));
    return frames[frameIdx] ?? '';
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function truncateAnsi(s: string, maxLen: number): string {
  const visible = stripAnsiLen(s);
  if (visible <= maxLen) return s;
  // Simple truncation (not ANSI-aware for hints line)
  let count = 0;
  let result = '';
  let inEscape = false;
  for (const ch of s) {
    if (ch === '\x1b') { inEscape = true; result += ch; continue; }
    if (inEscape) { result += ch; if (ch === 'm') inEscape = false; continue; }
    if (count >= maxLen - 1) { result += '…\x1b[0m'; break; }
    result += ch;
    count++;
  }
  return result;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${String(minutes)}m${String(remainSec)}s`;
}

function renderTinyBar(ratio: number, width: number): string {
  const filled = Math.round(ratio * width);
  const chars = ['░', '▒', '▓', '█'];
  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i < filled - 1) bar += '█';
    else if (i === filled - 1) {
      const frac = ratio * width - (filled - 1);
      bar += frac > 0.75 ? '▓' : frac > 0.5 ? '▒' : '░';
    } else bar += '░';
  }
  return bar;
}
