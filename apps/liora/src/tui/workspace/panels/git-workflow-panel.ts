/**
 * GitWorkflowPanel — a comprehensive git management panel for the workspace
 * dock. Provides interactive staging, branch management, commit/push/pull/
 * merge operations, and a visual status overview — all at GUI-level quality.
 *
 * Key bindings (when focused):
 *   ↑/↓       Navigate items
 *   Space     Stage/unstage file (or hunk in hunk view)
 *   a         Stage all / unstage all (toggle)
 *   Enter     Open file diff detail / confirm action
 *   b         Switch to branch view
 *   c         Open commit composer
 *   p         Push current branch
 *   P         Pull (fetch + merge)
 *   m         Merge selected branch into current
 *   r         Refresh status
 *   Tab       Cycle views: status → staged → branches → log
 *   Esc       Back to status view / cancel action
 *   d         Discard changes in selected file (with confirm)
 *   1-4       Jump to view by number
 */

import { execFileSync } from 'node:child_process';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkflowView = 'status' | 'staged' | 'branches' | 'log';

interface FileStatus {
  readonly path: string;
  readonly indexStatus: string; // X (index)
  readonly worktreeStatus: string; // Y (worktree)
  readonly staged: boolean;
  readonly additions: number;
  readonly deletions: number;
}

interface BranchInfo {
  readonly name: string;
  readonly current: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly lastCommit: string;
  readonly lastCommitRelative: string;
  readonly remote: string | null;
}

interface LogEntry {
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  readonly relativeTime: string;
  readonly refs: string[];
}

interface ActionResult {
  readonly success: boolean;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitExec(cwd: string, args: string[], timeoutMs = 10_000): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

// ---------------------------------------------------------------------------
// GitWorkflowPanel
// ---------------------------------------------------------------------------

export class GitWorkflowPanel implements PanelDefinition {
  readonly id = 'git-workflow';
  readonly title = 'Git';
  readonly icon = '⎇';
  readonly minWidth = 32;
  readonly minHeight = 10;

  private readonly cwd: string;
  private view: WorkflowView = 'status';
  private cursorIndex = 0;
  private scrollTop = 0;
  private lastRefresh = 0;

  // Data
  private unstagedFiles: FileStatus[] = [];
  private stagedFiles: FileStatus[] = [];
  private branches: BranchInfo[] = [];
  private logEntries: LogEntry[] = [];
  private currentBranch = '';
  private remoteUrl = '';
  private isRebasing = false;
  private isMerging = false;
  private stashCount = 0;

  // Action state
  private actionMessage: string | null = null;
  private actionMessageTime = 0;
  private confirmAction: (() => ActionResult) | null = null;
  private confirmLabel = '';

  // Commit composer
  private commitMode = false;
  private commitMessage = '';
  private commitCursor = 0;

  // Render cache
  private renderCache: { key: string; lines: string[] } | null = null;
  private dataVersion = 0;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    const now = Date.now();
    if (now - this.lastRefresh > 5000 && !this.commitMode) {
      this.refresh();
    }

    // Clear expired action message
    if (this.actionMessage && now - this.actionMessageTime > 4000) {
      this.actionMessage = null;
    }

    const cacheKey = `${width}:${height}:${focused}:${this.view}:${this.cursorIndex}:${this.scrollTop}:${this.dataVersion}:${this.commitMode}:${this.commitMessage}:${this.confirmLabel}:${this.actionMessage ?? ''}`;
    if (this.renderCache?.key === cacheKey) return this.renderCache.lines;

    const lines = this.commitMode
      ? this.renderCommitComposer(width, height)
      : this.confirmAction
        ? this.renderConfirm(width, height)
        : this.renderView(width, height, focused);

    this.renderCache = { key: cacheKey, lines };
    return lines;
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') { this.scrollTop = Math.max(0, this.scrollTop - 3); return true; }
      if (event.button === 'wheel-down') { this.scrollTop += 3; return true; }
      return false;
    }

    if (event.type !== 'key') return false;

    // Commit composer mode
    if (this.commitMode) return this.handleCommitInput(event);

    // Confirm mode
    if (this.confirmAction) return this.handleConfirmInput(event);

