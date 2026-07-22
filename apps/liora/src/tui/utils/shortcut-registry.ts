/**
 * ShortcutRegistry — centralized keyboard shortcut system with vim-style
 * modal navigation, key sequences, and context-aware cheatsheet rendering.
 *
 * Design goals:
 * - Single source of truth for all keybindings (no scattered switch/case)
 * - Vim-inspired modal input: Normal → Insert → Visual → Command
 * - Multi-key sequences (e.g. `g g`, `g t`, `z z`) with timeout
 * - Context-scoped bindings: global, panel-specific, mode-specific
 * - Fuzzy search over bindings for the cheatsheet overlay
 * - Zero allocation on hot path (pre-computed lookup maps)
 *
 * Pure logic module — no rendering, no TUI state dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VimMode = 'normal' | 'insert' | 'visual' | 'command';

export type ShortcutScope =
  | 'global'
  | 'transcript'
  | 'panel'
  | 'palette'
  | 'git'
  | 'terminal'
  | 'dialog';

export interface KeyBinding {
  /** Human-readable key label (e.g. "Ctrl+K", "g g", "?"). */
  readonly key: string;
  /** Normalized key token for matching (lowercase, no spaces). */
  readonly token: string;
  /** Action identifier. */
  readonly action: string;
  /** Human-readable description. */
  readonly description: string;
  /** Scope where this binding is active. */
  readonly scope: ShortcutScope;
  /** Vim mode(s) where this binding applies. Empty = all modes. */
  readonly modes: readonly VimMode[];
  /** Category for grouping in cheatsheet. */
  readonly category: string;
  /** Whether this is a multi-key sequence prefix. */
  readonly isSequencePrefix?: boolean;
}

export interface ShortcutMatch {
  readonly binding: KeyBinding;
  /** Whether this is a partial match (waiting for more keys). */
  readonly partial: boolean;
}

export interface CheatsheetSection {
  readonly title: string;
  readonly bindings: readonly KeyBinding[];
}

export interface ShortcutRegistryOptions {
  /** Timeout in ms for multi-key sequences (default 800ms). */
  readonly sequenceTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SEQUENCE_TIMEOUT = 800;

/** Mode indicator glyphs for the status line. */
export const MODE_GLYPH: Record<VimMode, string> = {
  normal: 'Ⓝ',
  insert: 'Ⓘ',
  visual: 'Ⓥ',
  command: 'Ⓒ',
};

export const MODE_LABEL: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  command: 'COMMAND',
};

// ---------------------------------------------------------------------------
// Default Bindings
// ---------------------------------------------------------------------------

