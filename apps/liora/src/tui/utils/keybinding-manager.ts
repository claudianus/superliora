/**
 * KeybindingManager — configurable keyboard shortcuts with chord support.
 *
 * Provides a comprehensive keybinding system:
 * - Key sequence parsing (Ctrl+Shift+K, Meta+Enter, etc.)
 * - Chord support: multi-key sequences (Ctrl+K Ctrl+S like VS Code)
 * - Conflict detection and resolution
 * - Contextual bindings (different shortcuts per mode/panel)
 * - Default + user override layers
 * - Keybinding serialization/deserialization (JSON config)
 * - Human-readable display formatting
 * - When-clause evaluation (focus, mode, panel conditions)
 * - Platform-aware defaults (macOS Cmd vs Linux/Win Ctrl)
 *
 * Key notation:
 * - Modifiers: Ctrl, Shift, Alt, Meta (Cmd on macOS)
 * - Special: Enter, Escape, Tab, Space, Backspace, Delete
 * - Arrows: Up, Down, Left, Right
 * - Function: F1-F12
 * - Chord separator: Space between sequences ("Ctrl+K Ctrl+S")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedKey {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly key: string; // Normalized key name
}

export interface KeyBinding {
  readonly id: string;
  readonly command: string;
  readonly keys: readonly ParsedKey[]; // Sequence (chord)
  readonly when?: string; // When-clause expression
  readonly context?: string; // Context scope (e.g., 'editor', 'terminal')
  readonly source: 'default' | 'user';
  readonly enabled: boolean;
}

export interface KeyConflict {
  readonly keys: string;
  readonly bindings: readonly KeyBinding[];
  readonly context?: string;
}

export interface KeybindContext {
  readonly mode?: string;
  readonly focusedPanel?: string;
  readonly [key: string]: string | boolean | undefined;
}

export interface KeybindRenderOptions {
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt', 'meta'] as const;

const KEY_ALIASES: Record<string, string> = {
  'return': 'Enter',
  'cr': 'Enter',
  'esc': 'Escape',
  'del': 'Delete',
  'ins': 'Insert',
  'pgup': 'PageUp',
  'pgdn': 'PageDown',
  'pageup': 'PageUp',
  'pagedown': 'PageDown',
  'home': 'Home',
  'end': 'End',
  'space': 'Space',
  'spc': 'Space',
  'bs': 'Backspace',
  'backspace': 'Backspace',
  'tab': 'Tab',
  'up': 'Up',
  'down': 'Down',
  'left': 'Left',
  'right': 'Right',
};

const DISPLAY_SYMBOLS: Record<string, string> = {
  ctrl: '⌃',
  shift: '⇧',
  alt: '⌥',
  meta: '⌘',
  Enter: '↵',
  Escape: 'Esc',
  Tab: '⇥',
  Space: '␣',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

// ---------------------------------------------------------------------------
// KeybindingManager
// ---------------------------------------------------------------------------

export class KeybindingManager {
  private bindings: KeyBinding[] = [];
  private pendingChord: ParsedKey[] = [];
  private chordTimeout: number = 1000; // ms to wait for next chord key
  private lastChordTime = 0;

  // ─── Key Parsing ─────────────────────────────────────────────────

  /** Parse a key notation string into a ParsedKey. */
  parseKey(notation: string): ParsedKey {
    const parts = notation.split('+').map((p) => p.trim());
    let ctrl = false, shift = false, alt = false, meta = false;
    let key = '';

    for (const part of parts) {
      const lower = part.toLowerCase();
      switch (lower) {
        case 'ctrl': case 'control': ctrl = true; break;
        case 'shift': shift = true; break;
        case 'alt': case 'option': alt = true; break;
        case 'meta': case 'cmd': case 'command': case 'super': meta = true; break;
        default:
          key = KEY_ALIASES[lower] ?? part;
          break;
      }
    }

    return { ctrl, shift, alt, meta, key };
  }

  /** Parse a full key sequence (may include chords separated by space). */
  parseSequence(sequence: string): ParsedKey[] {
    return sequence.split(/\s+/).map((part) => this.parseKey(part));
  }

  /** Format a ParsedKey back to notation string. */
  formatKey(parsed: ParsedKey): string {
    const parts: string[] = [];
    if (parsed.ctrl) parts.push('Ctrl');
    if (parsed.shift) parts.push('Shift');
    if (parsed.alt) parts.push('Alt');
    if (parsed.meta) parts.push('Meta');
    parts.push(parsed.key);
    return parts.join('+');
  }

  /** Format a key sequence for display. */
  formatSequence(keys: readonly ParsedKey[]): string {
    return keys.map((k) => this.formatKey(k)).join(' ');
  }

  /** Format a key for compact display (symbols). */
  formatSymbol(parsed: ParsedKey): string {
    let result = '';
    if (parsed.ctrl) result += DISPLAY_SYMBOLS['ctrl'] ?? 'C-';
    if (parsed.shift) result += DISPLAY_SYMBOLS['shift'] ?? 'S-';
    if (parsed.alt) result += DISPLAY_SYMBOLS['alt'] ?? 'A-';
    if (parsed.meta) result += DISPLAY_SYMBOLS['meta'] ?? 'M-';
    result += DISPLAY_SYMBOLS[parsed.key] ?? parsed.key;
    return result;
  }

  /** Format a sequence with symbols. */
  formatSequenceSymbols(keys: readonly ParsedKey[]): string {
    return keys.map((k) => this.formatSymbol(k)).join(' ');
  }

  // ─── Binding Registration ────────────────────────────────────────

  /** Register a keybinding. */
  register(options: {
    id: string;
    command: string;
    keys: string;
    when?: string;
    context?: string;
    source?: 'default' | 'user';
  }): KeyBinding {
    const binding: KeyBinding = {
      id: options.id,
      command: options.command,
      keys: this.parseSequence(options.keys),
      when: options.when,
      context: options.context,
      source: options.source ?? 'default',
      enabled: true,
    };

    // Remove existing binding with same ID
    this.bindings = this.bindings.filter((b) => b.id !== binding.id);
    this.bindings.push(binding);
    return binding;
  }

  /** Register multiple default keybindings. */
  registerDefaults(bindings: Array<{ id: string; command: string; keys: string; when?: string; context?: string }>): void {
    for (const b of bindings) {
      this.register({ ...b, source: 'default' });
    }
  }

  /** Override a binding with user preference. */
  userOverride(id: string, newKeys: string): void {
    const existing = this.bindings.find((b) => b.id === id);
    if (existing) {
      this.bindings = this.bindings.filter((b) => b.id !== id);
      this.bindings.push({ ...existing, keys: this.parseSequence(newKeys), source: 'user' });
    }
  }

  /** Unbind a keybinding by ID. */
  unbind(id: string): boolean {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter((b) => b.id !== id);
    return this.bindings.length < before;
  }

  /** Enable/disable a binding. */
  setEnabled(id: string, enabled: boolean): void {
    const binding = this.bindings.find((b) => b.id === id);
    if (binding) {
      this.bindings = this.bindings.map((b) => b.id === id ? { ...b, enabled } : b);
    }
  }

  // ─── Key Resolution ──────────────────────────────────────────────

  /** Resolve a key press to a command. Handles chords. */
  resolve(key: ParsedKey, context: KeybindContext = {}): { command: string | null; pending: boolean } {
    const now = Date.now();

    // Reset chord if timeout exceeded
    if (this.pendingChord.length > 0 && now - this.lastChordTime > this.chordTimeout) {
      this.pendingChord = [];
    }

    const sequence = [...this.pendingChord, key];
    this.lastChordTime = now;

    // Find matching bindings
    const matches = this.findMatches(sequence, context);

    if (matches.length === 0) {
      this.pendingChord = [];
      return { command: null, pending: false };
    }

    // Check for exact match (sequence length matches)
    const exact = matches.filter((m) => m.keys.length === sequence.length);
    // Check for prefix match (binding has more keys in sequence)
    const prefix = matches.filter((m) => m.keys.length > sequence.length);

    if (exact.length > 0 && prefix.length === 0) {
      // Unambiguous exact match
      this.pendingChord = [];
      return { command: exact[0]!.command, pending: false };
    }

    if (prefix.length > 0) {
      // Could be a chord — wait for more keys
      this.pendingChord = sequence;
      return { command: null, pending: true };
    }

    if (exact.length > 0) {
      // Exact match wins over prefix
      this.pendingChord = [];
      return { command: exact[0]!.command, pending: false };
    }

    this.pendingChord = [];
    return { command: null, pending: false };
  }

  /** Reset any pending chord state. */
  resetChord(): void {
    this.pendingChord = [];
  }

  get isPendingChord(): boolean {
    return this.pendingChord.length > 0;
  }

  private findMatches(sequence: ParsedKey[], context: KeybindContext): KeyBinding[] {
    return this.bindings.filter((binding) => {
      if (!binding.enabled) return false;

      // Check context
      if (binding.context && context.focusedPanel !== binding.context) return false;

      // Check when-clause
      if (binding.when && !this.evaluateWhen(binding.when, context)) return false;

      // Check key sequence prefix match
      if (binding.keys.length < sequence.length) return false;
      for (let i = 0; i < sequence.length; i++) {
        if (!keysEqual(binding.keys[i]!, sequence[i]!)) return false;
      }
      return true;
    });
  }

  // ─── When-Clause Evaluation ──────────────────────────────────────

  /** Evaluate a when-clause expression against context. */
  evaluateWhen(expression: string, context: KeybindContext): boolean {
    // Support: key, !key, key == value, key != value, &&, ||
    const orParts = expression.split('||').map((s) => s.trim());

    for (const orPart of orParts) {
      const andParts = orPart.split('&&').map((s) => s.trim());
      let allTrue = true;

      for (const part of andParts) {
        if (!this.evaluateCondition(part, context)) {
          allTrue = false;
          break;
        }
      }

      if (allTrue) return true;
    }

    return false;
  }

  private evaluateCondition(condition: string, context: KeybindContext): boolean {
    // Negation
    if (condition.startsWith('!')) {
      return !this.evaluateCondition(condition.slice(1), context);
    }

    // Equality
    const eqMatch = /^(\w+)\s*==\s*(.+)$/.exec(condition);
    if (eqMatch) {
      const key = eqMatch[1] ?? '';
      const value = eqMatch[2] ?? '';
      return String(context[key] ?? '') === value;
    }

    // Inequality
    const neqMatch = /^(\w+)\s*!=\s*(.+)$/.exec(condition);
    if (neqMatch) {
      const key = neqMatch[1] ?? '';
      const value = neqMatch[2] ?? '';
      return String(context[key] ?? '') !== value;
    }

    // Simple truthy check
    return Boolean(context[condition]);
  }

  // ─── Conflict Detection ──────────────────────────────────────────

  /** Detect all keybinding conflicts. */
  detectConflicts(): KeyConflict[] {
    const conflicts: KeyConflict[] = [];
    const keyMap = new Map<string, KeyBinding[]>();

    for (const binding of this.bindings) {
      if (!binding.enabled) continue;
      const keyStr = this.formatSequence(binding.keys) + (binding.context ? ` [${binding.context}]` : '');
      const existing = keyMap.get(keyStr) ?? [];
      existing.push(binding);
      keyMap.set(keyStr, existing);
    }

    for (const [keys, bindings] of keyMap) {
      if (bindings.length > 1) {
        conflicts.push({ keys, bindings, context: bindings[0]?.context });
      }
    }

    return conflicts;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all bindings for a command. */
  getBindingsForCommand(command: string): KeyBinding[] {
    return this.bindings.filter((b) => b.command === command && b.enabled);
  }

  /** Get all bindings in a context. */
  getBindingsForContext(context: string): KeyBinding[] {
    return this.bindings.filter((b) => (!b.context || b.context === context) && b.enabled);
  }

  /** Get all registered bindings. */
  getAllBindings(): readonly KeyBinding[] {
    return this.bindings;
  }

  /** Search bindings by keyword. */
  search(query: string): KeyBinding[] {
    const q = query.toLowerCase();
    return this.bindings.filter((b) =>
      b.command.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      this.formatSequence(b.keys).toLowerCase().includes(q)
    );
  }

  // ─── Serialization ───────────────────────────────────────────────

  /** Export user keybindings as JSON. */
  exportUserBindings(): string {
    const userBindings = this.bindings.filter((b) => b.source === 'user');
    return JSON.stringify(
      userBindings.map((b) => ({
        id: b.id,
        command: b.command,
        keys: this.formatSequence(b.keys),
        when: b.when,
        context: b.context,
      })),
      null,
      2,
    );
  }

  /** Import user keybindings from JSON. */
  importUserBindings(json: string): number {
    try {
      const items = JSON.parse(json) as Array<{ id: string; command: string; keys: string; when?: string; context?: string }>;
      let count = 0;
      for (const item of items) {
        this.register({ ...item, source: 'user' });
        count++;
      }
      return count;
    } catch {
      return 0;
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render a keybinding list (for settings/help view). */
  renderList(options: KeybindRenderOptions & { maxWidth?: number }): string[] {
    const { fg, boldFg, dimFg, maxWidth = 70 } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ' Keybindings'));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(maxWidth - 2, 50))));

    // Group by context
    const contexts = new Map<string, KeyBinding[]>();
    for (const b of this.bindings) {
      if (!b.enabled) continue;
      const ctx = b.context ?? 'global';
      const list = contexts.get(ctx) ?? [];
      list.push(b);
      contexts.set(ctx, list);
    }

    for (const [ctx, bindings] of contexts) {
      lines.push(fg('primary', ` [${ctx}]`));
      for (const b of bindings) {
        const keyStr = this.formatSequenceSymbols(b.keys);
        const keyDisplay = fg('accent', keyStr.padEnd(16));
        const cmdDisplay = fg('text', b.command);
        const sourceBadge = b.source === 'user' ? fg('warning', ' ●') : '';
        const whenStr = b.when ? dimFg('textMuted', ` when: ${b.when}`) : '';
        lines.push(`   ${keyDisplay} ${cmdDisplay}${sourceBadge}${whenStr}`);
      }
      lines.push('');
    }

    return lines;
  }

  /** Render a single key hint (for footer/tooltips). */
  renderKeyHint(keys: string, action: string, options: KeybindRenderOptions): string {
    const { fg, dimFg } = options;
    const parsed = this.parseSequence(keys);
    const symbol = this.formatSequenceSymbols(parsed);
    return `${fg('accent', symbol)} ${dimFg('textMuted', action)}`;
  }

  /** Render pending chord indicator. */
  renderChordIndicator(options: KeybindRenderOptions): string {
    if (this.pendingChord.length === 0) return '';
    const { fg, dimFg } = options;
    const chordStr = this.formatSequenceSymbols(this.pendingChord);
    return fg('warning', `(${chordStr})`) + dimFg('textMuted', ' waiting…');
  }
}

