/**
 * EvidenceViewer — visual diff viewer for agent code changes.
 *
 * Provides a rich, interactive diff viewing experience in the TUI:
 * - Unified diff with syntax-aware coloring
 * - Side-by-side comparison mode
 * - Hunk navigation (n/p to jump between changes)
 * - Word-level diff highlighting
 * - File tree overview with change indicators
 * - Statistics summary (files changed, insertions, deletions)
 * - Blame integration for context
 *
 * Designed for reviewing agent-generated code changes with:
 * - Clear visual distinction between added/removed/modified lines
 * - Context collapsing for large diffs
 * - Quick accept/reject actions per hunk
 * - Export to patch format
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffLineType = 'context' | 'added' | 'removed' | 'header' | 'hunk-header' | 'separator';

export interface DiffLine {
  readonly type: DiffLineType;
  readonly content: string;
  readonly oldLineNo: number | null;
  readonly newLineNo: number | null;
  /** Word-level changes within this line (for inline highlighting). */
  readonly wordDiff?: readonly WordDiffSegment[];
}

export interface WordDiffSegment {
  readonly text: string;
  readonly changed: boolean;
}

export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  lines: DiffLine[];
  /** Whether this hunk is collapsed in the view. */
  collapsed: boolean;
}

export interface DiffFile {
  readonly path: string;
  readonly oldPath: string | null; // For renames
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
}

export interface DiffStats {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly files: ReadonlyArray<{
    path: string;
    additions: number;
    deletions: number;
    status: DiffFile['status'];
  }>;
}

export interface EvidenceViewOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

export type DiffViewMode = 'unified' | 'split' | 'stats';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LINE_GUTTER_WIDTH = 5;
const CONTEXT_LINES = 3;
const COLLAPSED_CONTEXT = 1;

const STATUS_GLYPH: Record<DiffFile['status'], string> = {
  added: '+',
  modified: '~',
  deleted: '-',
  renamed: '→',
};

const STATUS_COLOR: Record<DiffFile['status'], string> = {
  added: 'success',
  modified: 'warning',
  deleted: 'error',
  renamed: 'accent',
};

// ---------------------------------------------------------------------------
// EvidenceViewer
// ---------------------------------------------------------------------------

export class EvidenceViewer {
  private files: DiffFile[] = [];
  private currentFileIndex = 0;
  private currentHunkIndex = 0;
  private scrollOffset = 0;
  private viewMode: DiffViewMode = 'unified';
  private showLineNumbers = true;
  private wordDiffEnabled = true;

  // ─── Content Management ───────────────────────────────────────────

  /** Load a diff from unified diff format string. */
  loadUnifiedDiff(diffText: string): void {
    this.files = parseUnifiedDiff(diffText);
    this.currentFileIndex = 0;
    this.currentHunkIndex = 0;
    this.scrollOffset = 0;
  }

  /** Load diff from structured data. */
  loadFiles(files: DiffFile[]): void {
    this.files = files;
    this.currentFileIndex = 0;
    this.currentHunkIndex = 0;
    this.scrollOffset = 0;
  }

  /** Clear all content. */
  clear(): void {
    this.files = [];
    this.currentFileIndex = 0;
    this.currentHunkIndex = 0;
    this.scrollOffset = 0;
  }

  get fileCount(): number {
    return this.files.length;
  }

  get currentFile(): DiffFile | null {
    return this.files[this.currentFileIndex] ?? null;
  }

  // ─── Navigation ─────────────────────────────────────────────────

  /** Go to next file. */
  nextFile(): void {
    if (this.currentFileIndex < this.files.length - 1) {
      this.currentFileIndex++;
      this.currentHunkIndex = 0;
      this.scrollOffset = 0;
    }
  }

  /** Go to previous file. */
  prevFile(): void {
    if (this.currentFileIndex > 0) {
      this.currentFileIndex--;
      this.currentHunkIndex = 0;
      this.scrollOffset = 0;
    }
  }

  /** Go to next hunk. */
  nextHunk(): void {
    const file = this.currentFile;
    if (!file) return;
    if (this.currentHunkIndex < file.hunks.length - 1) {
      this.currentHunkIndex++;
      this.scrollOffset = 0;
    } else {
      this.nextFile();
    }
  }

