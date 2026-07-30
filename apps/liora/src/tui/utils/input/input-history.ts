/**
 * InputHistory — command history with reverse search (Ctrl+R style).
 *
 * Provides shell-like input history management:
 * - Persistent history storage (in-memory with optional file persistence)
 * - Reverse incremental search (Ctrl+R)
 * - Prefix matching (type prefix, arrow up cycles matches)
 * - Deduplication (consecutive duplicates collapsed)
 * - Frequency tracking (most-used commands ranked higher)
 * - Timestamp tracking for recency-based suggestions
 * - Multi-line input support
 *
 * Search modes:
 * - Incremental: Characters narrow the search progressively
 * - Prefix: Match commands starting with the typed prefix
 * - Fuzzy: Subsequence matching across the command
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  readonly text: string;
  readonly timestamp: number;
  readonly count: number;
  readonly lastUsed: number;
  /** Working directory when the command was entered. */
  readonly cwd?: string;
  /** Session ID when the command was entered. */
  readonly sessionId?: string;
}

export type SearchMode = 'incremental' | 'prefix' | 'fuzzy';

export interface SearchState {
  readonly active: boolean;
  readonly query: string;
  readonly mode: SearchMode;
  readonly results: readonly HistoryEntry[];
  readonly selectedIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 500;
const MAX_SEARCH_RESULTS = 20;
const DEDUP_WINDOW_MS = 5000; // Collapse duplicates within 5 seconds

// ---------------------------------------------------------------------------
// InputHistory
// ---------------------------------------------------------------------------

export class InputHistory {
  private entries: HistoryEntry[] = [];
  private searchState: SearchState = {
    active: false,
    query: '',
    mode: 'incremental',
    results: [],
    selectedIndex: 0,
  };
  private navigationIndex = -1; // For arrow-up/down navigation

  // ─── Recording ────────────────────────────────────────────────────

  /** Add a command to history. */
  push(text: string, options?: { cwd?: string; sessionId?: string }): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const now = Date.now();

    // Deduplication: if the last entry is the same text within the window, just update timestamp
    const last = this.entries[0];
    if (last && last.text === trimmed && now - last.timestamp < DEDUP_WINDOW_MS) {
      this.entries[0] = { ...last, timestamp: now, lastUsed: now, count: last.count + 1 };
      return;
    }

    // Check if this exact text exists elsewhere (update count)
    const existingIdx = this.entries.findIndex((e) => e.text === trimmed);
    if (existingIdx >= 0) {
      const existing = this.entries[existingIdx]!;
      this.entries.splice(existingIdx, 1);
      this.entries.unshift({
        ...existing,
        timestamp: now,
        lastUsed: now,
        count: existing.count + 1,
        cwd: options?.cwd,
        sessionId: options?.sessionId,
      });
    } else {
      this.entries.unshift({
        text: trimmed,
        timestamp: now,
        count: 1,
        lastUsed: now,
        cwd: options?.cwd,
        sessionId: options?.sessionId,
      });
    }

    // Trim to max size
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(0, MAX_HISTORY);
    }

