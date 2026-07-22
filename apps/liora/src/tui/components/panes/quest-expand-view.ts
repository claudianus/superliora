/**
 * Quest Expand View — renders the expanded (pinned) quest's live stream.
 *
 * When a quest is pinned, this view occupies 60–70% of the bento grid
 * and shows the agent's real-time output (terminal-in-terminal style).
 *
 * AC-3: expand view shows agent live stream, scrollable.
 *       Diff view is Gen 2+ (out of scope for Gen 1).
 */

import { currentTheme } from '#/tui/theme';

import {
  type Quest,
  formatChangeCount,
  formatElapsed,
  questHealthScore,
  questStateColorToken,
  renderContextBar,
  renderTodoBar,
} from '../../controllers/quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpandViewState {
  readonly quest: Quest;
  readonly streamLines: readonly string[];
  readonly scrollOffset: number;
  readonly maxVisibleLines: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Gen 42: maximum lines retained in the live stream buffer. Long-running
 * sessions can produce unbounded output; capping the buffer prevents memory
 * growth while keeping ample scrollback for review.
 */
export const MAX_STREAM_LINES = 500;

// ---------------------------------------------------------------------------
// QuestExpandView
// ---------------------------------------------------------------------------

export class QuestExpandView {
  private streamLines: string[] = [];
  private scrollOffset = 0;
  private maxVisibleLines = 20;

  // Gen 16: search state
  private searchQuery: string | null = null;
  private searchMatches: number[] = [];
  private currentMatchIndex = 0;

  // Gen 50: diff-only view — a parallel buffer of just the diff lines so the
  // operator can focus on code changes without the surrounding chatter.
  private diffLines: string[] = [];
  private diffOnly = false;

  // Gen 57: explicit auto-follow toggle. When off, new output never yanks the
  // viewport down, so the operator can review history undisturbed.
  private followTail = true;

  // Gen 58: fullscreen stream — hides the header so the output fills the view.
  private fullscreen = false;

  // Gen 61: per-line append timestamps, parallel to streamLines, so the gutter
  // can show relative time since the first line.
  private timestamps: number[] = [];
  private showTimestamps = false;

  /** Set the maximum visible lines (from cell height). */
  setMaxVisibleLines(lines: number): void {
    this.maxVisibleLines = Math.max(1, lines);
  }

  /**
   * Gen 14: whether the viewport is parked at the bottom. New output only
   * auto-follows when true, so scrolling up to review history is not yanked
   * back down by incoming lines.
   */
  private isAtBottom(): boolean {
    const maxOffset = Math.max(0, this.streamLines.length - this.maxVisibleLines);
    return this.scrollOffset >= maxOffset;
  }

  /** Append a line to the live stream. */
  appendLine(line: string): void {
    const followBottom = this.followTail && this.isAtBottom();
    this.streamLines.push(line);
    // Gen 61: record the append time for the relative-timestamp gutter.
    this.timestamps.push(Date.now());
    this.trimToCap();
    if (followBottom) {
      // Auto-scroll to bottom only when already following the tail.
      this.scrollOffset = Math.max(
        0,
        this.streamLines.length - this.maxVisibleLines,
      );
    }
  }

  /** Append multiple lines. */
  appendLines(lines: readonly string[]): void {
    const followBottom = this.followTail && this.isAtBottom();
    const now = Date.now();
    for (const line of lines) {
      this.streamLines.push(line);
      // Gen 61: record the append time for the relative-timestamp gutter.
      this.timestamps.push(now);
    }
    this.trimToCap();
    if (followBottom) {
      this.scrollOffset = Math.max(
        0,
        this.streamLines.length - this.maxVisibleLines,
      );
    }
  }

  /**
   * Gen 50: append diff lines to both the main stream and the diff-only
   * buffer, so toggling diff-only view shows just the code changes.
   */
  appendDiffLines(lines: readonly string[]): void {
    this.appendLines(lines);
    for (const line of lines) {
      this.diffLines.push(line);
    }
    if (this.diffLines.length > MAX_STREAM_LINES) {
      this.diffLines.splice(0, this.diffLines.length - MAX_STREAM_LINES);
    }
  }

  /** Gen 50: toggle the diff-only view. Returns the new state. */
  toggleDiffOnly(): boolean {
    this.diffOnly = !this.diffOnly;
    // Reset the viewport to the top of the selected buffer.
    this.scrollOffset = 0;
    return this.diffOnly;
  }