// ---------------------------------------------------------------------------
// Default Keybindings
// ---------------------------------------------------------------------------

export function createDefaultKeybindings(): Array<{ id: string; command: string; keys: string; when?: string; context?: string }> {
  return [
    // Navigation
    { id: 'nav.up', command: 'cursorUp', keys: 'Ctrl+K', when: 'mode == normal' },
    { id: 'nav.down', command: 'cursorDown', keys: 'Ctrl+J', when: 'mode == normal' },
    { id: 'nav.left', command: 'cursorLeft', keys: 'Ctrl+H', when: 'mode == normal' },
    { id: 'nav.right', command: 'cursorRight', keys: 'Ctrl+L', when: 'mode == normal' },
    // Panes
    { id: 'pane.splitV', command: 'splitVertical', keys: 'Ctrl+Shift+V' },
    { id: 'pane.splitH', command: 'splitHorizontal', keys: 'Ctrl+Shift+H' },
    { id: 'pane.close', command: 'closePane', keys: 'Ctrl+W' },
    { id: 'pane.next', command: 'nextPane', keys: 'Ctrl+Tab' },
    { id: 'pane.prev', command: 'prevPane', keys: 'Ctrl+Shift+Tab' },
    { id: 'pane.maximize', command: 'toggleMaximize', keys: 'Ctrl+Shift+M' },
    // Focus navigation (vim-style)
    { id: 'focus.left', command: 'focusLeft', keys: 'Meta+H' },
    { id: 'focus.right', command: 'focusRight', keys: 'Meta+L' },
    { id: 'focus.up', command: 'focusUp', keys: 'Meta+K' },
    { id: 'focus.down', command: 'focusDown', keys: 'Meta+J' },
    // Editing
    { id: 'edit.save', command: 'save', keys: 'Ctrl+S' },
    { id: 'edit.undo', command: 'undo', keys: 'Ctrl+Z' },
    { id: 'edit.redo', command: 'redo', keys: 'Ctrl+Shift+Z' },
    { id: 'edit.copy', command: 'copy', keys: 'Ctrl+C' },
    { id: 'edit.paste', command: 'paste', keys: 'Ctrl+V' },
    // Search
    { id: 'search.open', command: 'openSearch', keys: 'Ctrl+F' },
    { id: 'search.replace', command: 'openReplace', keys: 'Ctrl+R' },
    { id: 'search.next', command: 'nextMatch', keys: 'F3' },
    { id: 'search.prev', command: 'prevMatch', keys: 'Shift+F3' },
    // Command palette
    { id: 'palette.open', command: 'openPalette', keys: 'Ctrl+Shift+P' },
    // Git
    { id: 'git.status', command: 'gitStatus', keys: 'Ctrl+Shift+G' },
    { id: 'git.diff', command: 'gitDiff', keys: 'Ctrl+Shift+D' },
    // Chord examples
    { id: 'chord.comment', command: 'toggleComment', keys: 'Ctrl+K Ctrl+C' },
    { id: 'chord.uncomment', command: 'removeComment', keys: 'Ctrl+K Ctrl+U' },
    { id: 'chord.format', command: 'formatDocument', keys: 'Ctrl+K Ctrl+F' },
    // Agent
    { id: 'agent.interrupt', command: 'interruptAgent', keys: 'Escape' },
    { id: 'agent.approve', command: 'approveAction', keys: 'Ctrl+Enter' },
    { id: 'agent.reject', command: 'rejectAction', keys: 'Ctrl+Backspace' },
  ];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function keysEqual(a: ParsedKey, b: ParsedKey): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta && a.key === b.key;
}