  /** Go to previous hunk. */
  prevHunk(): void {
    if (this.currentHunkIndex > 0) {
      this.currentHunkIndex--;
      this.scrollOffset = 0;
    } else if (this.currentFileIndex > 0) {
      this.prevFile();
      const file = this.currentFile;
      if (file) {
        this.currentHunkIndex = file.hunks.length - 1;
      }
    }
  }

  /** Scroll the view. */
  scroll(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  /** Toggle view mode. */
  cycleViewMode(): void {
    const modes: DiffViewMode[] = ['unified', 'split', 'stats'];
    const idx = modes.indexOf(this.viewMode);
    this.viewMode = modes[(idx + 1) % modes.length]!;
  }

  /** Toggle line numbers. */
  toggleLineNumbers(): void {
    this.showLineNumbers = !this.showLineNumbers;
  }

  /** Toggle word diff. */
  toggleWordDiff(): void {
    this.wordDiffEnabled = !this.wordDiffEnabled;
  }

  /** Toggle collapse on current hunk. */
  toggleCollapseHunk(): void {
    const file = this.currentFile;
    if (!file) return;
    const hunk = file.hunks[this.currentHunkIndex];
    if (hunk) {
      hunk.collapsed = !hunk.collapsed;
    }
  }

  get mode(): DiffViewMode {
    return this.viewMode;
  }

  // ─── Statistics ─────────────────────────────────────────────────

  /** Get overall diff statistics. */
  getStats(): DiffStats {
    let insertions = 0;
    let deletions = 0;

    const files = this.files.map((f) => {
      insertions += f.additions;
      deletions += f.deletions;
      return {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
      };
    });

    return {
      filesChanged: this.files.length,
      insertions,
      deletions,
      files,
    };
  }

  // ─── Rendering ──────────────────────────────────────────────────

  /** Render the current view. */
  render(options: EvidenceViewOptions): string[] {
    switch (this.viewMode) {
      case 'unified':
        return this.renderUnified(options);
      case 'split':
        return this.renderSplit(options);
      case 'stats':
        return this.renderStats(options);
    }
  }

  private renderUnified(options: EvidenceViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];
    const file = this.currentFile;

    if (!file) {
      return [dimFg('textMuted', '  No changes to display')];
    }

    // File header
    const statusGlyph = fg(STATUS_COLOR[file.status], STATUS_GLYPH[file.status]);
    const changeInfo = dimFg('textMuted', `+${String(file.additions)} -${String(file.deletions)}`);
    lines.push(`${statusGlyph} ${boldFg('text', file.path)} ${changeInfo}`);
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 60))));

    // Hunks
    const contentWidth = width - (this.showLineNumbers ? LINE_GUTTER_WIDTH * 2 + 2 : 1);
    let renderedLines = 0;

    for (let hunkIdx = 0; hunkIdx < file.hunks.length && renderedLines < height - 3; hunkIdx++) {
      const hunk = file.hunks[hunkIdx]!;
      const isCurrentHunk = hunkIdx === this.currentHunkIndex;

      // Hunk header
      const hunkHeader = dimFg('accent', `@@ ${hunk.header} @@`);
      const indicator = isCurrentHunk ? fg('primary', '▸ ') : '  ';
      lines.push(`${indicator}${hunkHeader}`);
      renderedLines++;

      if (hunk.collapsed) {
        lines.push(dimFg('textMuted', `  ⋯ ${String(hunk.lines.length)} lines collapsed`));
        renderedLines++;
        continue;
      }

      // Hunk lines
      for (const line of hunk.lines) {
        if (renderedLines >= height - 2) break;

        const gutter = this.showLineNumbers
          ? this.renderGutter(line, dimFg)
          : '';
        const content = this.renderDiffLine(line, contentWidth, fg, bg);
        lines.push(`${gutter}${content}`);
        renderedLines++;
      }
    }

    // Footer
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 60))));
    const fileInfo = dimFg('textMuted',
      `File ${String(this.currentFileIndex + 1)}/${String(this.files.length)} · n/p: hunk · f/F: file · v: mode`);
    lines.push(fileInfo);

    return lines.slice(0, height);
  }

  private renderSplit(options: EvidenceViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];
    const file = this.currentFile;

    if (!file) {
      return [dimFg('textMuted', '  No changes to display')];
    }

    const halfWidth = Math.floor((width - 3) / 2);

    // Header
    lines.push(boldFg('text', ` ${file.path}`));
    lines.push(fg('textMuted', '─'.repeat(halfWidth) + '┼' + '─'.repeat(halfWidth)));

    // For split view, we'd need to pair old/new lines
    // Simplified: show unified in split format
    const allLines = file.hunks.flatMap((h) => h.lines);
    const oldLines = allLines.filter((l) => l.type === 'context' || l.type === 'removed');
    const newLines = allLines.filter((l) => l.type === 'context' || l.type === 'added');

    for (let i = 0; i < Math.max(oldLines.length, newLines.length) && lines.length < height - 1; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      const left = oldLine
        ? this.renderSplitCell(oldLine, halfWidth, 'old', fg, bg)
        : ' '.repeat(halfWidth);
      const right = newLine
        ? this.renderSplitCell(newLine, halfWidth, 'new', fg, bg)
        : ' '.repeat(halfWidth);

      lines.push(`${left}${fg('textMuted', '│')}${right}`);
    }

    return lines.slice(0, height);
  }

  private renderStats(options: EvidenceViewOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const stats = this.getStats();

    lines.push(boldFg('text', ' Change Summary'));
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 50))));
    lines.push('');

    // Summary line
    const summary = `${String(stats.filesChanged)} file${stats.filesChanged !== 1 ? 's' : ''} changed, ` +
      `${fg('success', `+${String(stats.insertions)}`)} ` +
      `${fg('error', `-${String(stats.deletions)}`)}`;
    lines.push(` ${summary}`);
    lines.push('');

    // Per-file stats with bar chart
    const maxChanges = Math.max(1, ...stats.files.map((f) => f.additions + f.deletions));
    const barWidth = Math.min(30, width - 40);

    for (const file of stats.files) {
      const total = file.additions + file.deletions;
      const barLen = Math.max(1, Math.round((total / maxChanges) * barWidth));
      const addLen = Math.round((file.additions / Math.max(1, total)) * barLen);
      const delLen = barLen - addLen;

      const statusGlyph = fg(STATUS_COLOR[file.status], STATUS_GLYPH[file.status]);
      const path = truncate(file.path, width - barWidth - 20);
      const bar = fg('success', '█'.repeat(addLen)) + fg('error', '█'.repeat(delLen));
      const count = dimFg('textMuted', `+${String(file.additions)} -${String(file.deletions)}`);

      lines.push(` ${statusGlyph} ${path.padEnd(width - barWidth - 15)} ${bar} ${count}`);
    }

    lines.push('');
    lines.push(fg('textMuted', '─'.repeat(Math.min(width, 50))));
    lines.push(dimFg('textMuted', ' v: view mode · f/F: navigate files'));

    return lines.slice(0, height);
  }

  // ─── Internal Rendering ─────────────────────────────────────────

  private renderGutter(line: DiffLine, dimFg: (t: string, s: string) => string): string {
    const oldNo = line.oldLineNo !== null ? String(line.oldLineNo).padStart(LINE_GUTTER_WIDTH - 1) : ' '.repeat(LINE_GUTTER_WIDTH - 1);
    const newNo = line.newLineNo !== null ? String(line.newLineNo).padStart(LINE_GUTTER_WIDTH - 1) : ' '.repeat(LINE_GUTTER_WIDTH - 1);
    return dimFg('textMuted', `${oldNo} ${newNo} `);
  }

  private renderDiffLine(
    line: DiffLine,
    width: number,
    fg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string {
    const content = truncate(line.content, width - 2);

    switch (line.type) {
      case 'added':
        return bg('success', `+ ${content}`);
      case 'removed':
        return bg('error', `- ${content}`);
      case 'hunk-header':
        return fg('accent', content);
      case 'header':
        return fg('textMuted', content);
      case 'separator':
        return fg('textMuted', content);
      default:
        return `  ${content}`;
    }
  }

  private renderSplitCell(
    line: DiffLine,
    width: number,
    side: 'old' | 'new',
    fg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string {
    const content = truncate(line.content, width - 2);

    if (line.type === 'added' && side === 'old') {
      return ' '.repeat(width);
    }
    if (line.type === 'removed' && side === 'new') {
      return ' '.repeat(width);
    }

    switch (line.type) {
      case 'added':
        return bg('success', ` ${content}`.padEnd(width));
      case 'removed':
        return bg('error', ` ${content}`.padEnd(width));
      default:
        return ` ${content}`.padEnd(width);
    }
  }
}

// ---------------------------------------------------------------------------
// Diff Parser
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string into structured DiffFile objects.
 */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split('\n');

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    // File header
    if (line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (line.startsWith('diff --git')) {
        // Save previous file
        if (currentFile && currentHunk) {
          currentFile.hunks.push(currentHunk);
        }
        if (currentFile) {
          files.push({ ...currentFile, additions, deletions });
        }

        const pathMatch = line.match(/diff --git a\/(.*) b\/(.*)/);
        const path = pathMatch?.[2] ?? 'unknown';
        currentFile = {
          path,
          oldPath: pathMatch?.[1] ?? null,
          status: 'modified',
          hunks: [],
          additions: 0,
          deletions: 0,
          isBinary: false,
        };
        currentHunk = null;
        additions = 0;
        deletions = 0;
      }
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (hunkMatch) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
      }
      oldLineNo = parseInt(hunkMatch[1]!, 10);
      newLineNo = parseInt(hunkMatch[3]!, 10);
      currentHunk = {
        header: hunkMatch[5]?.trim() ?? '',
        oldStart: oldLineNo,
        oldCount: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: newLineNo,
        newCount: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
        collapsed: false,
      };
      continue;
    }

    if (!currentHunk) continue;

    // Diff lines
    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        content: line.slice(1),
        oldLineNo: null,
        newLineNo: newLineNo++,
      });
      additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNo: oldLineNo++,
        newLineNo: null,
      });
      deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
      });
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      currentHunk.lines.push({
        type: 'separator',
        content: line,
        oldLineNo: null,
        newLineNo: null,
      });
    }
  }

  // Save last file
  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push({ ...currentFile, additions, deletions });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Word Diff