  /**
   * Gen 57: toggle auto-follow of the live tail. When re-enabled, snap the
   * viewport back to the bottom so the operator immediately sees new output.
   * Returns the new state.
   */
  toggleFollowTail(): boolean {
    this.followTail = !this.followTail;
    if (this.followTail) {
      this.scrollOffset = Math.max(0, this.activeBuffer().length - this.maxVisibleLines);
    }
    return this.followTail;
  }

  /** Gen 57: whether auto-follow of the live tail is enabled. */
  isFollowingTail(): boolean {
    return this.followTail;
  }

  /** Gen 58: toggle fullscreen stream (hides the header). Returns the new state. */
  toggleFullscreen(): boolean {
    this.fullscreen = !this.fullscreen;
    return this.fullscreen;
  }

  /** Gen 58: whether fullscreen stream mode is active. */
  isFullscreen(): boolean {
    return this.fullscreen;
  }

  /** Gen 50: whether the diff-only view is active. */
  isDiffOnly(): boolean {
    return this.diffOnly;
  }

  /**
   * Gen 42: enforce the stream buffer cap. When the buffer overflows, drop
   * the oldest lines and shift the scroll offset down by the same amount so
   * the visible window stays put while reviewing history.
   */
  private trimToCap(): void {
    const overflow = this.streamLines.length - MAX_STREAM_LINES;
    if (overflow <= 0) return;
    this.streamLines.splice(0, overflow);
    // Gen 61: keep the timestamp buffer aligned with the stream buffer.
    this.timestamps.splice(0, overflow);
    this.scrollOffset = Math.max(0, this.scrollOffset - overflow);
  }

  /** Clear the stream. */
  clear(): void {
    this.streamLines = [];
    this.timestamps = [];
    this.scrollOffset = 0;
  }

  /** Gen 42: number of lines currently retained in the stream buffer. */
  getLineCount(): number {
    return this.streamLines.length;
  }

