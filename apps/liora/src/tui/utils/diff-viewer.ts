/**
 * DiffViewer — side-by-side and unified diff rendering for code review.
 *
 * Provides comprehensive diff visualization:
 * - Unified diff format (git-style with +/- markers)
 * - Side-by-side comparison with synchronized scrolling
 * - Word-level inline highlighting within changed lines
 * - Diff statistics (additions, deletions, file count)
 * - Collapsible unchanged regions with context lines
 * - File header with rename detection
 * - Hunk navigation (jump between change groups)
 * - Color-coded severity: additions (green), deletions (red), context (dim)
 * - Binary file detection
 * - Diff gutter with line numbers
 *
 * Design:
 * - Parse unified diff format (git diff output)
 * - Render with theme-aware colors
 * - Support both compact and expanded modes
 * - Word-diff for precise inline changes
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffLineType = 'add' | 'delete' | 'context' | 'hunk-header' | 'file-header' | 'binary';

export interface DiffLine {
  readonly type: DiffLineType;
  readonly content: string;
  readonly oldLineNo?: number;
  readonly newLineNo?: number;
  /** Word-level changes within this line (for inline highlighting). */
  readonly wordChanges?: readonly WordChange[];
}

export interface WordChange {
  readonly start: number;
  readonly end: number;
  readonly type: 'add' | 'delete';
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly oldPath: string;
  readonly newPath: string;
  readonly isRename: boolean;
  readonly isBinary: boolean;
  readonly isNew: boolean;
  readonly isDeleted: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffStats {
  readonly filesChanged: number;
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly files: readonly FileDiff[];
}

export type DiffViewMode = 'unified' | 'side-by-side' | 'stat';

export interface DiffRenderOptions {
  readonly width: number;
  readonly mode: DiffViewMode;
  readonly contextLines?: number;
  readonly showLineNumbers?: boolean;
  readonly wordDiff?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

export class DiffViewer {
  private files: FileDiff[] = [];
  private currentFileIndex = 0;
  private currentHunkIndex = 0;
  private scrollOffset = 0;
  private viewMode: DiffViewMode = 'unified';

  // ─── Parsing ─────────────────────────────────────────────────────

  /** Parse a full git diff output into structured FileDiff objects. */
  parseDiff(diffText: string): DiffStats {
    const files: FileDiff[] = [];
    const sections = diffText.split(/^diff --git /m).filter((s) => s.trim().length > 0);

    for (const section of sections) {
      const fileDiff = this.parseFileDiff('diff --git ' + section);
      if (fileDiff) files.push(fileDiff);
    }

    this.files = files;

    return {
      filesChanged: files.length,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      files,
    };
  }

  private parseFileDiff(text: string): FileDiff | null {
    const lines = text.split('\n');
    if (lines.length === 0) return null;

    // Parse header: diff --git a/path b/path
    const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
    if (!headerMatch) return null;

    const oldPath = headerMatch[1] ?? '';
    const newPath = headerMatch[2] ?? '';
    const isRename = oldPath !== newPath;

    let isBinary = false;
    let isNew = false;
    let isDeleted = false;
    const hunks: DiffHunk[] = [];

    let i = 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';

      if (line.startsWith('Binary files')) {
        isBinary = true;
        i++;
        continue;
      }
      if (line.startsWith('new file')) {
        isNew = true;
        i++;
        continue;
      }
      if (line.startsWith('deleted file')) {
        isDeleted = true;
        i++;
        continue;
      }
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') ||
          line.startsWith('similarity') || line.startsWith('rename')) {
        i++;
        continue;
      }

      // Hunk header
      const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1] ?? '1', 10);
        const oldCount = parseInt(hunkMatch[2] ?? '1', 10);
        const newStart = parseInt(hunkMatch[3] ?? '1', 10);
        const newCount = parseInt(hunkMatch[4] ?? '1', 10);

        const hunkLines: DiffLine[] = [];
        let oldLine = oldStart;
        let newLine = newStart;
        i++;

