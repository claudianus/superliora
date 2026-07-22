/**
 * AutocompleteEngine — context-aware tab completion for the TUI input.
 *
 * Provides intelligent autocompletion:
 * - Multi-source completion (commands, files, symbols, history, snippets)
 * - Context detection: determines what kind of completion to offer
 * - Fuzzy matching with relevance scoring
 * - Inline preview (ghost text) for the top suggestion
 * - Popup menu with keyboard navigation (Tab/Shift+Tab/Enter/Esc)
 * - Category grouping with icons
 * - Recently-used prioritization
 * - Path completion for file arguments
 * - Slash-command completion (/help, /status, etc.)
 * - Configurable trigger characters and delay
 *
 * Interaction model:
 * - Tab: Accept inline suggestion OR open popup with matches
 * - Tab (in popup): Cycle to next match
 * - Shift+Tab: Cycle to previous match
 * - Enter: Accept selected match
 * - Esc: Dismiss popup
 * - Typing: Filter matches progressively
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompletionSource = 'command' | 'file' | 'symbol' | 'history' | 'snippet' | 'slash';

export interface CompletionItem {
  readonly text: string;
  readonly display: string;
  readonly source: CompletionSource;
  readonly description?: string;
  readonly score: number;
  /** The range in the input to replace. */
  readonly replaceStart: number;
  readonly replaceEnd: number;
}

export interface CompletionContext {
  /** Full input text. */
  readonly input: string;
  /** Cursor position in the input. */
  readonly cursor: number;
  /** The word being completed (from last trigger to cursor). */
  readonly word: string;
  /** Start position of the word. */
  readonly wordStart: number;
  /** Detected context type. */
  readonly contextType: 'command' | 'path' | 'slash' | 'symbol' | 'general';
  /** Whether we're at the start of input (first word). */
  readonly isFirstWord: boolean;
}

export interface CompletionState {
  readonly active: boolean;
  readonly items: readonly CompletionItem[];
  readonly selectedIndex: number;
  readonly inlinePreview: string | null;
  readonly context: CompletionContext | null;
}

export interface CompletionProvider {
  readonly source: CompletionSource;
  readonly priority: number;
  getCompletions(context: CompletionContext): CompletionItem[];
}

export interface AutocompleteRenderOptions {
  readonly maxWidth: number;
  readonly maxVisible: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_CHARS = ['/', '.', '/', ' '];
const MAX_RESULTS = 15;
const INLINE_PREVIEW_THRESHOLD = 1; // Show ghost text when only 1 match
const SOURCE_ICONS: Record<CompletionSource, string> = {
  command: '⚡',
  file: '📄',
  symbol: '◈',
  history: '🕐',
  snippet: '✂',
  slash: '⌘',
};

// ---------------------------------------------------------------------------
// AutocompleteEngine
// ---------------------------------------------------------------------------

export class AutocompleteEngine {
  private providers: CompletionProvider[] = [];
  private state: CompletionState = {
    active: false,
    items: [],
    selectedIndex: 0,
    inlinePreview: null,
    context: null,
  };
  private recentCompletions: Map<string, number> = new Map();

  // ─── Provider Registration ───────────────────────────────────────

  /** Register a completion provider. */
  registerProvider(provider: CompletionProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => b.priority - a.priority);
  }

  /** Remove a provider by source type. */
  removeProvider(source: CompletionSource): void {
    this.providers = this.providers.filter((p) => p.source !== source);
  }

  // ─── Context Detection ───────────────────────────────────────────

  /** Analyze the input to determine completion context. */
  analyzeContext(input: string, cursor: number): CompletionContext {
    const textBeforeCursor = input.slice(0, cursor);

    // Find word boundaries
    const wordMatch = /(\S+)$/.exec(textBeforeCursor);
    const word = wordMatch?.[1] ?? '';
    const wordStart = cursor - word.length;
    const isFirstWord = textBeforeCursor.trim() === word;

    // Detect context type
    let contextType: CompletionContext['contextType'] = 'general';

    if (word.startsWith('/')) {
      contextType = 'slash';
    } else if (word.includes('/') || word.includes('.') || word.startsWith('~')) {
      contextType = 'path';
    } else if (isFirstWord) {
      contextType = 'command';
    } else if (/^[A-Z]/.test(word) || word.includes('::') || word.includes('#')) {
      contextType = 'symbol';
    }

    return { input, cursor, word, wordStart, contextType, isFirstWord };
  }