function defaultBindings(): KeyBinding[] {
  const b = (
    key: string,
    action: string,
    description: string,
    scope: ShortcutScope,
    category: string,
    modes: VimMode[] = [],
    isSequencePrefix = false,
  ): KeyBinding => ({
    key,
    token: normalizeToken(key),
    action,
    description,
    scope,
    modes,
    category,
    isSequencePrefix,
  });

  return [
    // ─── Global: Mode switching ───────────────────────────────────────────
    b('Esc', 'mode:normal', 'Normal 모드로 전환', 'global', '모드'),
    b('i', 'mode:insert', 'Insert 모드 (입력)', 'global', '모드', ['normal']),
    b('v', 'mode:visual', 'Visual 모드 (선택)', 'global', '모드', ['normal']),
    b(':', 'mode:command', 'Command 모드 (명령)', 'global', '모드', ['normal']),

    // ─── Global: Navigation ───────────────────────────────────────────────
    b('h', 'nav:left', '왼쪽 이동/패널', 'global', '탐색', ['normal']),
    b('j', 'nav:down', '아래 이동', 'global', '탐색', ['normal']),
    b('k', 'nav:up', '위 이동', 'global', '탐색', ['normal']),
    b('l', 'nav:right', '오른쪽 이동/패널', 'global', '탐색', ['normal']),
    b('Ctrl+U', 'nav:page-up', '반 페이지 위로', 'global', '탐색', ['normal']),
    b('Ctrl+D', 'nav:page-down', '반 페이지 아래로', 'global', '탐색', ['normal']),
    b('g g', 'nav:top', '맨 위로', 'global', '탐색', ['normal']),
    b('G', 'nav:bottom', '맨 아래로', 'global', '탐색', ['normal']),
    b('Ctrl+Home', 'nav:top', '맨 위로', 'global', '탐색'),
    b('Ctrl+End', 'nav:bottom', '맨 아래로', 'global', '탐색'),

    // ─── Global: Panels ───────────────────────────────────────────────────
    b('Ctrl+B', 'panel:toggle-left', '왼쪽 독 토글', 'global', '패널'),
    b('Ctrl+N', 'panel:toggle-right', '오른쪽 독 토글', 'global', '패널'),
    b('Ctrl+T', 'panel:dock-mode', '독 모드 전환', 'global', '패널'),
    b('Ctrl+1~9', 'panel:focus-n', '패널 N 포커스', 'global', '패널'),
    b('Tab', 'panel:next', '다음 패널', 'global', '패널'),
    b('S+Tab', 'panel:prev', '이전 패널', 'global', '패널'),
    b('F11', 'panel:maximize', '전체화면 토글', 'global', '패널'),
    b('g t', 'panel:next-tab', '다음 탭', 'global', '패널', ['normal']),
    b('g T', 'panel:prev-tab', '이전 탭', 'global', '패널', ['normal']),

    // ─── Global: Overlays ─────────────────────────────────────────────────
    b('Ctrl+K', 'overlay:palette', '명령 팔레트', 'global', '오버레이'),
    b('Ctrl+/', 'overlay:switcher', '퀵 스위처', 'global', '오버레이'),
    b('Ctrl+F', 'overlay:search', '검색', 'global', '오버레이'),
    b('F1', 'overlay:help', '도움말', 'global', '오버레이'),
    b('?', 'overlay:cheatsheet', '단축키 치트시트', 'global', '오버레이', ['normal']),

    // ─── Global: Session / Agent ──────────────────────────────────────────
    b('Ctrl+C', 'agent:interrupt', '에이전트 중단', 'global', '에이전트'),
    b('Ctrl+S', 'session:save', '세션 저장', 'global', '세션'),
    b('Ctrl+W', 'session:close', '현재 패널 닫기', 'global', '세션'),

    // ─── Transcript ───────────────────────────────────────────────────────
    b('y', 'transcript:copy', '선택 복사', 'transcript', '트랜스크립트', ['visual']),
    b('/', 'transcript:search', '트랜스크립트 검색', 'transcript', '트랜스크립트', ['normal']),
    b('n', 'transcript:next-match', '다음 검색 결과', 'transcript', '트랜스크립트', ['normal']),
    b('N', 'transcript:prev-match', '이전 검색 결과', 'transcript', '트랜스크립트', ['normal']),
    b('z z', 'transcript:center', '현재 줄 중앙 정렬', 'transcript', '트랜스크립트', ['normal']),

    // ─── Git panel ────────────────────────────────────────────────────────
    b('Space', 'git:toggle-stage', '스테이지 토글', 'git', 'Git'),
    b('a', 'git:stage-all', '전체 스테이지', 'git', 'Git', ['normal']),
    b('c', 'git:commit', '커밋', 'git', 'Git', ['normal']),
    b('p', 'git:push', '푸시', 'git', 'Git', ['normal']),
    b('P', 'git:pull', '풀', 'git', 'Git', ['normal']),
    b('m', 'git:merge', '머지', 'git', 'Git', ['normal']),
    b('d', 'git:discard', '변경 폐기', 'git', 'Git', ['normal']),

    // ─── Terminal panel ───────────────────────────────────────────────────
    b('Ctrl+L', 'terminal:clear', '터미널 지우기', 'terminal', '터미널'),
    b('Ctrl+E', 'terminal:env', '환경변수 표시', 'terminal', '터미널'),
  ];
}