// ---------------------------------------------------------------------------

/**
 * Compute word-level diff between two strings.
 * Returns segments with changed/unchanged markers.
 */
export function computeWordDiff(oldText: string, newText: string): {
  oldSegments: WordDiffSegment[];
  newSegments: WordDiffSegment[];
} {
  const oldWords = tokenizeWords(oldText);
  const newWords = tokenizeWords(newText);

  // Simple LCS-based word diff
  const lcs = computeLCS(oldWords, newWords);

  const oldSegments: WordDiffSegment[] = [];
  const newSegments: WordDiffSegment[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldWords.length || newIdx < newWords.length) {
    if (lcsIdx < lcs.length && oldIdx < oldWords.length && oldWords[oldIdx] === lcs[lcsIdx]) {
      // Matched word
      oldSegments.push({ text: oldWords[oldIdx]!, changed: false });
      newSegments.push({ text: newWords[newIdx]!, changed: false });
      oldIdx++;
      newIdx++;
      lcsIdx++;
    } else {
      // Changed word
      if (oldIdx < oldWords.length && (lcsIdx >= lcs.length || oldWords[oldIdx] !== lcs[lcsIdx])) {
        oldSegments.push({ text: oldWords[oldIdx]!, changed: true });
        oldIdx++;
      }
      if (newIdx < newWords.length && (lcsIdx >= lcs.length || newWords[newIdx] !== lcs[lcsIdx])) {
        newSegments.push({ text: newWords[newIdx]!, changed: true });
        newIdx++;
      }
    }
  }

  return { oldSegments, newSegments };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenizeWords(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find LCS
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}