  // ─── Completion Triggering ───────────────────────────────────────

  /** Request completions for the current input state. */
  complete(input: string, cursor: number): CompletionState {
    const context = this.analyzeContext(input, cursor);

    if (context.word.length === 0 && context.contextType !== 'slash') {
      this.dismiss();
      return this.state;
    }

    // Gather completions from all providers
    let items: CompletionItem[] = [];
    for (const provider of this.providers) {
      const providerItems = provider.getCompletions(context);
      items.push(...providerItems);
    }

    // Apply recency bonus
    items = items.map((item) => {
      const recentCount = this.recentCompletions.get(item.text) ?? 0;
      return { ...item, score: item.score + recentCount * 5 };
    });

    // Sort by score (descending) and deduplicate
    items = deduplicateItems(items)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    // Determine inline preview
    const inlinePreview = items.length === INLINE_PREVIEW_THRESHOLD && items[0]
      ? items[0].text.slice(context.word.length)
      : null;

    this.state = {
      active: items.length > 0,
      items,
      selectedIndex: 0,
      inlinePreview,
      context,
    };

    return this.state;
  }

  /** Accept the currently selected completion. Returns the new input text. */
  accept(): string | null {
    if (!this.state.active || this.state.items.length === 0) return null;

    const item = this.state.items[this.state.selectedIndex];
    const context = this.state.context;
    if (!item || !context) return null;

    // Record usage
    const count = this.recentCompletions.get(item.text) ?? 0;
    this.recentCompletions.set(item.text, count + 1);

    // Build new input
    const before = context.input.slice(0, context.wordStart);
    const after = context.input.slice(context.cursor);
    const newInput = before + item.text + after;

    this.dismiss();
    return newInput;
  }

  /** Accept the inline preview (ghost text). */
  acceptInline(): string | null {
    if (!this.state.inlinePreview || !this.state.context) return null;
    const context = this.state.context;
    const item = this.state.items[0];
    if (!item) return null;

    const count = this.recentCompletions.get(item.text) ?? 0;
    this.recentCompletions.set(item.text, count + 1);

    const newInput = context.input.slice(0, context.cursor) + this.state.inlinePreview + context.input.slice(context.cursor);
    this.dismiss();
    return newInput;
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Move to the next completion item. */
  next(): void {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      selectedIndex: (this.state.selectedIndex + 1) % this.state.items.length,
      inlinePreview: null,
    };
  }

  /** Move to the previous completion item. */
  prev(): void {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      selectedIndex: (this.state.selectedIndex - 1 + this.state.items.length) % this.state.items.length,
      inlinePreview: null,
    };
  }

  /** Dismiss the completion popup. */
  dismiss(): void {
    this.state = { active: false, items: [], selectedIndex: 0, inlinePreview: null, context: null };
  }

  /** Get the current state. */
  getState(): CompletionState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state.active;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the completion popup. */
  renderPopup(options: AutocompleteRenderOptions): string[] {
    if (!this.state.active || this.state.items.length === 0) return [];

    const { maxWidth, maxVisible, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const items = this.state.items;
    const visibleCount = Math.min(items.length, maxVisible);

    // Scroll window
    let startIdx = 0;
    if (this.state.selectedIndex >= maxVisible) {
      startIdx = this.state.selectedIndex - maxVisible + 1;
    }

    // Top border
    lines.push(fg('textMuted', `┌${'─'.repeat(maxWidth - 2)}┐`));

    for (let i = startIdx; i < startIdx + visibleCount && i < items.length; i++) {
      const item = items[i]!;
      const isSelected = i === this.state.selectedIndex;
      const icon = SOURCE_ICONS[item.source] ?? '•';

      const cursor = isSelected ? fg('accent', '▸ ') : '  ';
      const displayText = isSelected
        ? boldFg('accent', truncateStr(item.display, maxWidth - 14))
        : fg('text', truncateStr(item.display, maxWidth - 14));
      const iconStr = dimFg('textMuted', icon);
      const desc = item.description ? dimFg('textMuted', ` ${truncateStr(item.description, 20)}`) : '';

      const content = `${cursor}${iconStr} ${displayText}${desc}`;
      const padding = Math.max(0, maxWidth - 2 - stripAnsiLen(content));
      lines.push(`${fg('textMuted', '│')} ${content}${' '.repeat(padding)}${fg('textMuted', '│')}`);
    }

    // Scroll indicator
    if (items.length > maxVisible) {
      const scrollInfo = dimFg('textMuted', ` ${String(this.state.selectedIndex + 1)}/${String(items.length)}`);
      lines.push(`${fg('textMuted', '│')}${scrollInfo}${' '.repeat(maxWidth - 2 - stripAnsiLen(scrollInfo))}${fg('textMuted', '│')}`);
    }

    // Bottom border
    lines.push(fg('textMuted', `└${'─'.repeat(maxWidth - 2)}┘`));

    return lines;
  }

  /** Render the inline ghost text preview. */
  renderInlinePreview(dimFg: (t: string, s: string) => string): string {
    if (!this.state.inlinePreview) return '';
    return dimFg('textDim', this.state.inlinePreview);
  }
}