    // Reset navigation
    this.navigationIndex = -1;
  }

  // ─── Navigation (Arrow Up/Down) ──────────────────────────────────

  /** Navigate to the previous (older) entry. */
  navigateUp(prefix: string = ''): string | null {
    const candidates = prefix.length > 0
      ? this.entries.filter((e) => e.text.startsWith(prefix))
      : this.entries;

    if (candidates.length === 0) return null;

    this.navigationIndex = Math.min(this.navigationIndex + 1, candidates.length - 1);
    return candidates[this.navigationIndex]?.text ?? null;
  }

  /** Navigate to the next (newer) entry. */
  navigateDown(prefix: string = ''): string | null {
    if (this.navigationIndex <= 0) {
      this.navigationIndex = -1;
      return null; // Back to empty input
    }

    const candidates = prefix.length > 0
      ? this.entries.filter((e) => e.text.startsWith(prefix))
      : this.entries;

    this.navigationIndex = Math.max(-1, this.navigationIndex - 1);
    if (this.navigationIndex < 0) return null;
    return candidates[this.navigationIndex]?.text ?? null;
  }

  /** Reset navigation position. */
  resetNavigation(): void {
    this.navigationIndex = -1;
  }

  // ─── Search (Ctrl+R) ─────────────────────────────────────────────

  /** Start a reverse search session. */
  startSearch(mode: SearchMode = 'incremental'): void {
    this.searchState = {
      active: true,
      query: '',
      mode,
      results: this.entries.slice(0, MAX_SEARCH_RESULTS),
      selectedIndex: 0,
    };
  }

  /** End the search session. */
  endSearch(): void {
    this.searchState = { ...this.searchState, active: false };
  }

  /** Add a character to the search query. */
  searchType(char: string): void {
    if (!this.searchState.active) return;
    const query = this.searchState.query + char;
    this.updateSearch(query);
  }

  /** Remove the last character from the search query. */
  searchBackspace(): void {
    if (!this.searchState.active) return;
    const query = this.searchState.query.slice(0, -1);
    this.updateSearch(query);
  }

  /** Move to the next search result. */
  searchNext(): void {
    if (!this.searchState.active) return;
    this.searchState = {
      ...this.searchState,
      selectedIndex: Math.min(
        this.searchState.selectedIndex + 1,
        this.searchState.results.length - 1,
      ),
    };
  }

  /** Move to the previous search result. */
  searchPrev(): void {
    if (!this.searchState.active) return;
    this.searchState = {
      ...this.searchState,
      selectedIndex: Math.max(0, this.searchState.selectedIndex - 1),
    };
  }

  /** Get the currently selected search result. */
  getSearchResult(): string | null {
    if (!this.searchState.active) return null;
    return this.searchState.results[this.searchState.selectedIndex]?.text ?? null;
  }

  /** Get the current search state. */
  getSearchState(): SearchState {
    return this.searchState;
  }

  private updateSearch(query: string): void {
    const results = this.search(query, this.searchState.mode);
    this.searchState = {
      ...this.searchState,
      query,
      results,
      selectedIndex: 0,
    };
  }

  // ─── Search Algorithms ────────────────────────────────────────────

  private search(query: string, mode: SearchMode): HistoryEntry[] {
    if (query.length === 0) {
      return this.entries.slice(0, MAX_SEARCH_RESULTS);
    }

    const queryLower = query.toLowerCase();
    let results: HistoryEntry[];

    switch (mode) {
      case 'prefix':
        results = this.entries.filter((e) =>
          e.text.toLowerCase().startsWith(queryLower)
        );
        break;

      case 'fuzzy':
        results = this.entries.filter((e) =>
          fuzzySubsequence(queryLower, e.text.toLowerCase())
        );
        break;

      case 'incremental':
      default:
        results = this.entries.filter((e) =>
          e.text.toLowerCase().includes(queryLower)
        );
        break;
    }

    // Score and sort by relevance (recency + frequency)
    return results
      .map((e) => ({ entry: e, score: scoreEntry(e, queryLower) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_RESULTS)
      .map((r) => r.entry);
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Get all history entries (newest first). */
  getAll(): readonly HistoryEntry[] {
    return this.entries;
  }

  /** Get the most recent N entries. */
  getRecent(count: number): HistoryEntry[] {
    return this.entries.slice(0, count);
  }

  /** Get the most frequently used entries. */
  getFrequent(count: number): HistoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.count - a.count)
      .slice(0, count);
  }

  /** Get history count. */
  get size(): number {
    return this.entries.length;
  }

  /** Clear all history. */
  clear(): void {
    this.entries = [];
    this.navigationIndex = -1;
    this.endSearch();
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render the search overlay. */
  renderSearch(
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
    maxWidth: number = 60,
  ): string[] {
    if (!this.searchState.active) return [];

    const lines: string[] = [];
    const { query, results, selectedIndex } = this.searchState;

    // Search prompt
    lines.push(`${fg('accent', 'reverse-search')}${dimFg('textMuted', ': ')}${fg('text', query)}${fg('accent', '▌')}`);

    // Results
    for (let i = 0; i < Math.min(results.length, 8); i++) {
      const entry = results[i]!;
      const selected = i === selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';
      const text = truncateStr(entry.text, maxWidth - 10);

      // Highlight the matching portion
      const highlighted = highlightMatch(text, query, fg, boldFg);
      const timeAgo = formatTimeAgo(entry.timestamp);

      lines.push(`${cursor}${highlighted} ${dimFg('textMuted', timeAgo)}`);
    }

    if (results.length === 0) {
      lines.push(dimFg('textMuted', '  (no matches)'));
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function fuzzySubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function scoreEntry(entry: HistoryEntry, query: string): number {
  let score = 0;

  // Recency bonus (decay over 24h)
  const ageMs = Date.now() - entry.lastUsed;
  score += Math.max(0, 50 * (1 - ageMs / 86400000));

  // Frequency bonus
  score += Math.min(30, entry.count * 5);

  // Prefix match bonus
  if (entry.text.toLowerCase().startsWith(query)) {
    score += 100;
  }

  // Exact match bonus
  if (entry.text.toLowerCase() === query) {
    score += 200;
  }

  return score;
}

function highlightMatch(
  text: string,
  query: string,
  fg: (t: string, s: string) => string,
  boldFg: (t: string, s: string) => string,
): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return fg('text', text);

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);

  return `${fg('text', before)}${boldFg('accent', match)}${fg('text', after)}`;
}

function truncateStr(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${String(hour)}h`;
  return `${String(Math.floor(hour / 24))}d`;
}