  /** Scroll up by n lines. */
  scrollUp(n: number = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - n);
  }

  /** Scroll down by n lines. */
  scrollDown(n: number = 1): void {
    const maxOffset = Math.max(0, this.streamLines.length - this.maxVisibleLines);
    this.scrollOffset = Math.min(maxOffset, this.scrollOffset + n);
  }

  /** Gen 15: scroll up by one viewport page. */
  scrollPageUp(): void {
    this.scrollUp(Math.max(1, this.maxVisibleLines - 1));
  }

  /** Gen 15: scroll down by one viewport page. */
  scrollPageDown(): void {
    this.scrollDown(Math.max(1, this.maxVisibleLines - 1));
  }

  /** Gen 15: jump to the very top of the stream. */
  scrollToTop(): void {
    this.scrollOffset = 0;
  }

  /**
   * Gen 60: start reviewing from the top of the stream. Jumps to line 1 and
   * pauses auto-follow so incoming output does not yank the viewport away
   * while the operator reads from the beginning.
   */
  reviewFromTop(): void {
    this.followTail = false;
    this.scrollOffset = 0;
  }

  /** Gen 15: jump to the live tail (bottom) of the stream. */
  scrollToBottom(): void {
    this.scrollOffset = Math.max(0, this.streamLines.length - this.maxVisibleLines);
  }

  // -------------------------------------------------------------------------
  // Gen 16: in-stream text search
  // -------------------------------------------------------------------------

  /**
   * Gen 16: start (or update) a case-insensitive search over the stream and
   * jump to the first match. Returns the number of matches found.
   */
  startSearch(query: string): number {
    this.searchQuery = query.length > 0 ? query : null;
    this.searchMatches = [];
    this.currentMatchIndex = 0;
    if (this.searchQuery === null) return 0;
    const needle = this.searchQuery.toLowerCase();
    for (let i = 0; i < this.streamLines.length; i++) {
      if (this.streamLines[i]!.toLowerCase().includes(needle)) {
        this.searchMatches.push(i);
      }
    }
    if (this.searchMatches.length > 0) {
      this.jumpToLine(this.searchMatches[0]!);
    }
    return this.searchMatches.length;
  }

  /** Gen 16: jump to the next search match (wraps around). */
  searchNext(): void {
    if (this.searchMatches.length === 0) return;
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
    this.jumpToLine(this.searchMatches[this.currentMatchIndex]!);
  }

  /** Gen 16: jump to the previous search match (wraps around). */
  searchPrev(): void {
    if (this.searchMatches.length === 0) return;
    this.currentMatchIndex =
      (this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
    this.jumpToLine(this.searchMatches[this.currentMatchIndex]!);
  }

  /** Gen 16: clear the active search. */
  clearSearch(): void {
    this.searchQuery = null;
    this.searchMatches = [];
    this.currentMatchIndex = 0;
  }

  /**
   * Gen 59: clear the stream and diff buffers, resetting the viewport. Useful
   * when a long session has filled the buffer and the operator wants a fresh
   * view of only new output.
   */
  clearStream(): void {
    this.streamLines = [];
    this.diffLines = [];
    this.timestamps = [];
    this.scrollOffset = 0;
    this.clearSearch();
  }

  /** Gen 61: toggle relative-timestamp display in the gutter. Returns new state. */
  toggleTimestamps(): boolean {
    this.showTimestamps = !this.showTimestamps;
    return this.showTimestamps;
  }

  /** Gen 61: whether relative timestamps are shown. */
  isShowingTimestamps(): boolean {
    return this.showTimestamps;
  }

  /** Gen 16: current search status for header display, or null if inactive. */
  getSearchStatus(): { query: string; current: number; total: number } | null {
    if (this.searchQuery === null) return null;
    return {
      query: this.searchQuery,
      current: this.searchMatches.length > 0 ? this.currentMatchIndex + 1 : 0,
      total: this.searchMatches.length,
    };
  }

  /** Scroll so the given line index is visible (centered when possible). */
  private jumpToLine(lineIndex: number): void {
    // Gen 62: bound against the active buffer so jumps stay valid in diff-only
    // mode too.
    const maxOffset = Math.max(0, this.activeBuffer().length - this.maxVisibleLines);
    const target = Math.max(0, lineIndex - Math.floor(this.maxVisibleLines / 2));
    this.scrollOffset = Math.min(maxOffset, target);
  }

  /**
   * Gen 67: jump to a 1-based line number (as shown in the gutter). Clamps to
   * the buffer bounds. Returns false when the buffer is empty.
   */
  jumpToLineNumber(lineNumber: number): boolean {
    const buffer = this.activeBuffer();
    if (buffer.length === 0) return false;
    const index = Math.max(0, Math.min(buffer.length - 1, lineNumber - 1));
    this.jumpToLine(index);
    return true;
  }

  /**
   * Gen 62: jump to the next error/warning line after the current viewport.
   * Returns true if a match was found. Wraps to the top when none is found
   * below so repeated presses cycle through all problem lines.
   */
  jumpToNextError(): boolean {
    const buffer = this.activeBuffer();
    const start = this.scrollOffset + 1;
    for (let i = start; i < buffer.length; i++) {
      if (isProblemLine(buffer[i]!)) {
        this.jumpToLine(i);
        return true;
      }
    }
    // Wrap around from the top.
    for (let i = 0; i < Math.min(start, buffer.length); i++) {
      if (isProblemLine(buffer[i]!)) {
        this.jumpToLine(i);
        return true;
      }
    }
    return false;
  }

  /**
   * Gen 62: jump to the previous error/warning line before the current
   * viewport. Returns true if a match was found. Wraps to the bottom.
   */
  jumpToPrevError(): boolean {
    const buffer = this.activeBuffer();
    const start = this.scrollOffset - 1;
    for (let i = start; i >= 0; i--) {
      if (isProblemLine(buffer[i]!)) {
        this.jumpToLine(i);
        return true;
      }
    }
    // Wrap around from the bottom.
    for (let i = buffer.length - 1; i > start; i--) {
      if (isProblemLine(buffer[i]!)) {
        this.jumpToLine(i);
        return true;
      }
    }
    return false;
  }

  /**
   * Gen 65: count error and warning lines in the active buffer and format a
   * compact badge, e.g. `  ✖2 ⚠1`. Returns an empty string when the stream
   * is clean so the header stays uncluttered.
   */
  private formatProblemBadge(): string {
    const buffer = this.activeBuffer();
    let errors = 0;
    let warnings = 0;
    for (const line of buffer) {
      if (ERROR_PATTERN.test(line)) errors++;
      else if (WARNING_PATTERN.test(line)) warnings++;
    }
    if (errors === 0 && warnings === 0) return '';
    const parts: string[] = [];
    if (errors > 0) parts.push(`✖${String(errors)}`);
    if (warnings > 0) parts.push(`⚠${String(warnings)}`);
    return `  ${parts.join(' ')}`;
  }

  /**
   * Gen 65: colored variant of the problem badge for the header display, so
   * error counts render in the error color and warnings in the warning color.
   */
  private formatProblemBadgeColored(): string {
    const buffer = this.activeBuffer();
    let errors = 0;
    let warnings = 0;
    for (const line of buffer) {
      if (ERROR_PATTERN.test(line)) errors++;
      else if (WARNING_PATTERN.test(line)) warnings++;
    }
    if (errors === 0 && warnings === 0) return '';
    let out = '  ';
    if (errors > 0) out += currentTheme.fg('error', `✖${String(errors)}`);
    if (errors > 0 && warnings > 0) out += ' ';
    if (warnings > 0) out += currentTheme.fg('warning', `⚠${String(warnings)}`);
    return out;
  }

  /** Get the currently visible lines. */
  getVisibleLines(): readonly string[] {
    const source = this.activeBuffer();
    return source.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisibleLines,
    );
  }

  /** Gen 50: the buffer backing the current view (diff-only or full stream). */
  private activeBuffer(): readonly string[] {
    return this.diffOnly ? this.diffLines : this.streamLines;
  }

  /** Get total line count. */
  get totalLines(): number {
    return this.activeBuffer().length;
  }

  /** Get current scroll offset. */
  get currentScrollOffset(): number {
    return this.scrollOffset;
  }

  /**
   * Gen 66: the most recent stream line, for the dashboard cell preview.
   * Returns undefined when the stream is empty.
   */
  getLastStreamLine(): string | undefined {
    return this.streamLines.length > 0
      ? this.streamLines[this.streamLines.length - 1]
      : undefined;
  }

  /**
   * Gen 71: the 1-based line number of the most recent stream line, matching
   * the expand-view gutter so the operator can jump straight to it with `:N`.
   * Returns 0 when the stream is empty.
   */
  getLastStreamLineNumber(): number {
    return this.streamLines.length;
  }

  /** Render the expand view as a string array (one per visible row). */
  render(quest: Quest, width: number): string[] {
    const lines: string[] = [];

    // Gen 58: fullscreen mode skips the header entirely so the stream fills
    // the whole view. Everything below the header is unchanged.
    if (!this.fullscreen) {
      // Gen 14: scroll position indicator — shows where the viewport sits in the
      // stream, and flags when the user has scrolled away from the live tail.
      // Gen 50: counts reflect the active buffer (diff-only or full stream).
      const total = this.activeBuffer().length;
      const maxOffset = Math.max(0, total - this.maxVisibleLines);
      const atBottom = this.scrollOffset >= maxOffset;
      const scrollInfo =
        total <= this.maxVisibleLines
          ? `${String(total)} lines`
          : `${String(this.scrollOffset + 1)}–${String(Math.min(total, this.scrollOffset + this.maxVisibleLines))}/${String(total)}`;
      const scrollTag = atBottom ? scrollInfo : `${scrollInfo} ↑`;
      // Gen 50: flag the diff-only view in the header so the mode is obvious.
      const diffTag = this.diffOnly ? '  ≡ diff' : '';
      // Gen 57: flag when auto-follow is paused so the parked state is obvious.
      const followTag = this.followTail ? '' : '  ⏸ paused';
      // Gen 65: surface how many error/warning lines the stream holds so the
      // operator sees the problem scale at a glance (pairs with e/E jumps).
      const problemTag = this.formatProblemBadge();

      // Gen 16: append search status to the header when a search is active.
      const searchStatus = this.getSearchStatus();
      const searchTag =
        searchStatus !== null
          ? `  /${searchStatus.query} ${String(searchStatus.current)}/${String(searchStatus.total)}`
          : '';

      // Gen 11: rich header with quest metadata
      // Gen 35: colorize the state badge so the expand view matches the cells.
      const stateToken = questStateColorToken(quest.state);
      const badgeText = `[${quest.state}]`;
      const headerPrefix = `── ${quest.name} `;
      // Gen 65: plain suffix for width calculation; colored suffix for display
      // so the error/warning counts stand out.
      const headerSuffix = `  ${scrollTag}${searchTag}${diffTag}${followTag}${problemTag} ──`;
      const plainHeader = `${headerPrefix}${badgeText}${headerSuffix}`;
      const headerLine1 =
        plainHeader.length > width
          ? plainHeader.slice(0, width)
          : `${currentTheme.dim(headerPrefix)}${currentTheme.fg(stateToken, badgeText)}` +
            `${currentTheme.dim(`  ${scrollTag}${searchTag}${diffTag}${followTag}`)}` +
            `${this.formatProblemBadgeColored()}${currentTheme.dim(' ──')}`;
      lines.push(headerLine1);

      // Second header line: worktree + change count + elapsed time (Gen 23)
      const changes = formatChangeCount(quest.changeCount);
      const worktree = quest.worktreePath.length > 40
        ? `…${quest.worktreePath.slice(-39)}`
        : quest.worktreePath;
      const now = Date.now();
      const elapsed = `⏱ ${formatElapsed(Math.max(0, now - quest.createdAt))}`;
      const idle = `idle ${formatElapsed(Math.max(0, now - quest.lastActivityAt))}`;
      // Gen 33: show how long the quest has been left unattended when it is in
      // an attention state, so the operator can triage by neglect duration.
      const dwell =
        quest.attentionEnteredAt !== undefined
          ? `  ⏳ waiting ${formatElapsed(Math.max(0, now - quest.attentionEnteredAt))}`
          : '';
      const headerLine2 = `   ${worktree}  ${changes}  ${elapsed}  ${idle}${dwell}`;
      lines.push(headerLine2.length > width ? headerLine2.slice(0, width) : headerLine2);

      // Third header line: todo progress + context usage + model/cost + plan step
      // Gen 36: mini-bars match the dashboard cells for consistent scanning.
      const progressParts: string[] = [];
      if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
        const { done, total } = quest.todoProgress;
        progressParts.push(renderTodoBar(done, total));
      }
      if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
        progressParts.push(renderContextBar(quest.contextUsage));
      }
      // Gen 53: health mini-bar, matching the dashboard cells (Gen 52).
      progressParts.push(renderHealthBar(questHealthScore(quest, Date.now())));
      // Gen 38: model name + session cost, matching the dashboard cells.
      if (quest.modelName !== undefined && quest.modelName.length > 0) {
        progressParts.push(quest.modelName);
      }
      if (quest.sessionCostUsd !== undefined && quest.sessionCostUsd > 0) {
        progressParts.push(`$${quest.sessionCostUsd.toFixed(2)}`);
      }
      const progress = progressParts.length > 0 ? progressParts.join('  ') + '  ' : '';
      // Gen 13: surface the pending approval in the header when awaiting one.
      // Gen 39: surface the last error message for failed quests.
      // Gen 40: colorize the step text by severity (warning/error/muted).
      let stepText: string;
      let stepToken: 'warning' | 'error' | 'muted';
      if (quest.state === 'waiting-approval' && quest.pendingApprovalSummary !== undefined) {
        stepText = `⚡ ${quest.pendingApprovalSummary}`;
        stepToken = 'warning';
      } else if (quest.state === 'failed' && quest.lastErrorMessage !== undefined) {
        stepText = `✗ ${quest.lastErrorMessage}`;
        stepToken = 'error';
      } else {
        stepText = `▸ ${quest.planStep}`;
        stepToken = 'muted';
      }
      const plainLine3 = `   ${progress}${stepText}`;
      const coloredStep =
        stepToken === 'warning'
          ? currentTheme.fg('warning', stepText)
          : stepToken === 'error'
            ? currentTheme.fg('error', stepText)
            : currentTheme.dim(stepText);
      const headerLine3 =
        plainLine3.length > width ? plainLine3.slice(0, width) : `   ${progress}${coloredStep}`;
      lines.push(headerLine3);

      // Separator
      lines.push('─'.repeat(Math.min(width, 60)));
    }

    // Gen 48: placeholder when the active buffer has no output yet.
    const buffer = this.activeBuffer();
    if (buffer.length === 0) {
      const placeholder = this.diffOnly
        ? '  No diffs captured yet.'
        : quest.state === 'running'
          ? '  ⠋ Waiting for agent output…'
          : '  No output yet.';
      lines.push(currentTheme.dim(placeholder.length > width ? placeholder.slice(0, width) : placeholder));
      return lines;
    }

    // Gen 46: line-number gutter so search matches (Gen 16) are locatable.
    const lineTotal = buffer.length;
    const gutterWidth = Math.max(2, String(lineTotal).length);
    // Gen 61: relative-timestamp gutter (full-stream mode only, since the
    // timestamp buffer is parallel to streamLines).
    const showTs = this.showTimestamps && !this.diffOnly;
    const baseTime = this.timestamps[0] ?? 0;
    const tsWidth = showTs ? 7 : 0; // e.g. " +1m12s"
    const contentWidth = Math.max(1, width - gutterWidth - 1 - tsWidth);
    // Gen 47: mark search-matched lines, with the active match standing out.
    const matchSet = new Set(this.searchMatches);
    const activeMatch =
      this.searchMatches.length > 0 ? this.searchMatches[this.currentMatchIndex] : undefined;
    const visible = this.getVisibleLines();
    visible.forEach((line, i) => {
      const absIndex = this.scrollOffset + i;
      const lineNo = String(absIndex + 1).padStart(gutterWidth);
      const isActive = absIndex === activeMatch;
      const isMatch = matchSet.has(absIndex);
      const clipped = line.length > contentWidth ? line.slice(0, contentWidth) : line;
      const body = highlightStreamLine(clipped);
      // Gen 61: relative timestamp since the first line.
      const ts = showTs
        ? currentTheme.dim(` ${formatRelativeDelta(this.timestamps[absIndex] ?? baseTime, baseTime).padStart(tsWidth - 1)}`)
        : '';
      if (isActive) {
        lines.push(`${currentTheme.fg('warning', `${lineNo} ▸`)}${ts}${currentTheme.fg('warning', clipped)}`);
      } else if (isMatch) {
        lines.push(`${currentTheme.fg('textMuted', `${lineNo} ·`)}${ts}${body}`);
      } else {
        lines.push(`${currentTheme.dim(`${lineNo} `)}${ts}${body}`);
      }
    });

    // Gen 28: inline approval prompt when the pinned quest awaits a decision.
    if (quest.state === 'waiting-approval') {
      lines.push('');
      const summary = quest.pendingApprovalSummary ?? 'Tool approval requested';
      const prompt = `  ⚡ ${summary}`;
      lines.push(currentTheme.fg('warning', prompt.length > width ? prompt.slice(0, width) : prompt));
      const actions = '  [a] approve  [x] reject  [r] rewind';
      lines.push(currentTheme.dim(actions.length > width ? actions.slice(0, width) : actions));
    }

    // Pad to maxVisibleLines + 4 (3 header lines + separator)
    while (lines.length < this.maxVisibleLines + 4) {
      lines.push('');
    }
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Gen 20: error/warning line highlighting
// ---------------------------------------------------------------------------

