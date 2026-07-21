import { execSync } from 'node:child_process';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffFile {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: DiffHunk[];
}

interface DiffHunk {
  readonly header: string;
  readonly lines: DiffLine[];
}

interface DiffLine {
  readonly type: 'add' | 'del' | 'context' | 'header';
  readonly content: string;
}

// ---------------------------------------------------------------------------
// GitDiffPanel
// ---------------------------------------------------------------------------

export class GitDiffPanel implements PanelDefinition {
  readonly id = 'git-diff';
  readonly title = 'Git Diff';
  readonly icon = 'Δ';
  readonly minWidth = 30;
  readonly minHeight = 8;

  private readonly cwd: string;
  private files: DiffFile[] = [];
  private flatLines: Array<{ text: string; type: string }> = [];
  private cursorIndex = 0;
  private scrollTop = 0;
  private lastRefresh = 0;
  private mode: 'summary' | 'full' = 'summary';

  constructor(cwd: string) {
    this.cwd = cwd;
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    // Auto-refresh every 5 seconds
    const now = Date.now();
    if (now - this.lastRefresh > 5000) {
      this.refresh();
    }

    if (this.files.length === 0) {
      return [dim('  No changes detected'), dim('  (working tree clean)')];
    }

    const lines = this.mode === 'summary'
      ? this.renderSummary(width)
      : this.flatLines.map((l) => l.text);

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, lines.length - 1));
    if (this.cursorIndex < this.scrollTop) this.scrollTop = this.cursorIndex;
    if (this.cursorIndex >= this.scrollTop + height) this.scrollTop = this.cursorIndex - height + 1;

    const visible = lines.slice(this.scrollTop, this.scrollTop + height);
    return visible.map((line, i) => {
      const globalIdx = this.scrollTop + i;
      const isCursor = focused && globalIdx === this.cursorIndex;
      let truncated = (line ?? '').slice(0, width);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        truncated = this.highlightSearch(truncated, searchQuery);
      }
      return isCursor ? inverse(truncated.padEnd(width)) : truncated;
    });
  }

  /** Highlight search query matches in a line. */
  private highlightSearch(line: string, query: string): string {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerLine.indexOf(lowerQuery);
    if (idx === -1) return line;

    // Wrap match in highlight ANSI codes (reverse video)
    const before = line.slice(0, idx);
    const match = line.slice(idx, idx + query.length);
    const after = line.slice(idx + query.length);
    return `${before}\u001B[7m${match}\u001B[0m${after}`;
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    switch (event.key) {
      case 'up':
        this.cursorIndex = Math.max(0, this.cursorIndex - 1);
        return true;
      case 'down':
        this.cursorIndex = Math.min(this.flatLines.length - 1, this.cursorIndex + 1);
        return true;
      case 'character':
        if (event.text === 'r' || event.text === 'R') {
          this.refresh();
          return true;
        }
        if (event.text === 'v' || event.text === 'V') {
          this.mode = this.mode === 'summary' ? 'full' : 'summary';
          this.cursorIndex = 0;
          this.scrollTop = 0;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  dispose(): void {
    this.files = [];
    this.flatLines = [];
  }

  // -------------------------------------------------------------------------
  // Git operations
  // -------------------------------------------------------------------------

  refresh(): void {
    this.lastRefresh = Date.now();
    try {
      const diffOutput = execSync('git diff HEAD', {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      this.files = parseDiff(diffOutput);
      this.flatLines = this.buildFlatLines();
    } catch {
      this.files = [];
      this.flatLines = [];
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderSummary(width: number): string[] {
    const lines: string[] = [];
    const totalAdd = this.files.reduce((s, f) => s + f.additions, 0);
    const totalDel = this.files.reduce((s, f) => s + f.deletions, 0);

    lines.push(bold(` ${this.files.length} file(s) changed`));
    lines.push(` ${green(`+${totalAdd}`)} ${red(`-${totalDel}`)}`);
    lines.push('');

    for (const file of this.files) {
      const statusIcon = file.status === 'added' ? green('+') : file.status === 'deleted' ? red('-') : yellow('~');
      const stats = `${green(`+${file.additions}`)} ${red(`-${file.deletions}`)}`;
      const path = file.path.length > width - 12 ? `...${file.path.slice(-(width - 15))}` : file.path;
      lines.push(` ${statusIcon} ${path} ${stats}`);
    }

    lines.push('');
    lines.push(dim(' [v] toggle full diff  [r] refresh'));
    return lines;
  }

  private buildFlatLines(): Array<{ text: string; type: string }> {
    const lines: Array<{ text: string; type: string }> = [];

    for (const file of this.files) {
      lines.push({ text: bold(`── ${file.path} ──`), type: 'header' });
      for (const hunk of file.hunks) {
        lines.push({ text: cyan(hunk.header), type: 'header' });
        for (const line of hunk.lines) {
          switch (line.type) {
            case 'add':
              lines.push({ text: green(`+${line.content}`), type: 'add' });
              break;
            case 'del':
              lines.push({ text: red(`-${line.content}`), type: 'del' });
              break;
            default:
              lines.push({ text: ` ${line.content}`, type: 'context' });
          }
        }
      }
      lines.push({ text: '', type: 'context' });
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Diff parser
// ---------------------------------------------------------------------------

function parseDiff(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileChunks = output.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2] ?? headerMatch[1] ?? 'unknown';
    let status: DiffFile['status'] = 'modified';
    if (chunk.includes('new file mode')) status = 'added';
    else if (chunk.includes('deleted file mode')) status = 'deleted';
    else if (chunk.includes('rename from')) status = 'renamed';

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = { header: line, lines: [] };
      } else if (currentHunk) {
        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1) });
          additions++;
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'del', content: line.slice(1) });
          deletions++;
        } else {
          currentHunk.lines.push({ type: 'context', content: line.slice(1) });
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    files.push({ path: filePath, status, additions, deletions, hunks });
  }

  return files;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function dim(text: string): string { return `\x1b[2m${text}\x1b[0m`; }
function bold(text: string): string { return `\x1b[1m${text}\x1b[0m`; }
function green(text: string): string { return `\x1b[32m${text}\x1b[0m`; }
function red(text: string): string { return `\x1b[31m${text}\x1b[0m`; }
function yellow(text: string): string { return `\x1b[33m${text}\x1b[0m`; }
function cyan(text: string): string { return `\x1b[36m${text}\x1b[0m`; }
function inverse(text: string): string { return `\x1b[7m${text}\x1b[0m`; }
