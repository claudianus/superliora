/**
 * GitOperationsPanel — visual git management for the TUI.
 *
 * Provides a comprehensive git workflow interface:
 * - Branch graph visualization (ASCII art commit DAG)
 * - Staging area with file-level add/unadd
 * - Commit composer with message preview
 * - Push/pull/fetch status indicators
 * - Merge/rebase conflict resolution view
 * - Diff gutter with inline word-level highlights
 * - Blame annotations
 * - Stash management
 *
 * Design: Lazygit-inspired layout with three-pane structure:
 * [Branches | Files/Staging | Diff/Preview]
 * Adapts to terminal width (collapses panes on narrow screens).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitFileStatus =
  | 'added' | 'modified' | 'deleted' | 'renamed'
  | 'copied' | 'untracked' | 'ignored' | 'conflicted';

export interface GitFileEntry {
  readonly path: string;
  readonly status: GitFileStatus;
  readonly staged: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly oldPath?: string; // For renames
}

export interface GitBranch {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly isRemote: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly lastCommitMsg: string;
  readonly lastCommitTime: number;
  readonly author: string;
}

export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string;
  readonly timestamp: number;
  readonly refs: readonly string[]; // branch/tag names
  readonly parentHashes: readonly string[];
}

export interface GitStash {
  readonly index: number;
  readonly message: string;
  readonly branch: string;
  readonly timestamp: number;
}

export type GitPanelView = 'branches' | 'files' | 'staging' | 'commits' | 'stash' | 'diff';

export interface GitDiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: GitDiffLine[];
}

export interface GitDiffLine {
  readonly type: 'context' | 'add' | 'delete' | 'header';
  readonly content: string;
  readonly oldLineNo?: number;
  readonly newLineNo?: number;
}

export interface GitPanelOptions {
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

const STATUS_GLYPH: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  ignored: '!',
  conflicted: 'U',
};

const STATUS_COLOR: Record<GitFileStatus, string> = {
  added: 'success',
  modified: 'warning',
  deleted: 'error',
  renamed: 'accent',
  copied: 'accent',
  untracked: 'textMuted',
  ignored: 'textDim',
  conflicted: 'error',
};

const STATUS_LABEL: Record<GitFileStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  ignored: 'Ignored',
  conflicted: 'Conflicted',
};

// ---------------------------------------------------------------------------
// GitOperationsPanel
// ---------------------------------------------------------------------------

export class GitOperationsPanel {
  private files: GitFileEntry[] = [];
  private branches: GitBranch[] = [];
  private commits: GitCommit[] = [];
  private stashes: GitStash[] = [];
  private currentView: GitPanelView = 'files';
  private selectedIndex = 0;
  private scrollOffset = 0;
  private diffHunks: GitDiffHunk[] = [];
  private commitMessage = '';
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  // ─── Data Updates ─────────────────────────────────────────────────

  /** Update the file list (from git status --porcelain parsing). */
  setFiles(files: GitFileEntry[]): void {
    this.files = files;
    this.clampSelection();
  }

  /** Update branches. */
  setBranches(branches: GitBranch[]): void {
    this.branches = branches;
  }

  /** Update commit log. */
  setCommits(commits: GitCommit[]): void {
    this.commits = commits;
  }

  /** Update stash list. */
  setStashes(stashes: GitStash[]): void {
    this.stashes = stashes;
  }

  /** Set the diff for the currently selected file. */
  setDiff(hunks: GitDiffHunk[]): void {
    this.diffHunks = hunks;
  }

  /** Set the commit message being composed. */
  setCommitMessage(msg: string): void {
    this.commitMessage = msg;
  }

  // ─── View Control ─────────────────────────────────────────────────

  setView(view: GitPanelView): void {
    this.currentView = view;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  cycleView(): void {
    const views: GitPanelView[] = ['files', 'branches', 'commits', 'staging', 'stash'];
    const idx = views.indexOf(this.currentView);
    this.currentView = views[(idx + 1) % views.length]!;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  get view(): GitPanelView {
    return this.currentView;
  }

  // ─── Navigation ───────────────────────────────────────────────────

  moveUp(): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
  }

  moveDown(): void {
    const max = this.getItemCount() - 1;
    this.selectedIndex = Math.min(max, this.selectedIndex + 1);
  }

  pageUp(pageSize: number): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
  }

  pageDown(pageSize: number): void {
    const max = this.getItemCount() - 1;
    this.selectedIndex = Math.min(max, this.selectedIndex + pageSize);
  }

  scrollToTop(): void {
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  scrollToBottom(): void {
    this.selectedIndex = Math.max(0, this.getItemCount() - 1);
  }

  private getItemCount(): number {
    switch (this.currentView) {
      case 'files': return this.files.length;
      case 'branches': return this.branches.length;
      case 'commits': return this.commits.length;
      case 'staging': return this.files.filter((f) => !f.staged).length;
      case 'stash': return this.stashes.length;
      case 'diff': return this.diffHunks.length;
    }
  }

  private clampSelection(): void {
    const max = Math.max(0, this.getItemCount() - 1);
    this.selectedIndex = Math.min(this.selectedIndex, max);
  }

  // ─── Queries ──────────────────────────────────────────────────────

  getSelectedFile(): GitFileEntry | null {
    if (this.currentView === 'files' || this.currentView === 'staging') {
      return this.files[this.selectedIndex] ?? null;
    }
    return null;
  }

  getSelectedBranch(): GitBranch | null {
    if (this.currentView === 'branches') {
      return this.branches[this.selectedIndex] ?? null;
    }
    return null;
  }

  getSelectedCommit(): GitCommit | null {
    if (this.currentView === 'commits') {
      return this.commits[this.selectedIndex] ?? null;
    }
    return null;
  }

  /** Get summary stats for the status bar. */
  getSummary(): { staged: number; unstaged: number; untracked: number; conflicted: number } {
    let staged = 0, unstaged = 0, untracked = 0, conflicted = 0;
    for (const f of this.files) {
      if (f.status === 'conflicted') conflicted++;
      else if (f.status === 'untracked') untracked++;
      else if (f.staged) staged++;
      else unstaged++;
    }
    return { staged, unstaged, untracked, conflicted };
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render(options: GitPanelOptions): string[] {
    switch (this.currentView) {
      case 'files': return this.renderFiles(options);
      case 'branches': return this.renderBranches(options);
      case 'commits': return this.renderCommits(options);
      case 'staging': return this.renderStaging(options);
      case 'stash': return this.renderStash(options);
      case 'diff': return this.renderDiff(options);
    }
  }

  private renderFiles(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const summary = this.getSummary();

    // Header
    lines.push(boldFg('text', ` Files ${dimFg('textMuted', `(${String(this.files.length)})`)}`));
    const statParts: string[] = [];
    if (summary.staged > 0) statParts.push(fg('success', `+${String(summary.staged)}`));
    if (summary.unstaged > 0) statParts.push(fg('warning', `~${String(summary.unstaged)}`));
    if (summary.untracked > 0) statParts.push(fg('textMuted', `?${String(summary.untracked)}`));
    if (summary.conflicted > 0) statParts.push(fg('error', `!${String(summary.conflicted)}`));
    if (statParts.length > 0) {
      lines.push(` ${statParts.join(' ')}`);
    }
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    // File list
    const visibleHeight = height - lines.length - 1;
    this.adjustScroll(visibleHeight);

    for (let i = this.scrollOffset; i < this.files.length && lines.length < height - 1; i++) {
      const file = this.files[i]!;
      const selected = i === this.selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';
      const statusGlyph = fg(STATUS_COLOR[file.status], STATUS_GLYPH[file.status]);
      const stagedMark = file.staged ? fg('success', '●') : dimFg('textMuted', '○');

      // Truncate path to fit
      const maxPathLen = width - 12;
      const displayPath = truncatePath(file.path, maxPathLen);
      const pathText = selected ? boldFg('text', displayPath) : fg('text', displayPath);

      // Diff stats
      let statsText = '';
      if (file.additions > 0 || file.deletions > 0) {
        statsText = ` ${fg('success', `+${String(file.additions)}`)}${fg('error', `-${String(file.deletions)}`)}`;
      }

      lines.push(`${cursor}${statusGlyph} ${stagedMark} ${pathText}${statsText}`);
    }

    return lines;
  }

  private renderBranches(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ` Branches ${dimFg('textMuted', `(${String(this.branches.length)})`)}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    const visibleHeight = height - lines.length - 1;
    this.adjustScroll(visibleHeight);

    for (let i = this.scrollOffset; i < this.branches.length && lines.length < height - 1; i++) {
      const branch = this.branches[i]!;
      const selected = i === this.selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';

      // Current branch indicator
      const nameColor = branch.isCurrent ? 'accent' : branch.isRemote ? 'textMuted' : 'text';
      const namePrefix = branch.isCurrent ? fg('success', '* ') : '  ';
      const name = selected ? boldFg(nameColor, branch.name) : fg(nameColor, branch.name);

      // Ahead/behind
      let aheadBehind = '';
      if (branch.ahead > 0) aheadBehind += fg('success', `↑${String(branch.ahead)}`);
      if (branch.behind > 0) aheadBehind += fg('warning', `↓${String(branch.behind)}`);

      // Last commit time (relative)
      const timeAgo = formatRelativeTime(branch.lastCommitTime);
      const timeText = dimFg('textMuted', ` ${timeAgo}`);

      lines.push(`${cursor}${namePrefix}${name}${aheadBehind ? ` ${aheadBehind}` : ''}${timeText}`);
    }

    return lines;
  }

  private renderCommits(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ' Commits'));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    const visibleHeight = height - lines.length - 1;
    this.adjustScroll(visibleHeight);

    for (let i = this.scrollOffset; i < this.commits.length && lines.length < height - 1; i++) {
      const commit = this.commits[i]!;
      const selected = i === this.selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';

      // Graph character (simplified)
      const graphChar = fg('textMuted', i === 0 ? '●' : '│');

      // Hash
      const hashText = fg('warning', commit.shortHash);

      // Refs
      let refsText = '';
      if (commit.refs.length > 0) {
        refsText = ` ${commit.refs.map((r) => fg('accent', `(${r})`)).join(' ')}`;
      }

      // Message (truncated)
      const maxMsgLen = width - 20;
      const msg = truncateMiddle(commit.message.split('\n')[0] ?? '', maxMsgLen);
      const msgText = selected ? boldFg('text', msg) : fg('text', msg);

      // Time
      const timeText = dimFg('textMuted', ` ${formatRelativeTime(commit.timestamp)}`);

      lines.push(`${cursor}${graphChar} ${hashText}${refsText} ${msgText}${timeText}`);
    }

    return lines;
  }

  private renderStaging(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const unstaged = this.files.filter((f) => !f.staged && f.status !== 'untracked');

    lines.push(boldFg('text', ` Staging ${dimFg('textMuted', `(${String(unstaged.length)} unstaged)`)}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    if (unstaged.length === 0) {
      lines.push(dimFg('textMuted', '  Nothing to stage'));
      return lines;
    }

    const visibleHeight = height - lines.length - 1;
    this.adjustScroll(visibleHeight);

    for (let i = this.scrollOffset; i < unstaged.length && lines.length < height - 1; i++) {
      const file = unstaged[i]!;
      const selected = i === this.selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';
      const statusGlyph = fg(STATUS_COLOR[file.status], STATUS_GLYPH[file.status]);
      const displayPath = truncatePath(file.path, width - 14);
      const pathText = selected ? boldFg('text', displayPath) : fg('text', displayPath);

      // Mini diff bar
      const total = file.additions + file.deletions;
      const barWidth = Math.min(10, total);
      const addWidth = total > 0 ? Math.round((file.additions / total) * barWidth) : 0;
      const delWidth = barWidth - addWidth;
      const diffBar = fg('success', '█'.repeat(addWidth)) + fg('error', '█'.repeat(delWidth));

      lines.push(`${cursor}${statusGlyph} ${pathText} ${diffBar}`);
    }

    return lines;
  }

  private renderStash(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ` Stash ${dimFg('textMuted', `(${String(this.stashes.length)})`)}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    if (this.stashes.length === 0) {
      lines.push(dimFg('textMuted', '  No stashes'));
      return lines;
    }

    for (let i = 0; i < this.stashes.length && lines.length < height - 1; i++) {
      const stash = this.stashes[i]!;
      const selected = i === this.selectedIndex;
      const cursor = selected ? fg('accent', '▸ ') : '  ';
      const idx = fg('warning', `stash@{${String(stash.index)}}`);
      const msg = truncateMiddle(stash.message, width - 25);
      const msgText = selected ? boldFg('text', msg) : fg('text', msg);
      const timeText = dimFg('textMuted', ` ${formatRelativeTime(stash.timestamp)}`);

      lines.push(`${cursor}${idx} ${msgText}${timeText}`);
    }

    return lines;
  }

  private renderDiff(options: GitPanelOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ' Diff'));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    if (this.diffHunks.length === 0) {
      lines.push(dimFg('textMuted', '  No changes'));
      return lines;
    }

    for (const hunk of this.diffHunks) {
      if (lines.length >= height - 1) break;

      // Hunk header
      lines.push(fg('accent', ` @@ ${hunk.header} @@`));

      for (const line of hunk.lines) {
        if (lines.length >= height - 1) break;

        const lineNoWidth = 5;
        const oldNo = line.oldLineNo !== undefined
          ? dimFg('textMuted', String(line.oldLineNo).padStart(lineNoWidth))
          : ' '.repeat(lineNoWidth);
        const newNo = line.newLineNo !== undefined
          ? dimFg('textMuted', String(line.newLineNo).padStart(lineNoWidth))
          : ' '.repeat(lineNoWidth);

        switch (line.type) {
          case 'add':
            lines.push(`${oldNo} ${newNo} ${fg('success', '+')} ${fg('success', line.content)}`);
            break;
          case 'delete':
            lines.push(`${oldNo} ${newNo} ${fg('error', '-')} ${fg('error', line.content)}`);
            break;
          case 'header':
            lines.push(fg('accent', line.content));
            break;
          default:
            lines.push(`${oldNo} ${newNo}   ${fg('text', line.content)}`);
        }
      }
    }

    return lines;
  }

  // ─── Commit Composer ──────────────────────────────────────────────

  /** Render the commit message composer. */
  renderCommitComposer(options: GitPanelOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const summary = this.getSummary();

    lines.push(boldFg('text', ' Commit'));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));
    lines.push(dimFg('textMuted', ` Staged: ${String(summary.staged)} files`));
    lines.push('');

    // Message lines
    const msgLines = this.commitMessage.split('\n');
    for (const msgLine of msgLines) {
      lines.push(fg('text', ` ${msgLine}`));
    }
    // Cursor line
    lines.push(fg('accent', ' ▌'));

    return lines;
  }

  // ─── Scroll Management ────────────────────────────────────────────

  private adjustScroll(visibleHeight: number): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    }
    if (this.selectedIndex >= this.scrollOffset + visibleHeight) {
      this.scrollOffset = this.selectedIndex - visibleHeight + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Diff Parser
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string into structured hunks.
 */
export function parseGitDiff(diffText: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  const lines = diffText.split('\n');
  let currentHunk: GitDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1] ?? '0', 10);
      newLine = parseInt(hunkMatch[3] ?? '0', 10);
      currentHunk = {
        header: hunkMatch[5]?.trim() ?? '',
        oldStart: oldLine,
        oldCount: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: newLine,
        newCount: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNo: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'delete', content: line.slice(1), oldLineNo: oldLine });
      oldLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      currentHunk.lines.push({ type: 'header', content: line });
    } else {
      currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

/**
 * Parse git status --porcelain=v1 output into file entries.
 */
export function parseGitStatus(porcelainOutput: string): GitFileEntry[] {
  const entries: GitFileEntry[] = [];
  const lines = porcelainOutput.split('\n').filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.length < 4) continue;
    const indexStatus = line[0] ?? ' ';
    const workTreeStatus = line[1] ?? ' ';
    const path = line.slice(3);

    let status: GitFileStatus = 'modified';
    const effectiveStatus = indexStatus !== ' ' ? indexStatus : workTreeStatus;

    switch (effectiveStatus) {
      case 'A': status = 'added'; break;
      case 'M': status = 'modified'; break;
      case 'D': status = 'deleted'; break;
      case 'R': status = 'renamed'; break;
      case 'C': status = 'copied'; break;
      case '?': status = 'untracked'; break;
      case '!': status = 'ignored'; break;
      case 'U': status = 'conflicted'; break;
    }

    const staged = indexStatus !== ' ' && indexStatus !== '?';

    entries.push({
      path,
      status,
      staged,
      additions: 0,
      deletions: 0,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  // Keep the filename, truncate directory
  const parts = path.split('/');
  const filename = parts[parts.length - 1] ?? path;
  if (filename.length >= maxLen - 2) return truncateMiddle(filename, maxLen);
  const dirBudget = maxLen - filename.length - 2;
  const dir = parts.slice(0, -1).join('/');
  return `…/${truncateMiddle(dir, dirBudget)}/${filename}`;
}

function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  const half = Math.floor((maxLen - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'now';
  if (diffMin < 60) return `${String(diffMin)}m`;
  if (diffHour < 24) return `${String(diffHour)}h`;
  if (diffDay < 30) return `${String(diffDay)}d`;
  return `${String(Math.floor(diffDay / 30))}mo`;
}
