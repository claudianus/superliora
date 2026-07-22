/**
 * CommandPalette — fuzzy-searchable command palette for rapid action execution.
 *
 * Provides a VS Code / Spotlight-style command palette:
 * - Fuzzy matching with scoring (consecutive chars, word boundaries, camelCase)
 * - Category grouping (navigation, actions, settings, git, agents)
 * - Recent commands (frequency + recency weighted)
 * - Keyboard navigation (up/down, tab complete, enter execute)
 * - Contextual filtering (only show relevant commands for current state)
 * - Inline preview of command effects
 * - Nested sub-menus for complex operations
 *
 * Scoring algorithm inspired by fzf:
 * - Consecutive match bonus
 * - Word boundary bonus (after space, -, _, /)
 * - CamelCase boundary bonus
 * - First character bonus
 * - Gap penalty
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandCategory =
  | 'navigation'
  | 'actions'
  | 'settings'
  | 'git'
  | 'agents'
  | 'view'
  | 'session'
  | 'help';

export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category: CommandCategory;
  /** Keyboard shortcut hint (e.g. "Ctrl+P"). */
  readonly shortcut?: string;
  /** Whether this command is currently enabled. */
  readonly enabled: boolean;
  /** Sub-menu items (for nested commands). */
  readonly children?: readonly PaletteCommand[];
  /** Icon glyph for the command. */
  readonly icon?: string;
  /** Tags for additional search matching. */
  readonly tags?: readonly string[];
}

export interface ScoredCommand {
  readonly command: PaletteCommand;
  readonly score: number;
  /** Matched character indices in the title (for highlighting). */
  readonly matchIndices: readonly number[];
}

export interface PaletteState {
  readonly query: string;
  readonly results: readonly ScoredCommand[];
  readonly selectedIndex: number;
  readonly scrollOffset: number;
  readonly categoryFilter: CommandCategory | null;
  readonly isOpen: boolean;
}

export interface PaletteRenderOptions {
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

const CATEGORY_GLYPH: Record<CommandCategory, string> = {
  navigation: '🧭',
  actions: '⚡',
  settings: '⚙',
  git: '🌿',
  agents: '🤖',
  view: '👁',
  session: '📋',
  help: '❓',
};

const CATEGORY_LABEL: Record<CommandCategory, string> = {
  navigation: 'Navigate',
  actions: 'Actions',
  settings: 'Settings',
  git: 'Git',
  agents: 'Agents',
  view: 'View',
  session: 'Session',
  help: 'Help',
};

/** Scoring weights. */
const SCORE_CONSECUTIVE = 15;
const SCORE_WORD_BOUNDARY = 10;
const SCORE_CAMEL_BOUNDARY = 8;
const SCORE_FIRST_CHAR = 12;
const SCORE_MATCH = 5;
const SCORE_GAP_PENALTY = -3;
const SCORE_RECENCY_BONUS = 20;
const SCORE_FREQUENCY_BONUS = 10;

/** Maximum results to display. */
const MAX_RESULTS = 15;

// ---------------------------------------------------------------------------
// Fuzzy Matcher
// ---------------------------------------------------------------------------

/**
 * Fuzzy match a query against a target string.
 * Returns null if no match, otherwise score + matched indices.
 */
export function fuzzyMatch(
  query: string,
  target: string,
): { score: number; indices: number[] } | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (query.length > target.length) return null;

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  const indices: number[] = [];

  let queryIdx = 0;
  let score = 0;
  let lastMatchIdx = -2; // Track consecutive matches