const ERROR_PATTERN = /\b(error|failed|exception|fatal|panic)\b/i;
const WARNING_PATTERN = /\b(warning|warn|deprecated)\b/i;

/**
 * Gen 62: whether a line is an error/warning line (used by the e/E jump
 * navigation). Mirrors the highlightStreamLine keywords so jumps land on the
 * same lines that are visually emphasized.
 */
function isProblemLine(line: string): boolean {
  return ERROR_PATTERN.test(line) || WARNING_PATTERN.test(line);
}

/**
 * Gen 20: highlight lines containing error/warning keywords so failures are
 * spotted instantly while reviewing shell output. Lines that already carry
 * ANSI color (e.g. diff output) are left untouched to avoid double-coloring.
 */
export function highlightStreamLine(line: string): string {
  if (line.includes('\x1b[')) return line;
  if (ERROR_PATTERN.test(line)) return currentTheme.fg('error', line);
  if (WARNING_PATTERN.test(line)) return currentTheme.fg('warning', line);
  return line;
}

/**
 * Gen 53: render a colorized health mini-bar, e.g. `♥ ▓▓▓░░ 82`.
 * Mirrors the dashboard cell health bar (Gen 52). Local here because the
 * shared quest-types helpers stay theme-free.
 */
function renderHealthBar(score: number): string {
  const cells = 5;
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  const token = score >= 60 ? 'success' : score >= 30 ? 'warning' : 'error';
  return currentTheme.fg(token, `♥ ${bar} ${String(score)}`);
}

/**
 * Gen 61: format a relative time delta as a compact string, e.g. `+3s`,
 * `+1m12s`, `+2h05m`. Used in the timestamp gutter.
 */
function formatRelativeDelta(timestamp: number, base: number): string {
  const deltaMs = Math.max(0, timestamp - base);
  const totalSec = Math.floor(deltaMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `+${String(h)}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `+${String(m)}m${String(s).padStart(2, '0')}s`;
  return `+${String(s)}s`;
}