// ---------------------------------------------------------------------------
// ShortcutRegistry
// ---------------------------------------------------------------------------

export class ShortcutRegistry {
  private bindings: KeyBinding[] = [];
  private lookup: Map<string, KeyBinding[]> = new Map();
  private sequencePrefixes: Set<string> = new Set();
  private pendingSequence: string[] = [];
  private sequenceStart = 0;
  private readonly sequenceTimeoutMs: number;

  private _mode: VimMode = 'insert'; // Default to insert for chat-first UX
  private _scope: ShortcutScope = 'global';
  private _onModeChange: ((mode: VimMode) => void) | null = null;

  constructor(options?: ShortcutRegistryOptions) {
    this.sequenceTimeoutMs = options?.sequenceTimeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT;
    this.registerAll(defaultBindings());
  }

  // ─── Mode management ──────────────────────────────────────────────────

  get mode(): VimMode {
    return this._mode;
  }

  set mode(value: VimMode) {
    if (this._mode !== value) {
      this._mode = value;
      this.pendingSequence = [];
      this._onModeChange?.(value);
    }
  }

  get scope(): ShortcutScope {
    return this._scope;
  }

  set scope(value: ShortcutScope) {
    this._scope = value;
  }

  onModeChange(callback: (mode: VimMode) => void): void {
    this._onModeChange = callback;
  }

  /** Cycle mode: normal → insert → normal (toggle). */
  toggleMode(): void {
    this.mode = this._mode === 'normal' ? 'insert' : 'normal';
  }

  // ─── Registration ─────────────────────────────────────────────────────

  register(binding: KeyBinding): void {
    this.bindings.push(binding);
    this.rebuildLookup();
  }

  registerAll(bindings: readonly KeyBinding[]): void {
    this.bindings.push(...bindings);
    this.rebuildLookup();
  }

  unregister(action: string): void {
    this.bindings = this.bindings.filter((b) => b.action !== action);
    this.rebuildLookup();
  }

  // ─── Matching ─────────────────────────────────────────────────────────

  /**
   * Feed a key event and get a match result.
   * Returns null if no binding matches (key should fall through).
   * Returns a ShortcutMatch with partial=true if waiting for more keys.
   */
  feed(keyLabel: string, now: number = Date.now()): ShortcutMatch | null {
    // Expire stale sequences
    if (this.pendingSequence.length > 0 && now - this.sequenceStart > this.sequenceTimeoutMs) {
      this.pendingSequence = [];
    }

    const token = normalizeToken(keyLabel);
    this.pendingSequence.push(token);
    if (this.pendingSequence.length === 1) {
      this.sequenceStart = now;
    }

    const composite = this.pendingSequence.join(' ');

    // Check for exact match
    const exactMatches = this.getActiveBindings().filter((b) => b.token === composite);
    if (exactMatches.length > 0) {
      this.pendingSequence = [];
      return { binding: exactMatches[0]!, partial: false };
    }

    // Check for partial match (sequence prefix)
    const hasPartial = this.getActiveBindings().some(
      (b) => b.token.startsWith(composite + ' ') || b.token.startsWith(composite + '+'),
    );
    if (hasPartial) {
      return { binding: this.getActiveBindings().find((b) => b.token.startsWith(composite))!, partial: true };
    }

    // No match — reset sequence
    this.pendingSequence = [];
    return null;
  }

  /** Reset any pending key sequence. */
  resetSequence(): void {
    this.pendingSequence = [];
  }