  for (let targetIdx = 0; targetIdx < target.length && queryIdx < queryLower.length; targetIdx++) {
    if (targetLower[targetIdx] === queryLower[queryIdx]) {
      indices.push(targetIdx);

      // Scoring
      if (targetIdx === 0) {
        score += SCORE_FIRST_CHAR;
      } else if (targetIdx === lastMatchIdx + 1) {
        score += SCORE_CONSECUTIVE;
      } else {
        score += SCORE_MATCH;
        // Gap penalty
        score += SCORE_GAP_PENALTY * (targetIdx - lastMatchIdx - 1);
      }

      // Word boundary bonus
      const prevChar = target[targetIdx - 1];
      if (prevChar && (prevChar === ' ' || prevChar === '-' || prevChar === '_' || prevChar === '/')) {
        score += SCORE_WORD_BOUNDARY;
      }

      // CamelCase boundary bonus
      if (prevChar && prevChar >= 'a' && prevChar <= 'z' && target[targetIdx]! >= 'A' && target[targetIdx]! <= 'Z') {
        score += SCORE_CAMEL_BOUNDARY;
      }

      lastMatchIdx = targetIdx;
      queryIdx++;
    }
  }

  // All query characters must be matched
  if (queryIdx < queryLower.length) return null;

  return { score, indices };
}

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------

export class CommandPalette {
  private commands: PaletteCommand[] = [];
  private state: PaletteState;
  private recentCommands: Map<string, { count: number; lastUsed: number }> = new Map();
  private onExecute: ((command: PaletteCommand) => void) | null = null;

  constructor() {
    this.state = {
      query: '',
      results: [],
      selectedIndex: 0,
      scrollOffset: 0,
      categoryFilter: null,
      isOpen: false,
    };
  }

  // ─── Command Registration ─────────────────────────────────────────

  /** Register commands. */
  setCommands(commands: PaletteCommand[]): void {
    this.commands = commands;
    if (this.state.isOpen) this.refresh();
  }

  /** Add a single command. */
  addCommand(command: PaletteCommand): void {
    this.commands.push(command);
    if (this.state.isOpen) this.refresh();
  }

  /** Remove a command by ID. */
  removeCommand(id: string): void {
    this.commands = this.commands.filter((c) => c.id !== id);
  }

  /** Set the execution callback. */
  setExecuteHandler(handler: (command: PaletteCommand) => void): void {
    this.onExecute = handler;
  }

  // ─── Open / Close ─────────────────────────────────────────────────

  open(categoryFilter: CommandCategory | null = null): void {
    this.state = {
      query: '',
      results: this.scoreCommands('', categoryFilter),
      selectedIndex: 0,
      scrollOffset: 0,
      categoryFilter,
      isOpen: true,
    };
  }

  close(): void {
    this.state = { ...this.state, isOpen: false };
  }

  get isOpen(): boolean {
    return this.state.isOpen;
  }

  // ─── Input Handling ───────────────────────────────────────────────

  /** Handle a character input. */
  typeChar(char: string): void {
    const query = this.state.query + char;
    this.state = {
      ...this.state,
      query,
      results: this.scoreCommands(query, this.state.categoryFilter),
      selectedIndex: 0,
      scrollOffset: 0,
    };
  }

  /** Handle backspace. */
  backspace(): void {
    const query = this.state.query.slice(0, -1);
    this.state = {
      ...this.state,
      query,
      results: this.scoreCommands(query, this.state.categoryFilter),
      selectedIndex: 0,
      scrollOffset: 0,
    };
  }

  /** Clear the query. */
  clearQuery(): void {
    this.state = {
      ...this.state,
      query: '',
      results: this.scoreCommands('', this.state.categoryFilter),
      selectedIndex: 0,
      scrollOffset: 0,
    };
  }

  /** Move selection up. */
  moveUp(): void {
    this.state = {
      ...this.state,
      selectedIndex: Math.max(0, this.state.selectedIndex - 1),
    };
    this.adjustScroll();
  }

  /** Move selection down. */
  moveDown(): void {
    this.state = {
      ...this.state,
      selectedIndex: Math.min(this.state.results.length - 1, this.state.selectedIndex + 1),
    };
    this.adjustScroll();
  }

  /** Execute the selected command. */
  execute(): PaletteCommand | null {
    const selected = this.state.results[this.state.selectedIndex];
    if (!selected) return null;

    // Record usage
    this.recordUsage(selected.command.id);

    // Execute callback
    if (this.onExecute) {
      this.onExecute(selected.command);
    }

    this.close();
    return selected.command;
  }

