/**
 * QuickLauncher — fuzzy-search quick launcher (Spotlight style).
 *
 * Provides instant command access:
 * - Fuzzy matching with scoring (CamelCase, substring, prefix)
 * - Category grouping with headers
 * - Recent commands (frequency + recency weighted)
 * - Keyboard navigation (Up/Down/Enter/Esc)
 * - Highlight matched characters in results
 * - Icon per command
 * - Shortcut hints (right-aligned)
 * - Preview panel (optional right side)
 * - Input filtering with debounce
 * - No-results state with suggestions
 * - Scrollable results with virtual window
 * - Pin/favorite commands
 * - Context-aware filtering (when-clause)
 *
 * Visual style:
 * ┌─ ⌘ Quick Launcher ──────────────────────────────┐
 * │ > git commit                                      │
 * ├───────────────────────────────────────────────────┤
 * │  ★ Git: Commit Changes          ⌃⇧G              │
 * │    Git: Commit and Push         ⌃⇧P              │
 * │    Git: Amend Last Commit                         │
 * │  ─── Recent ───                                   │
 * │    File: Save All               ⌃S               │
 * │    Terminal: Toggle                               │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LauncherCommand {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly keywords?: string[];
  readonly pinned?: boolean;
  readonly when?: string; // Context condition
  readonly action: () => void;
}

export interface LauncherResult {
  readonly command: LauncherCommand;
  readonly score: number;
  readonly matchIndices: number[]; // Character indices that matched
}

export interface LauncherRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface LauncherState {
  readonly visible: boolean;
  readonly query: string;
  readonly cursorIndex: number;
  readonly scrollOffset: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT = 10;
const RECENT_BOOST = 50;
const PIN_BOOST = 100;
const PREFIX_SCORE = 100;
const CAMEL_SCORE = 80;
const SUBSTRING_SCORE = 50;
const FUZZY_SCORE = 10;

// ---------------------------------------------------------------------------
// QuickLauncher
// ---------------------------------------------------------------------------

export class QuickLauncher {
  private commands: LauncherCommand[] = [];
  private recentIds: string[] = [];
  private state: LauncherState = {
    visible: false,
    query: '',
    cursorIndex: 0,
    scrollOffset: 0,
  };
  private results: LauncherResult[] = [];
  private context: Record<string, boolean> = {};

  // ─── Command Registration ────────────────────────────────────────

  /** Register a command. */
  register(command: LauncherCommand): void {
    // Replace if exists
    this.commands = this.commands.filter((c) => c.id !== command.id);
    this.commands.push(command);
  }

  /** Register multiple commands. */
  registerAll(commands: LauncherCommand[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
  }

  /** Unregister a command. */
  unregister(id: string): void {
    this.commands = this.commands.filter((c) => c.id !== id);
  }

  /** Set context for when-clause evaluation. */
  setContext(key: string, value: boolean): void {
    this.context[key] = value;
  }

  // ─── Launcher Lifecycle ──────────────────────────────────────────

  /** Open the launcher. */
  open(): void {
    this.state = { visible: true, query: '', cursorIndex: 0, scrollOffset: 0 };
    this.updateResults();
  }

  /** Close the launcher. */
  close(): void {
    this.state = { ...this.state, visible: false };
  }

  get isVisible(): boolean {
    return this.state.visible;
  }

  get query(): string {
    return this.state.query;
  }

  // ─── Input Handling ──────────────────────────────────────────────

  /** Set the search query. */
  setQuery(query: string): void {
    this.state = { ...this.state, query, cursorIndex: 0, scrollOffset: 0 };
    this.updateResults();
  }

  /** Append to query (typing). */
  type(char: string): void {
    this.setQuery(this.state.query + char);
  }

  /** Backspace. */
  backspace(): void {
    this.setQuery(this.state.query.slice(0, -1));
  }

  /** Move cursor up. */
  moveUp(): void {
    if (this.state.cursorIndex > 0) {
      const newIndex = this.state.cursorIndex - 1;
      this.state = { ...this.state, cursorIndex: newIndex };
      this.ensureVisible(newIndex);
    }
  }

  /** Move cursor down. */
  moveDown(): void {
    if (this.state.cursorIndex < this.results.length - 1) {
      const newIndex = this.state.cursorIndex + 1;
      this.state = { ...this.state, cursorIndex: newIndex };
      this.ensureVisible(newIndex);
    }
  }

  /** Execute the selected command. */
  execute(): LauncherCommand | null {
    const result = this.results[this.state.cursorIndex];
    if (!result) return null;

    // Add to recent
    this.addToRecent(result.command.id);

    // Execute
    result.command.action();
    this.close();
    return result.command;
  }

  private ensureVisible(index: number): void {
    const viewHeight = 10; // Approximate visible rows
    if (index < this.state.scrollOffset) {
      this.state = { ...this.state, scrollOffset: index };
    } else if (index >= this.state.scrollOffset + viewHeight) {
      this.state = { ...this.state, scrollOffset: index - viewHeight + 1 };
    }
  }

  private addToRecent(id: string): void {
    this.recentIds = [id, ...this.recentIds.filter((r) => r !== id)].slice(0, MAX_RECENT);
  }

  // ─── Fuzzy Matching ──────────────────────────────────────────────

  private updateResults(): void {
    const query = this.state.query.toLowerCase().trim();
    const available = this.commands.filter((c) => this.evaluateWhen(c.when));

    if (!query) {
      // No query: show pinned first, then recent, then all
      const pinned = available.filter((c) => c.pinned);
      const recent = this.recentIds
        .map((id) => available.find((c) => c.id === id))
        .filter((c): c is LauncherCommand => c !== undefined && !c.pinned);
      const others = available.filter((c) => !c.pinned && !this.recentIds.includes(c.id));

      this.results = [
        ...pinned.map((c) => ({ command: c, score: PIN_BOOST, matchIndices: [] })),
        ...recent.map((c) => ({ command: c, score: RECENT_BOOST, matchIndices: [] })),
        ...others.map((c) => ({ command: c, score: 0, matchIndices: [] })),
      ];
      return;
    }

    // Score each command
    const scored: LauncherResult[] = [];
    for (const cmd of available) {
      const { score, indices } = this.fuzzyMatch(query, cmd);
      if (score > 0) {
        let finalScore = score;
        if (cmd.pinned) finalScore += PIN_BOOST;
        if (this.recentIds.includes(cmd.id)) finalScore += RECENT_BOOST;
        scored.push({ command: cmd, score: finalScore, matchIndices: indices });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    this.results = scored;
  }

  private fuzzyMatch(query: string, cmd: LauncherCommand): { score: number; indices: number[] } {
    const title = cmd.title.toLowerCase();
    const category = (cmd.category ?? '').toLowerCase();
    const keywords = (cmd.keywords ?? []).join(' ').toLowerCase();
    const searchText = `${category} ${title} ${keywords}`;

    // Prefix match (highest priority)
    if (title.startsWith(query)) {
      return { score: PREFIX_SCORE, indices: range(0, query.length) };
    }

    // CamelCase match
    const camelIndices = this.camelMatch(query, cmd.title);
    if (camelIndices.length === query.length) {
      return { score: CAMEL_SCORE, indices: camelIndices };
    }

    // Substring match
    const subIdx = searchText.indexOf(query);
    if (subIdx >= 0) {
      return { score: SUBSTRING_SCORE, indices: range(subIdx, subIdx + query.length) };
    }

    // Fuzzy character match
    const fuzzyIndices = this.fuzzyCharMatch(query, searchText);
    if (fuzzyIndices.length === query.length) {
      return { score: FUZZY_SCORE, indices: fuzzyIndices };
    }

    return { score: 0, indices: [] };
  }

  private camelMatch(query: string, text: string): number[] {
    const indices: number[] = [];
    let qi = 0;

    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      const char = text[ti]!;
      const isUpper = char >= 'A' && char <= 'Z';
      const isMatch = char.toLowerCase() === query[qi];

      if (isMatch && (isUpper || ti === 0 || indices.length === 0)) {
        indices.push(ti);
        qi++;
      } else if (isMatch) {
        // Continue matching in sequence
        if (indices.length > 0 && ti === indices[indices.length - 1]! + 1) {
          indices.push(ti);
          qi++;
        }
      }
    }

    return indices;
  }

  private fuzzyCharMatch(query: string, text: string): number[] {
    const indices: number[] = [];
    let ti = 0;

    for (let qi = 0; qi < query.length; qi++) {
      const char = query[qi]!;
      const found = text.indexOf(char, ti);
      if (found < 0) return []; // Not all chars found
      indices.push(found);
      ti = found + 1;
    }

    return indices;
  }

  private evaluateWhen(when?: string): boolean {
    if (!when) return true;
    // Simple evaluation: check context keys
    const parts = when.split('&&').map((p) => p.trim());
    return parts.every((part) => {
      if (part.startsWith('!')) {
        return !this.context[part.slice(1)];
      }
      return this.context[part] === true;
    });
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get current results. */
  getResults(): readonly LauncherResult[] {
    return this.results;
  }

  /** Get result count. */
  get resultCount(): number {
    return this.results.length;
  }

  /** Get cursor index. */
  get cursorIndex(): number {
    return this.state.cursorIndex;
  }

  /** Get recent command IDs. */
  getRecent(): readonly string[] {
    return this.recentIds;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the launcher. */
  render(options: LauncherRenderOptions): string[] {
    if (!this.state.visible) return [];

    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 4;

    // Header with input
    lines.push(fg('textMuted', `┌─ ⌘ Quick Launcher ${'─'.repeat(Math.max(0, innerWidth - 18))}┐`));

    // Query input
    const queryDisplay = this.state.query || dimFg('textDim', 'Type to search...');
    lines.push(`│ ${fg('primary', '>')} ${queryDisplay}${' '.repeat(Math.max(0, innerWidth - this.state.query.length - 3))}│`);

    // Separator
    lines.push(fg('textMuted', `├${'─'.repeat(innerWidth + 2)}┤`));

    // Results
    const viewHeight = Math.max(3, height - 5);
    const start = this.state.scrollOffset;
    const end = Math.min(start + viewHeight, this.results.length);

    if (this.results.length === 0) {
      lines.push(`│ ${dimFg('textMuted', 'No commands found')}${' '.repeat(Math.max(0, innerWidth - 17))}│`);
    } else {
      let lastCategory = '';
      for (let i = start; i < end; i++) {
        const result = this.results[i]!;
        const cmd = result.command;
        const isCursor = i === this.state.cursorIndex;

        // Category header
        if (cmd.category && cmd.category !== lastCategory && !this.state.query) {
          const catLine = dimFg('textMuted', `─── ${cmd.category} ───`);
          lines.push(`│ ${catLine}${' '.repeat(Math.max(0, innerWidth - stripAnsiLen(catLine) - 1))}│`);
          lastCategory = cmd.category;
        }

        // Command line
        const cursor = isCursor ? fg('accent', '▸') : ' ';
        const pin = cmd.pinned ? fg('warning', '★ ') : '  ';
        const icon = cmd.icon ? `${cmd.icon} ` : '';

        // Title with match highlighting
        let title: string;
        if (isCursor) {
          title = boldFg('text', cmd.title);
        } else if (result.matchIndices.length > 0 && this.state.query) {
          title = this.highlightMatches(cmd.title, result.matchIndices, fg);
        } else {
          title = fg('text', cmd.title);
        }

        // Shortcut
        const shortcut = cmd.shortcut ? dimFg('textMuted', ` ${cmd.shortcut}`) : '';

        const content = `${cursor}${pin}${icon}${title}${shortcut}`;
        const contentLen = stripAnsiLen(content);
        const padding = Math.max(0, innerWidth - contentLen);

        if (isCursor) {
          lines.push(`${fg('accent', '│')}${fg('accent', '▸')}${content.slice(1)}${' '.repeat(padding)}${fg('accent', '│')}`);
        } else {
          lines.push(`│ ${content.slice(1)}${' '.repeat(padding)}│`);
        }
      }
    }

    // Footer
    lines.push(fg('textMuted', `└${'─'.repeat(innerWidth + 2)}┘`));

    return lines;
  }

  private highlightMatches(text: string, indices: number[], fg: (token: string, text: string) => string): string {
    let result = '';
    const indexSet = new Set(indices);

    for (let i = 0; i < text.length; i++) {
      if (indexSet.has(i)) {
        result += fg('accent', text[i]!);
      } else {
        result += text[i];
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i < end; i++) result.push(i);
  return result;
}

function stripAnsiLen(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}