  /** Whether we're waiting for more keys in a sequence. */
  get isPendingSequence(): boolean {
    return this.pendingSequence.length > 0;
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  /** Get all bindings active for the current mode + scope. */
  getActiveBindings(): KeyBinding[] {
    return this.bindings.filter((b) => {
      // Scope: global always active, plus current scope
      if (b.scope !== 'global' && b.scope !== this._scope) return false;
      // Mode: empty modes = all modes
      if (b.modes.length > 0 && !b.modes.includes(this._mode)) return false;
      return true;
    });
  }

  /** Get bindings grouped by category for cheatsheet rendering. */
  getCheatsheet(filter?: string): CheatsheetSection[] {
    let active = this.getActiveBindings();

    if (filter) {
      const lower = filter.toLowerCase();
      active = active.filter(
        (b) =>
          b.description.toLowerCase().includes(lower) ||
          b.key.toLowerCase().includes(lower) ||
          b.action.toLowerCase().includes(lower) ||
          b.category.toLowerCase().includes(lower),
      );
    }

    const groups = new Map<string, KeyBinding[]>();
    for (const binding of active) {
      const list = groups.get(binding.category) ?? [];
      list.push(binding);
      groups.set(binding.category, list);
    }

    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, bindings]) => ({ title, bindings }));
  }

  /** Find binding by action id. */
  findByAction(action: string): KeyBinding | undefined {
    return this.bindings.find((b) => b.action === action);
  }

  /** Get the key label for an action (for UI hints). */
  keyHintFor(action: string): string | null {
    const binding = this.findByAction(action);
    return binding?.key ?? null;
  }

  get allBindings(): readonly KeyBinding[] {
    return this.bindings;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private rebuildLookup(): void {
    this.lookup.clear();
    this.sequencePrefixes.clear();
    for (const binding of this.bindings) {
      const existing = this.lookup.get(binding.token) ?? [];
      existing.push(binding);
      this.lookup.set(binding.token, existing);
      if (binding.isSequencePrefix || binding.token.includes(' ')) {
        const prefix = binding.token.split(' ')[0]!;
        this.sequencePrefixes.add(prefix);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a key label to a matching token. */
function normalizeToken(key: string): string {
  return key.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Vim Mode Controller
// ---------------------------------------------------------------------------

export interface VimModeState {
  readonly mode: VimMode;
  readonly pendingKeys: string;
  readonly register: string; // Last yanked text
  readonly count: number; // Numeric prefix (e.g. 3j = down 3)
  readonly lastSearch: string;
}

/**
 * VimModeController — manages vim-style modal editing state for the TUI.
 * Integrates with ShortcutRegistry for key resolution.
 */
export class VimModeController {
  private readonly registry: ShortcutRegistry;
  private _state: VimModeState = {
    mode: 'insert',
    pendingKeys: '',
    register: '',
    count: 0,
    lastSearch: '',
  };
  private countBuffer = '';

  constructor(registry: ShortcutRegistry) {
    this.registry = registry;
    registry.onModeChange((mode) => {
      this._state = { ...this._state, mode };
    });
  }

  get state(): VimModeState {
    return this._state;
  }

  get mode(): VimMode {
    return this._state.mode;
  }

  /**
   * Process a key in the current mode.
   * Returns the resolved action string, or null if unhandled.
   */
  processKey(keyLabel: string, now?: number): string | null {
    // In insert mode, only handle Escape and Ctrl- combinations
    if (this._state.mode === 'insert') {
      if (keyLabel === 'Escape' || keyLabel === 'Esc') {
        this.registry.mode = 'normal';
        this._state = { ...this._state, mode: 'normal', pendingKeys: '' };
        return 'mode:normal';
      }
      // Ctrl- combos still work in insert mode
      if (keyLabel.startsWith('Ctrl+')) {
        const match = this.registry.feed(keyLabel, now);
        if (match && !match.partial) return match.binding.action;
      }
      return null; // Let the key pass through to input
    }

    // Normal/Visual/Command mode: numeric prefix
    if (/^[1-9]$/.test(keyLabel) && this._state.mode === 'normal') {
      this.countBuffer += keyLabel;
      this._state = { ...this._state, count: parseInt(this.countBuffer, 10), pendingKeys: this.countBuffer };
      return null; // Consumed but no action yet
    }

    // Mode switch shortcuts
    if (keyLabel === 'i' && this._state.mode === 'normal') {
      this.registry.mode = 'insert';
      this._state = { ...this._state, mode: 'insert', count: 0, pendingKeys: '' };
      this.countBuffer = '';
      return 'mode:insert';
    }
    if (keyLabel === 'v' && this._state.mode === 'normal') {
      this.registry.mode = 'visual';
      this._state = { ...this._state, mode: 'visual', count: 0, pendingKeys: '' };
      this.countBuffer = '';
      return 'mode:visual';
    }
    if (keyLabel === ':' && this._state.mode === 'normal') {
      this.registry.mode = 'command';
      this._state = { ...this._state, mode: 'command', pendingKeys: '' };
      this.countBuffer = '';
      return 'mode:command';
    }
    if (keyLabel === 'Escape' || keyLabel === 'Esc') {
      this.registry.mode = 'normal';
      this._state = { ...this._state, mode: 'normal', pendingKeys: '', count: 0 };
      this.countBuffer = '';
      return 'mode:normal';
    }

    // Feed to registry
    const match = this.registry.feed(keyLabel, now);
    if (match === null) {
      this._state = { ...this._state, pendingKeys: '' };
      return null;
    }

    if (match.partial) {
      this._state = { ...this._state, pendingKeys: this._state.pendingKeys + keyLabel + ' ' };
      return null; // Waiting for more keys
    }

    // Full match — resolve action
    const count = this._state.count || 1;
    this.countBuffer = '';
    this._state = { ...this._state, pendingKeys: '', count: 0 };

    // Store action with count metadata
    return count > 1 ? `${match.binding.action}:${String(count)}` : match.binding.action;
  }

  /** Set the yank register (for paste). */
  setRegister(text: string): void {
    this._state = { ...this._state, register: text };
  }

  /** Set last search pattern. */
  setLastSearch(pattern: string): void {
    this._state = { ...this._state, lastSearch: pattern };
  }

  /** Get the mode indicator string for status bar. */
  get modeIndicator(): string {
    return `${MODE_GLYPH[this._state.mode]} ${MODE_LABEL[this._state.mode]}`;
  }

  /** Get pending keys display (for showing sequence progress). */
  get pendingDisplay(): string {
    return this._state.pendingKeys;
  }
}

// ---------------------------------------------------------------------------
// Cheatsheet Renderer (pure string output)
// ---------------------------------------------------------------------------

export interface CheatsheetRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly filter?: string;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

/**
 * Render the cheatsheet overlay as an array of themed lines.
 * Adapts layout to available width (compact vs full).
 */
export function renderCheatsheet(
  registry: ShortcutRegistry,
  options: CheatsheetRenderOptions,
): string[] {
  const { width, height, filter, fg, boldFg, dimFg } = options;
  const sections = registry.getCheatsheet(filter);
  const lines: string[] = [];

  // Header
  const modeLabel = MODE_LABEL[registry.mode];
  const header = ` 단축키 · ${modeLabel} 모드`;
  lines.push(boldFg('primary', header));
  lines.push(fg('primary', '─'.repeat(Math.min(width, 50))));

  if (filter) {
    lines.push(dimFg('textMuted', ` 필터: "${filter}"`));
  }

  const compact = width < 60;
  const keyColWidth = compact ? 12 : 18;

  for (const section of sections) {
    if (lines.length >= height - 2) break;
    lines.push(` ${boldFg('accent', section.title)}`);

    for (const binding of section.bindings) {
      if (lines.length >= height - 2) break;
      const keyStr = fg('primary', binding.key);
      const pad = Math.max(1, keyColWidth - binding.key.length);
      const desc = compact
        ? truncateStr(binding.description, width - keyColWidth - 4)
        : binding.description;
      lines.push(`   ${keyStr}${' '.repeat(pad)}${fg('text', desc)}`);
    }
  }

  // Footer
  lines.push(fg('primary', '─'.repeat(Math.min(width, 50))));
  lines.push(dimFg('textMuted', ' Esc: 닫기 · /: 검색 · i: 입력모드'));

  return lines.slice(0, height);
}

function truncateStr(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}