  /** Set category filter. */
  setCategoryFilter(category: CommandCategory | null): void {
    this.state = {
      ...this.state,
      categoryFilter: category,
      results: this.scoreCommands(this.state.query, category),
      selectedIndex: 0,
      scrollOffset: 0,
    };
  }

  /** Cycle through category filters. */
  cycleCategory(): void {
    const categories: (CommandCategory | null)[] = [
      null, 'navigation', 'actions', 'git', 'agents', 'view', 'settings', 'session',
    ];
    const currentIdx = categories.indexOf(this.state.categoryFilter);
    const nextIdx = (currentIdx + 1) % categories.length;
    this.setCategoryFilter(categories[nextIdx]!);
  }

  // ─── State Access ─────────────────────────────────────────────────

  getState(): PaletteState {
    return this.state;
  }

  getSelectedCommand(): PaletteCommand | null {
    return this.state.results[this.state.selectedIndex]?.command ?? null;
  }

  // ─── Scoring ──────────────────────────────────────────────────────

  private scoreCommands(query: string, categoryFilter: CommandCategory | null): ScoredCommand[] {
    let candidates = this.commands.filter((c) => c.enabled);

    if (categoryFilter) {
      candidates = candidates.filter((c) => c.category === categoryFilter);
    }

    if (query.length === 0) {
      // No query: sort by recency/frequency, then alphabetically
      return candidates
        .map((cmd) => ({
          command: cmd,
          score: this.getUsageScore(cmd.id),
          matchIndices: [] as number[],
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);
    }

    const scored: ScoredCommand[] = [];

    for (const cmd of candidates) {
      // Match against title
      const titleMatch = fuzzyMatch(query, cmd.title);
      // Match against tags
      let tagMatch: { score: number; indices: number[] } | null = null;
      if (cmd.tags) {
        for (const tag of cmd.tags) {
          const m = fuzzyMatch(query, tag);
          if (m && (!tagMatch || m.score > tagMatch.score)) {
            tagMatch = m;
          }
        }
      }
      // Match against description
      const descMatch = cmd.description ? fuzzyMatch(query, cmd.description) : null;

      const bestMatch = titleMatch ?? tagMatch ?? descMatch;
      if (bestMatch) {
        const usageBonus = this.getUsageScore(cmd.id);
        scored.push({
          command: cmd,
          score: bestMatch.score + usageBonus,
          matchIndices: titleMatch?.indices ?? [],
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }

  private getUsageScore(commandId: string): number {
    const usage = this.recentCommands.get(commandId);
    if (!usage) return 0;

    const recencyMs = Date.now() - usage.lastUsed;
    const recencyScore = Math.max(0, SCORE_RECENCY_BONUS * (1 - recencyMs / 3600000)); // Decay over 1h
    const frequencyScore = Math.min(SCORE_FREQUENCY_BONUS, usage.count * 2);

    return recencyScore + frequencyScore;
  }

  private recordUsage(commandId: string): void {
    const existing = this.recentCommands.get(commandId);
    if (existing) {
      existing.count++;
      existing.lastUsed = Date.now();
    } else {
      this.recentCommands.set(commandId, { count: 1, lastUsed: Date.now() });
    }
  }

  private adjustScroll(): void {
    const visibleHeight = 10; // Approximate visible items
    if (this.state.selectedIndex < this.state.scrollOffset) {
      this.state = { ...this.state, scrollOffset: this.state.selectedIndex };
    }
    if (this.state.selectedIndex >= this.state.scrollOffset + visibleHeight) {
      this.state = { ...this.state, scrollOffset: this.state.selectedIndex - visibleHeight + 1 };
    }
  }

  private refresh(): void {
    this.state = {
      ...this.state,
      results: this.scoreCommands(this.state.query, this.state.categoryFilter),
    };
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render(options: PaletteRenderOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];

    if (!this.state.isOpen) return lines;

    // Border top
    lines.push(fg('textMuted', `┌${'─'.repeat(width - 2)}┐`));

    // Search input
    const queryDisplay = this.state.query.length > 0
      ? fg('text', this.state.query)
      : dimFg('textMuted', 'Type a command...');
    const categoryBadge = this.state.categoryFilter
      ? ` ${fg('accent', `[${CATEGORY_LABEL[this.state.categoryFilter]}]`)}`
      : '';
    lines.push(`│ ${fg('accent', '❯')} ${queryDisplay}${categoryBadge}${' '.repeat(Math.max(0, width - 6 - this.state.query.length))}│`);

    // Separator
    lines.push(fg('textMuted', `├${'─'.repeat(width - 2)}┤`));

    // Results
    const maxItems = height - 5;
    const results = this.state.results;

    if (results.length === 0) {
      lines.push(`│ ${dimFg('textMuted', 'No matching commands')}${' '.repeat(Math.max(0, width - 24))}│`);
    } else {
      for (let i = this.state.scrollOffset; i < results.length && lines.length < height - 2; i++) {
        const item = results[i]!;
        const selected = i === this.state.selectedIndex;
        const line = this.renderCommandItem(item, selected, width - 4, fg, boldFg, dimFg, bg);
        lines.push(`│ ${line}${' '.repeat(Math.max(0, width - 4 - stripAnsiLen(line)))}│`);
      }
    }

    // Border bottom
    lines.push(fg('textMuted', `└${'─'.repeat(width - 2)}┘`));

    return lines;
  }

  private renderCommandItem(
    item: ScoredCommand,
    selected: boolean,
    maxWidth: number,
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string {
    const parts: string[] = [];

    // Selection indicator
    parts.push(selected ? fg('accent', '▸') : ' ');

    // Icon
    const icon = item.command.icon ?? CATEGORY_GLYPH[item.command.category];
    parts.push(`${icon} `);

    // Title with match highlighting
    const title = this.highlightMatches(item.command.title, item.matchIndices, selected, fg, boldFg);
    parts.push(title);

    // Shortcut hint (right-aligned, if space allows)
    if (item.command.shortcut) {
      const shortcutText = dimFg('textMuted', ` ${item.command.shortcut}`);
      parts.push(shortcutText);
    }

    return parts.join('');
  }

  private highlightMatches(
    text: string,
    indices: readonly number[],
    selected: boolean,
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
  ): string {
    if (indices.length === 0) {
      return selected ? boldFg('text', text) : fg('text', text);
    }

    const indexSet = new Set(indices);
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      if (indexSet.has(i)) {
        result += fg('accent', char);
      } else {
        result += selected ? boldFg('text', char) : fg('text', char);
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Default Commands
// ---------------------------------------------------------------------------

/**
 * Create the default command set for the TUI.
 */
export function createDefaultCommands(): PaletteCommand[] {
  return [
    // Navigation
    { id: 'nav.transcript', title: 'Go to Transcript', category: 'navigation', icon: '📜', enabled: true, tags: ['chat', 'messages', 'history'] },
    { id: 'nav.files', title: 'Go to File Explorer', category: 'navigation', icon: '📁', enabled: true, tags: ['files', 'tree', 'directory'] },
    { id: 'nav.git', title: 'Go to Git Panel', category: 'navigation', icon: '🌿', enabled: true, tags: ['git', 'branch', 'commit'] },
    { id: 'nav.agents', title: 'Go to Agent Swarm', category: 'navigation', icon: '🤖', enabled: true, tags: ['agents', 'swarm', 'parallel'] },
    { id: 'nav.settings', title: 'Go to Settings', category: 'navigation', icon: '⚙', enabled: true, tags: ['config', 'preferences'] },

    // Actions
    { id: 'action.compact', title: 'Compact Context', category: 'actions', icon: '🗜', enabled: true, shortcut: 'Ctrl+K', tags: ['context', 'tokens', 'shrink'] },
    { id: 'action.clear', title: 'Clear Transcript', category: 'actions', icon: '🧹', enabled: true, tags: ['clear', 'reset', 'clean'] },
    { id: 'action.export', title: 'Export Session', category: 'actions', icon: '📤', enabled: true, tags: ['save', 'download', 'markdown'] },
    { id: 'action.screenshot', title: 'Capture Screenshot', category: 'actions', icon: '📸', enabled: true, tags: ['image', 'capture', 'png'] },

    // Git
    { id: 'git.status', title: 'Git Status', category: 'git', icon: '📊', enabled: true, tags: ['status', 'changes'] },
    { id: 'git.commit', title: 'Git Commit', category: 'git', icon: '✅', enabled: true, shortcut: 'Ctrl+G C', tags: ['commit', 'save'] },
    { id: 'git.push', title: 'Git Push', category: 'git', icon: '🚀', enabled: true, shortcut: 'Ctrl+G P', tags: ['push', 'upload', 'remote'] },
    { id: 'git.pull', title: 'Git Pull', category: 'git', icon: '📥', enabled: true, tags: ['pull', 'fetch', 'update'] },
    { id: 'git.branch', title: 'Switch Branch', category: 'git', icon: '🔀', enabled: true, tags: ['branch', 'checkout', 'switch'] },
    { id: 'git.diff', title: 'View Diff', category: 'git', icon: '📝', enabled: true, tags: ['diff', 'changes', 'compare'] },
    { id: 'git.stash', title: 'Stash Changes', category: 'git', icon: '📦', enabled: true, tags: ['stash', 'save', 'temporary'] },

    // Agents
    { id: 'agent.spawn', title: 'Spawn Agent', category: 'agents', icon: '➕', enabled: true, tags: ['new', 'create', 'start'] },
    { id: 'agent.pause', title: 'Pause All Agents', category: 'agents', icon: '⏸', enabled: true, tags: ['pause', 'stop', 'halt'] },
    { id: 'agent.resume', title: 'Resume Agents', category: 'agents', icon: '▶', enabled: true, tags: ['resume', 'start', 'continue'] },
    { id: 'agent.logs', title: 'View Agent Logs', category: 'agents', icon: '📋', enabled: true, tags: ['logs', 'output', 'history'] },

    // View
    { id: 'view.zen', title: 'Toggle Zen Mode', category: 'view', icon: '🧘', enabled: true, shortcut: 'Ctrl+Z', tags: ['focus', 'minimal', 'distraction'] },
    { id: 'view.split', title: 'Toggle Split View', category: 'view', icon: '◫', enabled: true, tags: ['split', 'pane', 'side'] },
    { id: 'view.timeline', title: 'Toggle Timeline', category: 'view', icon: '📈', enabled: true, tags: ['timeline', 'activity', 'history'] },
    { id: 'view.theme', title: 'Cycle Theme', category: 'view', icon: '🎨', enabled: true, tags: ['theme', 'color', 'dark', 'light'] },

    // Session
    { id: 'session.new', title: 'New Session', category: 'session', icon: '✨', enabled: true, shortcut: 'Ctrl+N', tags: ['new', 'create', 'start'] },
    { id: 'session.save', title: 'Save Session', category: 'session', icon: '💾', enabled: true, shortcut: 'Ctrl+S', tags: ['save', 'persist'] },
    { id: 'session.restore', title: 'Restore Session', category: 'session', icon: '🔄', enabled: true, tags: ['restore', 'load', 'resume'] },

    // Help
    { id: 'help.shortcuts', title: 'Keyboard Shortcuts', category: 'help', icon: '⌨', enabled: true, shortcut: '?', tags: ['keys', 'bindings', 'hotkeys'] },
    { id: 'help.docs', title: 'Open Documentation', category: 'help', icon: '📖', enabled: true, tags: ['docs', 'manual', 'guide'] },
    { id: 'help.diagnostics', title: 'Terminal Diagnostics', category: 'help', icon: '🔍', enabled: true, tags: ['debug', 'terminal', 'capabilities'] },
  ];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}
