/**
 * Quest Expand View — renders the expanded (pinned) quest's live stream.
 *
 * When a quest is pinned, this view occupies 60–70% of the bento grid
 * and shows the agent's real-time output (terminal-in-terminal style).
 *
 * AC-3: expand view shows agent live stream, scrollable.
 *       Diff view is Gen 2+ (out of scope for Gen 1).
 */

import {
  type Quest,
  formatChangeCount,
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
// QuestExpandView
// ---------------------------------------------------------------------------

export class QuestExpandView {
  private streamLines: string[] = [];
  private scrollOffset = 0;
  private maxVisibleLines = 20;

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
    const followBottom = this.isAtBottom();
    this.streamLines.push(line);
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
    const followBottom = this.isAtBottom();
    for (const line of lines) {
      this.streamLines.push(line);
    }
    if (followBottom) {
      this.scrollOffset = Math.max(
        0,
        this.streamLines.length - this.maxVisibleLines,
      );
    }
  }

  /** Clear the stream. */
  clear(): void {
    this.streamLines = [];
    this.scrollOffset = 0;
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

  /** Get the currently visible lines. */
  getVisibleLines(): readonly string[] {
    return this.streamLines.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisibleLines,
    );
  }

  /** Get total line count. */
  get totalLines(): number {
    return this.streamLines.length;
  }

  /** Get current scroll offset. */
  get currentScrollOffset(): number {
    return this.scrollOffset;
  }

  /** Render the expand view as a string array (one per visible row). */
  render(quest: Quest, width: number): string[] {
    const lines: string[] = [];

    // Gen 14: scroll position indicator — shows where the viewport sits in the
    // stream, and flags when the user has scrolled away from the live tail.
    const total = this.streamLines.length;
    const maxOffset = Math.max(0, total - this.maxVisibleLines);
    const atBottom = this.scrollOffset >= maxOffset;
    const scrollInfo =
      total <= this.maxVisibleLines
        ? `${String(total)} lines`
        : `${String(this.scrollOffset + 1)}–${String(Math.min(total, this.scrollOffset + this.maxVisibleLines))}/${String(total)}`;
    const scrollTag = atBottom ? scrollInfo : `${scrollInfo} ↑`;

    // Gen 11: rich header with quest metadata
    const headerLine1 = `── ${quest.name} [${quest.state}]  ${scrollTag} ──`;
    lines.push(headerLine1.length > width ? headerLine1.slice(0, width) : headerLine1);

    // Second header line: worktree + change count
    const changes = formatChangeCount(quest.changeCount);
    const worktree = quest.worktreePath.length > 40
      ? `…${quest.worktreePath.slice(-39)}`
      : quest.worktreePath;
    const headerLine2 = `   ${worktree}  ${changes}`;
    lines.push(headerLine2.length > width ? headerLine2.slice(0, width) : headerLine2);

    // Third header line: todo progress + context usage + plan step
    const progressParts: string[] = [];
    if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
      const { done, total } = quest.todoProgress;
      progressParts.push(`☑ ${String(done)}/${String(total)}`);
    }
    if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
      const pct = Math.round(quest.contextUsage * 100);
      progressParts.push(`ctx ${String(pct)}%`);
    }
    const progress = progressParts.length > 0 ? progressParts.join('  ') + '  ' : '';
    // Gen 13: surface the pending approval in the header when awaiting one.
    const stepText =
      quest.state === 'waiting-approval' && quest.pendingApprovalSummary !== undefined
        ? `⚡ ${quest.pendingApprovalSummary}`
        : `▸ ${quest.planStep}`;
    const headerLine3 = `   ${progress}${stepText}`;
    lines.push(headerLine3.length > width ? headerLine3.slice(0, width) : headerLine3);

    // Separator
    lines.push('─'.repeat(Math.min(width, 60)));

    const visible = this.getVisibleLines();
    for (const line of visible) {
      lines.push(line.length > width ? line.slice(0, width) : line);
    }
    // Pad to maxVisibleLines + 4 (3 header lines + separator)
    while (lines.length < this.maxVisibleLines + 4) {
      lines.push('');
    }
    return lines;
  }
}