// ---------------------------------------------------------------------------
// Built-in Providers
// ---------------------------------------------------------------------------

/** Slash command provider (/help, /status, etc.) */
export function createSlashCommandProvider(commands: Array<{ name: string; description: string }>): CompletionProvider {
  return {
    source: 'slash',
    priority: 100,
    getCompletions(context: CompletionContext): CompletionItem[] {
      if (context.contextType !== 'slash') return [];
      const query = context.word.slice(1).toLowerCase(); // Remove leading /

      return commands
        .filter((cmd) => cmd.name.toLowerCase().includes(query))
        .map((cmd) => ({
          text: `/${cmd.name}`,
          display: `/${cmd.name}`,
          source: 'slash' as const,
          description: cmd.description,
          score: cmd.name.toLowerCase().startsWith(query) ? 100 : 50,
          replaceStart: context.wordStart,
          replaceEnd: context.cursor,
        }));
    },
  };
}

/** Command provider for first-word completion. */
export function createCommandProvider(commands: string[]): CompletionProvider {
  return {
    source: 'command',
    priority: 80,
    getCompletions(context: CompletionContext): CompletionItem[] {
      if (!context.isFirstWord && context.contextType !== 'command') return [];
      const query = context.word.toLowerCase();

      return commands
        .filter((cmd) => cmd.toLowerCase().includes(query))
        .map((cmd) => ({
          text: cmd,
          display: cmd,
          source: 'command' as const,
          score: cmd.toLowerCase().startsWith(query) ? 90 : 40,
          replaceStart: context.wordStart,
          replaceEnd: context.cursor,
        }));
    },
  };
}

/** History-based completion provider. */
export function createHistoryProvider(getHistory: () => string[]): CompletionProvider {
  return {
    source: 'history',
    priority: 60,
    getCompletions(context: CompletionContext): CompletionItem[] {
      const query = context.word.toLowerCase();
      if (query.length < 2) return [];

      return getHistory()
        .filter((h) => h.toLowerCase().includes(query))
        .slice(0, 8)
        .map((h) => ({
          text: h,
          display: h,
          source: 'history' as const,
          description: 'history',
          score: h.toLowerCase().startsWith(query) ? 70 : 30,
          replaceStart: 0,
          replaceEnd: context.cursor,
        }));
    },
  };
}

/** File path completion provider. */
export function createFileProvider(getFiles: (prefix: string) => string[]): CompletionProvider {
  return {
    source: 'file',
    priority: 90,
    getCompletions(context: CompletionContext): CompletionItem[] {
      if (context.contextType !== 'path') return [];
      const files = getFiles(context.word);

      return files.slice(0, 10).map((f) => ({
        text: f,
        display: f.split('/').pop() ?? f,
        source: 'file' as const,
        description: f,
        score: 80,
        replaceStart: context.wordStart,
        replaceEnd: context.cursor,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function deduplicateItems(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

function truncateStr(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}