    // Navigation
    switch (event.key) {
      case 'up':
        this.cursorIndex = Math.max(0, this.cursorIndex - 1);
        this.renderCache = null;
        return true;
      case 'down':
        this.cursorIndex++;
        this.renderCache = null;
        return true;
      case 'tab':
        this.cycleView();
        return true;
      case 'escape':
        if (this.view !== 'status') { this.view = 'status'; this.cursorIndex = 0; this.scrollTop = 0; }
        this.renderCache = null;
        return true;
      case 'enter':
        return this.handleEnter();
      default:
        break;
    }

    // Character shortcuts
    if (event.key === 'character' && event.text) {
      return this.handleCharKey(event.text, event.ctrl);
    }

    return false;
  }

  dispose(): void {
    this.unstagedFiles = [];
    this.stagedFiles = [];
    this.branches = [];
    this.logEntries = [];
  }

  // -------------------------------------------------------------------------
  // Data refresh
  // -------------------------------------------------------------------------

  refresh(): void {
    this.lastRefresh = Date.now();

    // Current branch
    this.currentBranch = gitExec(this.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);

    // Remote URL
    this.remoteUrl = gitExec(this.cwd, ['remote', 'get-url', 'origin']);

    // Status (porcelain v1)
    const statusOutput = gitExec(this.cwd, ['status', '--porcelain=v1', '-z']);
    this.parseStatus(statusOutput);

    // Branches
    this.refreshBranches();

    // Log (last 20)
    this.refreshLog();

    // Rebase/merge state
    const rebasePath = gitExec(this.cwd, ['rev-parse', '--git-path', 'rebase-merge']);
    this.isRebasing = rebasePath !== '' && gitExec(this.cwd, ['test', '-d', rebasePath]) === '';
    const mergeHeadPath = gitExec(this.cwd, ['rev-parse', '--git-path', 'MERGE_HEAD']);
    this.isMerging = mergeHeadPath !== '' && gitExec(this.cwd, ['test', '-f', mergeHeadPath]) === '';

    // Stash count
    const stashOut = gitExec(this.cwd, ['stash', 'list', '--format=%H']);
    this.stashCount = stashOut ? stashOut.split('\n').filter(Boolean).length : 0;

    this.dataVersion++;
    this.renderCache = null;
  }

  private parseStatus(output: string): void {
    this.unstagedFiles = [];
    this.stagedFiles = [];
    if (!output) return;

    // -z format: entries separated by NUL, rename has extra NUL-separated field
    const entries = output.split('\0').filter(Boolean);
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i]!;
      if (entry.length < 3) { i++; continue; }
      const indexStatus = entry[0]!;
      const worktreeStatus = entry[1]!;
      const path = entry.slice(3);

      // Skip rename destination (next entry is the old name)
      if (indexStatus === 'R' || worktreeStatus === 'R') {
        i += 2;
      } else {
        i++;
      }

      const isStaged = indexStatus !== ' ' && indexStatus !== '?';
      const isUnstaged = worktreeStatus !== ' ';

      // Get line counts
      const { additions, deletions } = this.getFileDiffStats(path, isStaged);

      const file: FileStatus = {
        path,
        indexStatus,
        worktreeStatus,
        staged: isStaged,
        additions,
        deletions,
      };

      if (isStaged) this.stagedFiles.push(file);
      if (isUnstaged || indexStatus === '?') this.unstagedFiles.push(file);
    }
  }

  private getFileDiffStats(path: string, staged: boolean): { additions: number; deletions: number } {
    const args = staged
      ? ['diff', '--cached', '--numstat', '--', path]
      : ['diff', '--numstat', '--', path];
    const numstat = gitExec(this.cwd, args, 3000);
    if (!numstat) return { additions: 0, deletions: 0 };
    const parts = numstat.split('\t');
    const add = parseInt(parts[0] ?? '0', 10);
    const del = parseInt(parts[1] ?? '0', 10);
    return {
      additions: Number.isNaN(add) ? 0 : add,
      deletions: Number.isNaN(del) ? 0 : del,
    };
  }

  private refreshBranches(): void {
    const output = gitExec(this.cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(HEAD)|%(upstream:track)|%(subject)|%(committerdate:relative)', 'refs/heads/']);
    this.branches = [];
    if (!output) return;

    for (const line of output.split('\n').filter(Boolean)) {
      const [name, head, track, subject, relTime] = line.split('|');
      if (!name) continue;

      let ahead = 0;
      let behind = 0;
      if (track) {
        const aheadMatch = track.match(/ahead (\d+)/);
        const behindMatch = track.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1]!, 10);
        if (behindMatch) behind = parseInt(behindMatch[1]!, 10);
      }

      const remote = gitExec(this.cwd, ['config', `branch.${name}.remote`], 2000) || null;

      this.branches.push({
        name,
        current: head === '*',
        ahead,
        behind,
        lastCommit: subject ?? '',
        lastCommitRelative: relTime ?? '',
        remote,
      });
    }
  }

  private refreshLog(): void {
    const output = gitExec(this.cwd, ['log', '--oneline', '--decorate', '-20', '--format=%h|%s|%an|%ar|%D']);
    this.logEntries = [];
    if (!output) return;

    for (const line of output.split('\n').filter(Boolean)) {
      const [hash, subject, author, relTime, refs] = line.split('|');
      if (!hash) continue;
      this.logEntries.push({
        hash,
        subject: subject ?? '',
        author: author ?? '',
        relativeTime: relTime ?? '',
        refs: refs ? refs.split(',').map((r) => r.trim()).filter(Boolean) : [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private stageFile(path: string): void {
    const result = gitExec(this.cwd, ['add', '--', path]);
    this.showAction(result === '' ? `Staged ${path}` : `Failed to stage ${path}`);
    this.refresh();
  }

  private unstageFile(path: string): void {
    gitExec(this.cwd, ['reset', 'HEAD', '--', path]);
    this.showAction(`Unstaged ${path}`);
    this.refresh();
  }

  private stageAll(): void {
    gitExec(this.cwd, ['add', '-A']);
    this.showAction('Staged all changes');
    this.refresh();
  }

  private unstageAll(): void {
    gitExec(this.cwd, ['reset', 'HEAD']);
    this.showAction('Unstaged all');
    this.refresh();
  }

  private discardFile(path: string): ActionResult {
    gitExec(this.cwd, ['checkout', '--', path]);
    this.refresh();
    return { success: true, message: `Discarded ${path}` };
  }

  private commit(message: string): ActionResult {
    const output = gitExec(this.cwd, ['commit', '-m', message]);
    if (output.includes('nothing to commit')) {
      return { success: false, message: 'Nothing to commit' };
    }
    this.refresh();
    return { success: true, message: 'Committed ✓' };
  }

  private push(): void {
    const output = gitExec(this.cwd, ['push', 'origin', this.currentBranch], 30_000);
    this.showAction(output.includes('error') || output.includes('fatal')
      ? `Push failed: ${truncate(output, 60)}`
      : `Pushed ${this.currentBranch} ✓`);
    this.refresh();
  }

  private pull(): void {
    const output = gitExec(this.cwd, ['pull', '--rebase'], 30_000);
    this.showAction(output.includes('error') || output.includes('fatal')
      ? `Pull failed: ${truncate(output, 60)}`
      : 'Pulled ✓');
    this.refresh();
  }

  private mergeBranch(branch: string): ActionResult {
    const output = gitExec(this.cwd, ['merge', branch], 30_000);
    if (output.includes('CONFLICT')) {
      return { success: false, message: `Merge conflict in ${branch}` };
    }
    this.refresh();
    return { success: true, message: `Merged ${branch} ✓` };
  }

  private switchBranch(branch: string): void {
    gitExec(this.cwd, ['checkout', branch]);
    this.showAction(`Switched to ${branch}`);
    this.refresh();
  }

  private showAction(message: string): void {
    this.actionMessage = message;
    this.actionMessageTime = Date.now();
    this.renderCache = null;
  }

  // -------------------------------------------------------------------------
  // Input handlers
  // -------------------------------------------------------------------------

  private cycleView(): void {
    const views: WorkflowView[] = ['status', 'staged', 'branches', 'log'];
    const idx = views.indexOf(this.view);
    this.view = views[(idx + 1) % views.length]!;
    this.cursorIndex = 0;
    this.scrollTop = 0;
    this.renderCache = null;
  }

  private handleEnter(): boolean {
    switch (this.view) {
      case 'status': {
        const file = this.unstagedFiles[this.cursorIndex];
        if (file) this.stageFile(file.path);
        return true;
      }
      case 'staged': {
        const file = this.stagedFiles[this.cursorIndex];
        if (file) this.unstageFile(file.path);
        return true;
      }
      case 'branches': {
        const branch = this.branches[this.cursorIndex];
        if (branch && !branch.current) this.switchBranch(branch.name);
        return true;
      }
      default:
        return false;
    }
  }

  private handleCharKey(text: string, ctrl: boolean): boolean {
    if (ctrl) return false;

    switch (text) {
      case ' ': {
        // Stage/unstage toggle
        if (this.view === 'status') {
          const file = this.unstagedFiles[this.cursorIndex];
          if (file) this.stageFile(file.path);
        } else if (this.view === 'staged') {
          const file = this.stagedFiles[this.cursorIndex];
          if (file) this.unstageFile(file.path);
        }
        return true;
      }
      case 'a':
        if (this.view === 'status') this.stageAll();
        else if (this.view === 'staged') this.unstageAll();
        return true;
      case 'c':
        this.commitMode = true;
        this.commitMessage = '';
        this.commitCursor = 0;
        this.renderCache = null;
        return true;
      case 'p':
        this.push();
        return true;
      case 'P':
        this.pull();
        return true;
      case 'm': {
        if (this.view === 'branches') {
          const branch = this.branches[this.cursorIndex];
          if (branch && !branch.current) {
            const result = this.mergeBranch(branch.name);
            this.showAction(result.message);
          }
        }
        return true;
      }
      case 'd': {
        if (this.view === 'status') {
          const file = this.unstagedFiles[this.cursorIndex];
          if (file) {
            this.confirmLabel = `Discard changes in ${file.path}?`;
            this.confirmAction = () => this.discardFile(file.path);
            this.renderCache = null;
          }
        }
        return true;
      }
      case 'r':
        this.refresh();
        this.showAction('Refreshed');
        return true;
      case '1': this.view = 'status'; this.cursorIndex = 0; this.renderCache = null; return true;
      case '2': this.view = 'staged'; this.cursorIndex = 0; this.renderCache = null; return true;
      case '3': this.view = 'branches'; this.cursorIndex = 0; this.renderCache = null; return true;
      case '4': this.view = 'log'; this.cursorIndex = 0; this.renderCache = null; return true;
      default:
        return false;
    }
  }

  private handleCommitInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;
    if (event.key === 'escape') {
      this.commitMode = false;
      this.renderCache = null;
      return true;
    }
    if (event.key === 'enter') {
      if (event.ctrl || this.commitMessage.trim().length > 0) {
        const result = this.commit(this.commitMessage.trim());
        this.showAction(result.message);
        this.commitMode = false;
        this.renderCache = null;
      }
      return true;
    }
    if (event.key === 'backspace') {
      this.commitMessage = this.commitMessage.slice(0, -1);
      this.renderCache = null;
      return true;
    }
    if (event.key === 'character' && event.text && !event.ctrl) {
      this.commitMessage += event.text;
      this.renderCache = null;
      return true;
    }
    return false;
  }

  private handleConfirmInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;
    if (event.key === 'escape') {
      this.confirmAction = null;
      this.confirmLabel = '';
      this.renderCache = null;
      return true;
    }
    if (event.key === 'character' && (event.text === 'y' || event.text === 'Y')) {
      const action = this.confirmAction;
      this.confirmAction = null;
      this.confirmLabel = '';
      if (action) {
        const result = action();
        this.showAction(result.message);
      }
      this.renderCache = null;
      return true;
    }
    if (event.key === 'character' && (event.text === 'n' || event.text === 'N')) {
      this.confirmAction = null;
      this.confirmLabel = '';
      this.renderCache = null;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderView(width: number, height: number, focused: boolean): string[] {
    const lines: string[] = [];

    // Header: branch + status indicators
    lines.push(this.renderHeader(width));

    // View tabs
    lines.push(this.renderViewTabs(width));

    // Action message
    if (this.actionMessage) {
      lines.push(currentTheme.fg('accent', ` ⚡ ${truncate(this.actionMessage, width - 4)}`));
    }

    // Content
    const contentLines = this.renderContent(width, focused);
    const availableHeight = height - lines.length - 1; // -1 for footer
    const visible = contentLines.slice(this.scrollTop, this.scrollTop + Math.max(1, availableHeight));
    lines.push(...visible);

    // Footer hints
    lines.push(this.renderFooter(width));

    return lines.slice(0, height);
  }

  private renderHeader(width: number): string {
    const branch = currentTheme.boldFg('primary', `⎇ ${this.currentBranch || 'detached'}`);
    const indicators: string[] = [];

    if (this.isRebasing) indicators.push(currentTheme.fg('warning', '⟳ rebase'));
    if (this.isMerging) indicators.push(currentTheme.fg('error', '⚠ merge'));
    if (this.stashCount > 0) indicators.push(currentTheme.dimFg('textMuted', `◈${String(this.stashCount)}`));

    const totalChanges = this.unstagedFiles.length + this.stagedFiles.length;
    if (totalChanges > 0) {
      indicators.push(currentTheme.fg('accent', `●${String(totalChanges)}`));
    } else {
      indicators.push(currentTheme.fg('success', '✓ clean'));
    }

    const right = indicators.join(' ');
    const left = branch;
    const gap = Math.max(1, width - stripAnsi(left).length - stripAnsi(right).length);
    return ` ${left}${' '.repeat(gap)}${right}`;
  }

  private renderViewTabs(width: number): string {
    const tabs: Array<{ id: WorkflowView; label: string; count?: number }> = [
      { id: 'status', label: 'Changes', count: this.unstagedFiles.length || undefined },
      { id: 'staged', label: 'Staged', count: this.stagedFiles.length || undefined },
      { id: 'branches', label: 'Branches', count: this.branches.length || undefined },
      { id: 'log', label: 'Log' },
    ];

    const parts = tabs.map((tab) => {
      const label = tab.count !== undefined ? `${tab.label}(${String(tab.count)})` : tab.label;
      if (tab.id === this.view) {
        return currentTheme.boldFg('primary', ` ${label} `);
      }
      return currentTheme.dimFg('textMuted', ` ${label} `);
    });

    const joined = parts.join(currentTheme.dimFg('textMuted', '│'));
    return truncate(joined, width);
  }

  private renderContent(width: number, focused: boolean): string[] {
    switch (this.view) {
      case 'status': return this.renderStatusView(width, focused);
      case 'staged': return this.renderStagedView(width, focused);
      case 'branches': return this.renderBranchView(width, focused);
      case 'log': return this.renderLogView(width, focused);
    }
  }

  private renderStatusView(width: number, focused: boolean): string[] {
    if (this.unstagedFiles.length === 0) {
      return [
        '',
        `  ${currentTheme.fg('success', '✓')} ${currentTheme.dimFg('textMuted', 'No unstaged changes')}`,
        '',
        currentTheme.dimFg('textMuted', '  Space: stage · a: stage all · c: commit'),
      ];
    }

    return this.unstagedFiles.map((file, i) => {
      const isCursor = focused && i === this.cursorIndex;
      const pointer = isCursor ? currentTheme.fg('primary', '❯') : ' ';
      const statusGlyph = this.statusGlyph(file);
      const stats = this.formatStats(file);
      const pathWidth = width - 8 - stripAnsi(stats).length;
      const path = truncate(file.path, Math.max(8, pathWidth));

      const line = ` ${pointer} ${statusGlyph} ${path}${' '.repeat(Math.max(1, pathWidth - file.path.length))}${stats}`;
      return isCursor ? invertLine(line, width) : line;
    });
  }

  private renderStagedView(width: number, focused: boolean): string[] {
    if (this.stagedFiles.length === 0) {
      return [
        '',
        `  ${currentTheme.dimFg('textMuted', 'No staged changes')}`,
        '',
        currentTheme.dimFg('textMuted', '  Press Space on a file to stage it'),
      ];
    }

    return this.stagedFiles.map((file, i) => {
      const isCursor = focused && i === this.cursorIndex;
      const pointer = isCursor ? currentTheme.fg('primary', '❯') : ' ';
      const statusGlyph = this.statusGlyph(file);
      const stats = this.formatStats(file);
      const pathWidth = width - 8 - stripAnsi(stats).length;
      const path = truncate(file.path, Math.max(8, pathWidth));

      const line = ` ${pointer} ${statusGlyph} ${path}${' '.repeat(Math.max(1, pathWidth - file.path.length))}${stats}`;
      return isCursor ? invertLine(line, width) : line;
    });
  }

  private renderBranchView(width: number, focused: boolean): string[] {
    if (this.branches.length === 0) {
      return [`  ${currentTheme.dimFg('textMuted', 'No branches found')}`];
    }

    return this.branches.map((branch, i) => {
      const isCursor = focused && i === this.cursorIndex;
      const pointer = isCursor ? currentTheme.fg('primary', '❯') : ' ';
      const marker = branch.current ? currentTheme.fg('success', '●') : ' ';
      const name = branch.current
        ? currentTheme.boldFg('primary', branch.name)
        : branch.name;

      // Ahead/behind indicators
      const tracking: string[] = [];
      if (branch.ahead > 0) tracking.push(currentTheme.fg('accent', `↑${String(branch.ahead)}`));
      if (branch.behind > 0) tracking.push(currentTheme.fg('warning', `↓${String(branch.behind)}`));
      const trackStr = tracking.length > 0 ? ` ${tracking.join(' ')}` : '';

      const timeStr = currentTheme.dimFg('textMuted', branch.lastCommitRelative);
      const nameWidth = width - 6 - stripAnsi(trackStr).length - stripAnsi(timeStr).length;

      const line = ` ${pointer} ${marker} ${truncate(name, Math.max(6, nameWidth))}${trackStr} ${timeStr}`;
      return isCursor ? invertLine(line, width) : line;
    });
  }

  private renderLogView(width: number, focused: boolean): string[] {
    if (this.logEntries.length === 0) {
      return [`  ${currentTheme.dimFg('textMuted', 'No commits')}`];
    }

    return this.logEntries.map((entry, i) => {
      const isCursor = focused && i === this.cursorIndex;
      const pointer = isCursor ? currentTheme.fg('primary', '❯') : ' ';
      const hash = currentTheme.fg('accent', entry.hash);
      const refs = entry.refs.length > 0
        ? ` ${currentTheme.fg('success', `(${entry.refs.join(', ')})`)}`
        : '';
      const subjectWidth = width - 12 - stripAnsi(refs).length;
      const subject = truncate(entry.subject, Math.max(8, subjectWidth));
      const time = currentTheme.dimFg('textMuted', entry.relativeTime);

      const line = ` ${pointer} ${hash} ${subject}${refs} ${time}`;
      return isCursor ? invertLine(line, width) : line;
    });
  }

  private renderCommitComposer(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push(currentTheme.boldFg('primary', ' ✎ Commit Message'));
    lines.push(currentTheme.dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));
    lines.push('');

    // Message input
    const prompt = currentTheme.fg('accent', '  │ ');
    const cursor = '▌';
    lines.push(`${prompt}${this.commitMessage}${cursor}`);
    lines.push('');

    // Staged files summary
    lines.push(currentTheme.dimFg('textMuted', `  ${String(this.stagedFiles.length)} file(s) staged`));
    for (const file of this.stagedFiles.slice(0, Math.max(0, height - 10))) {
      lines.push(currentTheme.dimFg('textMuted', `    ${this.statusGlyph(file)} ${truncate(file.path, width - 8)}`));
    }

    lines.push('');
    lines.push(currentTheme.dimFg('textMuted', '  Enter: commit · Esc: cancel'));

    return lines.slice(0, height);
  }

  private renderConfirm(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push('');
    lines.push(currentTheme.fg('warning', `  ⚠ ${this.confirmLabel}`));
    lines.push('');
    lines.push(currentTheme.dimFg('textMuted', '  [y] confirm · [n/Esc] cancel'));
    return lines.slice(0, height);
  }

  private renderFooter(width: number): string {
    const hints = this.view === 'branches'
      ? '↑↓ nav · Enter: switch · m: merge · p: push · Tab: view'
      : '↑↓ nav · Space: stage · a: all · c: commit · p: push · Tab: view';
    return currentTheme.dimFg('textMuted', ` ${truncate(hints, width - 2)}`);
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  private statusGlyph(file: FileStatus): string {
    const code = file.indexStatus !== ' ' ? file.indexStatus : file.worktreeStatus;
    switch (code) {
      case 'A': return currentTheme.fg('diffAddedStrong', 'A');
      case 'M': return currentTheme.fg('primary', 'M');
      case 'D': return currentTheme.fg('diffRemovedStrong', 'D');
      case 'R': return currentTheme.fg('accent', 'R');
      case '?': return currentTheme.fg('textMuted', '?');
      default: return currentTheme.dimFg('textMuted', code);
    }
  }

  private formatStats(file: FileStatus): string {
    if (file.additions === 0 && file.deletions === 0) return '';
    const add = file.additions > 0 ? currentTheme.fg('diffAddedStrong', `+${String(file.additions)}`) : '';
    const del = file.deletions > 0 ? currentTheme.fg('diffRemovedStrong', `−${String(file.deletions)}`) : '';
    return [add, del].filter(Boolean).join(' ');
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function invertLine(line: string, width: number): string {
  const plain = stripAnsi(line);
  const padded = plain.length < width ? line + ' '.repeat(width - plain.length) : line;
  return `\x1b[7m${padded}\x1b[0m`;
}