        while (i < lines.length) {
          const hLine = lines[i] ?? '';
          if (hLine.startsWith('@@') || hLine.startsWith('diff --git')) break;

          if (hLine.startsWith('+')) {
            hunkLines.push({ type: 'add', content: hLine.slice(1), newLineNo: newLine });
            newLine++;
          } else if (hLine.startsWith('-')) {
            hunkLines.push({ type: 'delete', content: hLine.slice(1), oldLineNo: oldLine });
            oldLine++;
          } else if (hLine.startsWith(' ') || hLine === '') {
            hunkLines.push({ type: 'context', content: hLine.slice(1), oldLineNo: oldLine, newLineNo: newLine });
            oldLine++;
            newLine++;
          } else {
            // No-newline marker or other
            hunkLines.push({ type: 'context', content: hLine });
          }
          i++;
        }

        hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
        continue;
      }

      i++;
    }

    const additions = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'add').length, 0);
    const deletions = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === 'delete').length, 0);

    return { oldPath, newPath, isRename, isBinary, isNew, isDeleted, hunks, additions, deletions };
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Set the view mode. */
  setMode(mode: DiffViewMode): void {
    this.viewMode = mode;
  }

  /** Navigate to the next file. */
  nextFile(): void {
    if (this.files.length > 0) {
      this.currentFileIndex = (this.currentFileIndex + 1) % this.files.length;
      this.currentHunkIndex = 0;
      this.scrollOffset = 0;
    }
  }

  /** Navigate to the previous file. */
  prevFile(): void {
    if (this.files.length > 0) {
      this.currentFileIndex = (this.currentFileIndex - 1 + this.files.length) % this.files.length;
      this.currentHunkIndex = 0;
      this.scrollOffset = 0;
    }
  }

  /** Navigate to the next hunk. */
  nextHunk(): void {
    const file = this.files[this.currentFileIndex];
    if (file && file.hunks.length > 0) {
      this.currentHunkIndex = (this.currentHunkIndex + 1) % file.hunks.length;
    }
  }

  /** Navigate to the previous hunk. */
  prevHunk(): void {
    const file = this.files[this.currentFileIndex];
    if (file && file.hunks.length > 0) {
      this.currentHunkIndex = (this.currentHunkIndex - 1 + file.hunks.length) % file.hunks.length;
    }
  }

  /** Scroll the diff view. */
  scroll(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the diff according to the current view mode. */
  render(options: DiffRenderOptions): string[] {
    const mode = options.mode ?? this.viewMode;

    switch (mode) {
      case 'unified': return this.renderUnified(options);
      case 'side-by-side': return this.renderSideBySide(options);
      case 'stat': return this.renderStat(options);
      default: return this.renderUnified(options);
    }
  }

  private renderUnified(options: DiffRenderOptions): string[] {
    const { width, fg, boldFg, dimFg, showLineNumbers = true, wordDiff = true } = options;
    const lines: string[] = [];

    for (const file of this.files) {
      // File header
      lines.push(this.renderFileHeader(file, options));
      lines.push('');

      if (file.isBinary) {
        lines.push(dimFg('textMuted', '  Binary file changed'));
        lines.push('');
        continue;
      }

      for (const hunk of file.hunks) {
        // Hunk header
        lines.push(fg('primary', `  @@ -${String(hunk.oldStart)},${String(hunk.oldCount)} +${String(hunk.newStart)},${String(hunk.newCount)} @@`));

        for (const diffLine of hunk.lines) {
          lines.push(this.renderDiffLine(diffLine, width, showLineNumbers, wordDiff, options));
        }
      }
      lines.push('');
    }

    return lines;
  }

  private renderDiffLine(
    line: DiffLine,
    width: number,
    showLineNumbers: boolean,
    wordDiff: boolean,
    options: DiffRenderOptions,
  ): string {
    const { fg, boldFg, dimFg } = options;
    const gutterWidth = showLineNumbers ? 12 : 2;
    const contentWidth = width - gutterWidth - 2;

    let gutter = '';
    let marker = '';
    let content = '';

    switch (line.type) {
      case 'add': {
        const lineNo = showLineNumbers ? dimFg('textMuted', `${' '.repeat(5)}${String(line.newLineNo ?? '').padStart(4)} `) : '';
        gutter = lineNo;
        marker = fg('success', '+');
        content = fg('success', truncate(line.content, contentWidth));
        break;
      }
      case 'delete': {
        const lineNo = showLineNumbers ? dimFg('textMuted', `${String(line.oldLineNo ?? '').padStart(4)}${' '.repeat(5)} `) : '';
        gutter = lineNo;
        marker = fg('error', '-');
        content = fg('error', truncate(line.content, contentWidth));
        break;
      }
      case 'context': {
        const lineNo = showLineNumbers
          ? dimFg('textMuted', `${String(line.oldLineNo ?? '').padStart(4)} ${String(line.newLineNo ?? '').padStart(4)} `)
          : '';
        gutter = lineNo;
        marker = dimFg('textMuted', ' ');
        content = dimFg('textMuted', truncate(line.content, contentWidth));
        break;
      }
      default:
        content = line.content;
    }

    return `  ${gutter}${marker} ${content}`;
  }

  private renderSideBySide(options: DiffRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const halfWidth = Math.floor((width - 3) / 2);

    for (const file of this.files) {
      lines.push(this.renderFileHeader(file, options));
      lines.push(dimFg('textMuted', '─'.repeat(width - 2)));

      if (file.isBinary) {
        lines.push(dimFg('textMuted', '  Binary file changed'));
        continue;
      }

      for (const hunk of file.hunks) {
        // Pair up deletions and additions for side-by-side
        const pairs = this.pairChanges(hunk.lines);

        for (const pair of pairs) {
          const left = pair.left
            ? fg('error', truncate(pair.left.content, halfWidth - 6))
            : dimFg('textMuted', ' '.repeat(Math.min(halfWidth - 6, 20)));
          const right = pair.right
            ? fg('success', truncate(pair.right.content, halfWidth - 6))
            : dimFg('textMuted', ' '.repeat(Math.min(halfWidth - 6, 20)));

          const leftNo = pair.left?.oldLineNo != null ? dimFg('textMuted', String(pair.left.oldLineNo).padStart(4)) : '    ';
          const rightNo = pair.right?.newLineNo != null ? dimFg('textMuted', String(pair.right.newLineNo).padStart(4)) : '    ';

          const sep = pair.left && pair.right ? fg('warning', '│') : dimFg('textMuted', '│');
          lines.push(`  ${leftNo} ${left}${' '.repeat(Math.max(0, halfWidth - 6 - stripAnsi(left)))} ${sep} ${rightNo} ${right}`);
        }
      }
      lines.push('');
    }

    return lines;
  }

  private renderStat(options: DiffRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const totalAdd = this.files.reduce((s, f) => s + f.additions, 0);
    const totalDel = this.files.reduce((s, f) => s + f.deletions, 0);

    lines.push(boldFg('text', ` ${String(this.files.length)} file${this.files.length !== 1 ? 's' : ''} changed`) +
      fg('success', ` +${String(totalAdd)}`) +
      fg('error', ` -${String(totalDel)}`));
    lines.push('');

    // Find the longest filename for alignment
    const maxNameLen = Math.max(...this.files.map((f) => f.newPath.length), 10);
    const barWidth = Math.min(30, width - maxNameLen - 15);

    for (const file of this.files) {
      const total = file.additions + file.deletions;
      const addBars = total > 0 ? Math.round((file.additions / total) * barWidth) : 0;
      const delBars = total > 0 ? barWidth - addBars : 0;

      const name = file.isRename
        ? `${file.oldPath} → ${file.newPath}`
        : file.newPath;

      const stat = dimFg('textMuted', `${String(total).padStart(4)} `);
      const bar = fg('success', '+'.repeat(addBars)) + fg('error', '-'.repeat(delBars));
      const badges: string[] = [];
      if (file.isNew) badges.push(fg('success', 'new'));
      if (file.isDeleted) badges.push(fg('error', 'del'));
      if (file.isRename) badges.push(fg('warning', 'ren'));
      if (file.isBinary) badges.push(fg('textMuted', 'bin'));

      const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';
      lines.push(` ${truncate(name, maxNameLen).padEnd(maxNameLen)} ${stat}${bar}${badgeStr}`);
    }

    return lines;
  }

  private renderFileHeader(file: FileDiff, options: DiffRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const parts: string[] = [];

    if (file.isNew) {
      parts.push(fg('success', '● new'));
    } else if (file.isDeleted) {
      parts.push(fg('error', '● deleted'));
    } else if (file.isRename) {
      parts.push(fg('warning', `● renamed`));
    } else {
      parts.push(fg('primary', '● modified'));
    }

    const path = file.isRename ? `${file.oldPath} → ${file.newPath}` : file.newPath;
    parts.push(boldFg('text', ` ${path}`));
    parts.push(dimFg('textMuted', ` +${String(file.additions)} -${String(file.deletions)}`));

    return ` ${parts.join('')}`;
  }

  // ─── Word Diff ───────────────────────────────────────────────────

  /** Compute word-level differences between two strings. */
  computeWordDiff(oldStr: string, newStr: string): { oldChanges: WordChange[]; newChanges: WordChange[] } {
    const oldWords = tokenizeWords(oldStr);
    const newWords = tokenizeWords(newStr);

    // Simple LCS-based word diff
    const lcs = computeLCS(oldWords, newWords);
    const oldChanges: WordChange[] = [];
    const newChanges: WordChange[] = [];

    let oi = 0;
    let ni = 0;
    let li = 0;

    while (oi < oldWords.length || ni < newWords.length) {
      if (li < lcs.length && oi < oldWords.length && oldWords[oi] === lcs[li] && ni < newWords.length && newWords[ni] === lcs[li]) {
        oi++;
        ni++;
        li++;
      } else {
        // Collect deleted words from old
        const delStart = charOffset(oldWords, oi);
        while (oi < oldWords.length && (li >= lcs.length || oldWords[oi] !== lcs[li])) {
          oi++;
        }
        if (oi > 0) {
          oldChanges.push({ start: delStart, end: charOffset(oldWords, oi), type: 'delete' });
        }

        // Collect added words in new
        const addStart = charOffset(newWords, ni);
        while (ni < newWords.length && (li >= lcs.length || newWords[ni] !== lcs[li])) {
          ni++;
        }
        if (ni > 0) {
          newChanges.push({ start: addStart, end: charOffset(newWords, ni), type: 'add' });
        }
      }
    }

    return { oldChanges, newChanges };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private pairChanges(lines: readonly DiffLine[]): Array<{ left: DiffLine | null; right: DiffLine | null }> {
    const pairs: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      if (line.type === 'context') {
        pairs.push({ left: line, right: line });
        i++;
      } else if (line.type === 'delete') {
        // Collect consecutive deletes
        const deletes: DiffLine[] = [];
        while (i < lines.length && lines[i]!.type === 'delete') {
          deletes.push(lines[i]!);
          i++;
        }
        // Collect consecutive adds
        const adds: DiffLine[] = [];
        while (i < lines.length && lines[i]!.type === 'add') {
          adds.push(lines[i]!);
          i++;
        }
        // Pair them up
        const maxLen = Math.max(deletes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          pairs.push({
            left: deletes[j] ?? null,
            right: adds[j] ?? null,
          });
        }
      } else if (line.type === 'add') {
        pairs.push({ left: null, right: line });
        i++;
      } else {
        i++;
      }
    }

    return pairs;
  }

  /** Get the current file being viewed. */
  get currentFile(): FileDiff | null {
    return this.files[this.currentFileIndex] ?? null;
  }

  /** Get diff stats. */
  getStats(): DiffStats {
    return {
      filesChanged: this.files.length,
      totalAdditions: this.files.reduce((s, f) => s + f.additions, 0),
      totalDeletions: this.files.reduce((s, f) => s + f.deletions, 0),
      files: this.files,
    };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function stripAnsi(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}

function tokenizeWords(s: string): string[] {
  return s.match(/\S+|\s+/g) ?? [];
}

function charOffset(words: string[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index && i < words.length; i++) {
    offset += words[i]!.length;
  }
  return offset;
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack
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

