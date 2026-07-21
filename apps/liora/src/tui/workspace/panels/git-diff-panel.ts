import { execSync } from 'node:child_process';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffFile {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: DiffHunk[];
  readonly isBinary?: boolean;
  readonly modeChange?: string;
  readonly whitespaceOnly?: boolean;
  readonly hasImportChanges?: boolean;
  readonly todoCount?: number;
  readonly isTestFile?: boolean;
  readonly isConfigFile?: boolean;
  readonly isDocFile?: boolean;
  readonly isLargeChange?: boolean;
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
  private mode: 'summary' | 'full' | 'stat' = 'summary';
  /** Render cache: avoids re-computing lines when nothing changed. */
  private renderCache: { key: string; lines: string[] } | null = null;
  private diffVersion = 0;
  /** Whether to show context (unchanged) lines in full diff mode. */
  private showContext = true;
  /** Whether to show blame hints (last author) for changed files. */
  private blameMode = false;
  private blameCache: Map<string, string> = new Map();

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
      return [
        `  ${currentTheme.fg('success', '✓')} ${currentTheme.dimFg('textMuted', 'No changes detected')}`,
        `  ${currentTheme.dimFg('textMuted', '(working tree clean)')}`,
      ];
    }

    // Fast-path: return cached lines when content hasn't changed
    const cacheKey = `${width}:${height}:${focused}:${searchQuery ?? ''}:${this.cursorIndex}:${this.scrollTop}:${this.mode}:${this.diffVersion}`;
    if (this.renderCache !== null && this.renderCache.key === cacheKey) {
      return this.renderCache.lines;
    }

    const lines = this.mode === 'summary'
      ? this.renderSummary(width)
      : this.mode === 'stat'
        ? this.renderStatMode(width)
        : this.flatLines.map((l) => l.text);

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, lines.length - 1));
    if (this.cursorIndex < this.scrollTop) this.scrollTop = this.cursorIndex;
    if (this.cursorIndex >= this.scrollTop + height) this.scrollTop = this.cursorIndex - height + 1;

    const visible = lines.slice(this.scrollTop, this.scrollTop + height);
    const result = visible.map((line, i) => {
      const globalIdx = this.scrollTop + i;
      const isCursor = focused && globalIdx === this.cursorIndex;
      let truncated = (line ?? '').slice(0, width);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        truncated = this.highlightSearch(truncated, searchQuery);
      }
      // Hunk context preview: when cursor is on a hunk header (@@ line),
      // extract and show the function/class context after @@
      if (isCursor && this.flatLines[globalIdx]?.type === 'header' && truncated.includes('@@')) {
        const ctxMatch = truncated.match(/@@.*@@\s*(.*)/);
        if (ctxMatch && ctxMatch[1] && ctxMatch[1].trim().length > 0) {
          const ctxLabel = currentTheme.dimFg('textMuted', ` ⌁ ${ctxMatch[1].trim().slice(0, width - 6)}`);
          truncated = truncated.slice(0, width - ctxLabel.replace(/\x1b\[[0-9;]*m/g, '').length) + ctxLabel;
        }
      }
      return isCursor ? inverse(truncated.padEnd(width)) : truncated;
    });
    this.renderCache = { key: cacheKey, lines: result };
    return result;
  }

  /** Highlight search query matches in a line. */
  private highlightSearch(line: string, query: string): string {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerLine.indexOf(lowerQuery);
    if (idx === -1) return line;

    const before = line.slice(0, idx);
    const match = line.slice(idx, idx + query.length);
    const after = line.slice(idx + query.length);
    return `${before}${currentTheme.bg('selectionBg', currentTheme.fg('selectionText', match))}${after}`;
  }

  onInput(event: NativeInputEvent): boolean {
    // Mouse wheel support
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        this.cursorIndex = Math.max(0, this.cursorIndex - 3);
        return true;
      }
      if (event.button === 'wheel-down') {
        this.cursorIndex = Math.min(this.flatLines.length - 1, this.cursorIndex + 3);
        return true;
      }
      return false;
    }

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
          // Cycle: summary → stat → full → summary
          this.mode = this.mode === 'summary' ? 'stat' : this.mode === 'stat' ? 'full' : 'summary';
          this.cursorIndex = 0;
          this.scrollTop = 0;
          this.renderCache = null;
          return true;
        }
        // Hunk/file jump navigation
        if (event.text === 'n' || event.text === 'N') {
          this.jumpToNextHunk();
          return true;
        }
        if (event.text === 'p' || event.text === 'P') {
          this.jumpToPrevHunk();
          return true;
        }
        // Toggle context lines (show/hide unchanged lines in full mode)
        if (event.text === 'c' || event.text === 'C') {
          this.showContext = !this.showContext;
          this.flatLines = this.buildFlatLines();
          this.diffVersion++;
          this.renderCache = null;
          return true;
        }
        // Toggle blame hints (last author for changed files)
        if (event.text === 'b' || event.text === 'B') {
          this.blameMode = !this.blameMode;
          if (this.blameMode) this.computeBlameHints();
          this.diffVersion++;
          this.renderCache = null;
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

  /** Compute blame hints for changed files (last author + relative date). */
  private computeBlameHints(): void {
    this.blameCache.clear();
    for (const file of this.files) {
      try {
        const blameOutput = execSync(`git log -1 --format="%an %ar" -- "${file.path}"`, {
          cwd: this.cwd,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (blameOutput.length > 0) {
          this.blameCache.set(file.path, blameOutput);
        }
      } catch {
        // File may be new or not tracked
      }
    }
  }

  /** Jump to the next hunk header or file header in the flat lines. */
  private jumpToNextHunk(): void {
    for (let i = this.cursorIndex + 1; i < this.flatLines.length; i++) {
      if (this.flatLines[i]!.type === 'header') {
        this.cursorIndex = i;
        this.renderCache = null;
        return;
      }
    }
    // Wrap around
    for (let i = 0; i <= this.cursorIndex; i++) {
      if (this.flatLines[i]!.type === 'header') {
        this.cursorIndex = i;
        this.renderCache = null;
        return;
      }
    }
  }

  /** Jump to the previous hunk header or file header in the flat lines. */
  private jumpToPrevHunk(): void {
    for (let i = this.cursorIndex - 1; i >= 0; i--) {
      if (this.flatLines[i]!.type === 'header') {
        this.cursorIndex = i;
        this.renderCache = null;
        return;
      }
    }
    // Wrap around
    for (let i = this.flatLines.length - 1; i >= this.cursorIndex; i--) {
      if (this.flatLines[i]!.type === 'header') {
        this.cursorIndex = i;
        this.renderCache = null;
        return;
      }
    }
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
      this.diffVersion++;
      this.renderCache = null;
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
    const totalLines = this.flatLines.length;

    lines.push(bold(` ${this.files.length} file(s) changed`) + dim(` · ${String(totalLines)} lines`));
    // Show last commit message for context
    try {
      const lastCommit = execSync('git log -1 --format="%s" 2>/dev/null', {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: 2000,
      }).trim();
      if (lastCommit.length > 0) {
        const truncatedMsg = lastCommit.length > width - 6 ? lastCommit.slice(0, width - 9) + '…' : lastCommit;
        lines.push(dim(` HEAD: ${truncatedMsg}`));
      }
    } catch {
      // Not a git repo
    }
    // Patch size indicator
    const patchBytes = this.files.reduce((s, f) => s + f.additions * 40 + f.deletions * 40, 0);
    const patchSize = patchBytes > 1024 * 1024 ? `${(patchBytes / (1024 * 1024)).toFixed(1)}MB` : patchBytes > 1024 ? `${(patchBytes / 1024).toFixed(0)}KB` : `${String(patchBytes)}B`;
    lines.push(dim(` ~${patchSize} patch`) + dim(` · ${String(this.files.filter((f) => f.status === 'added').length)} new · ${String(this.files.filter((f) => f.status === 'deleted').length)} del`));
    // File type breakdown
    const extCounts = new Map<string, number>();
    for (const f of this.files) {
      const ext = f.path.includes('.') ? f.path.slice(f.path.lastIndexOf('.')) : '(none)';
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
    if (extCounts.size > 1) {
      const topExts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const extSummary = topExts.map(([ext, count]) => dim(`${ext}×${String(count)}`)).join(' ');
      lines.push(` ${extSummary}`);
    }
    // Visual diff stats bar: green/red proportional blocks
    const total = totalAdd + totalDel;
    const BAR_WIDTH = Math.min(30, Math.max(10, width - 20));
    if (total > 0) {
      const addBlocks = Math.round((totalAdd / total) * BAR_WIDTH);
      const delBlocks = BAR_WIDTH - addBlocks;
      const bar = green('█'.repeat(addBlocks)) + red('█'.repeat(delBlocks));
      lines.push(` ${bar} ${green(`+${totalAdd}`)} ${red(`-${totalDel}`)}`);
    } else {
      lines.push(` ${green(`+${totalAdd}`)} ${red(`-${totalDel}`)}`);
    }
    lines.push('');

    for (const file of this.files) {
      // File type icon based on extension
      const ext = file.path.includes('.') ? file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase() : '';
      const FILE_ICONS: Record<string, string> = {
        ts: '🟦', tsx: '⚛', js: '🟨', jsx: '⚛', json: '📋', md: '📝',
        css: '🎨', scss: '🎨', html: '🌐', svg: '🖼', png: '🖼', jpg: '🖼',
        yaml: '⚙', yml: '⚙', toml: '⚙', lock: '🔒', sh: '▶', py: '🐍',
        rs: '🦀', go: '🐹', rb: '💎', sql: '🗄', txt: '📄', env: '🔐',
      };
      const fileIcon = FILE_ICONS[ext] ?? '📄';
      const statusIcon = file.status === 'added' ? green('+')
        : file.status === 'deleted' ? red('-')
        : file.status === 'renamed' ? currentTheme.fg('accent', '→')
        : yellow('~');
      const stats = `${green(`+${file.additions}`)} ${red(`-${file.deletions}`)}`;
      // Per-file mini bar
      const fileTotal = file.additions + file.deletions;
      const FILE_BAR_WIDTH = 8;
      let fileBar = '';
      if (fileTotal > 0) {
        const fileAddBlocks = Math.round((file.additions / fileTotal) * FILE_BAR_WIDTH);
        const fileDelBlocks = FILE_BAR_WIDTH - fileAddBlocks;
        fileBar = ` ${green('▓'.repeat(fileAddBlocks))}${red('▓'.repeat(fileDelBlocks))}`;
      }
      const path = file.path.length > width - 12 ? `...${file.path.slice(-(width - 15))}` : file.path;
      const binaryBadge = file.isBinary ? ` ${currentTheme.fg('warning', '[bin]')}` : '';
      const modeBadge = file.modeChange ? ` ${currentTheme.fg('accent', `[${file.modeChange}]`)}` : '';
      const wsBadge = file.whitespaceOnly ? ` ${currentTheme.dimFg('textMuted', '[ws]')}` : '';
      const importBadge = file.hasImportChanges ? ` ${currentTheme.fg('warning', '[imp]')}` : '';
      const todoBadge = file.todoCount ? ` ${currentTheme.fg('warning', `[TODO×${String(file.todoCount)}]`)}` : '';
      const testBadge = file.isTestFile ? ` ${currentTheme.fg('accent', '[test]')}` : '';
      const configBadge = file.isConfigFile ? ` ${currentTheme.fg('primary', '[cfg]')}` : '';
      const docBadge = file.isDocFile ? ` ${currentTheme.fg('accent', '[doc]')}` : '';
      const largeBadge = file.isLargeChange ? ` ${currentTheme.fg('error', '[LARGE]')}` : '';
      const hunkCount = file.hunks.length > 0 ? currentTheme.dimFg('textMuted', ` ${String(file.hunks.length)}h`) : '';
      // File age: show how recently the file was last modified on disk
      let fileAgeBadge = '';
      try {
        const stat = require('node:fs').statSync(require('node:path').join(this.cwd, file.path));
        const ageSec = Math.floor(Math.max(0, Date.now() - stat.mtimeMs) / 1000);
        if (ageSec < 60) fileAgeBadge = currentTheme.fg('success', ' now');
        else if (ageSec < 3600) fileAgeBadge = currentTheme.dimFg('textMuted', ` ${String(Math.floor(ageSec / 60))}m`);
        else if (ageSec < 86400) fileAgeBadge = currentTheme.dimFg('textMuted', ` ${String(Math.floor(ageSec / 3600))}h`);
      } catch {
        // File may not exist (deleted)
      }
      lines.push(` ${statusIcon} ${fileIcon} ${path}${binaryBadge}${modeBadge}${wsBadge}${importBadge}${todoBadge}${testBadge}${configBadge}${docBadge}${largeBadge}${fileBar} ${stats}${hunkCount}${fileAgeBadge}`);
    }

    lines.push('');
    // File dependency grouping: show how many files share the same directory
    const dirGroups = new Map<string, number>();
    for (const f of this.files) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
      dirGroups.set(dir, (dirGroups.get(dir) ?? 0) + 1);
    }
    const multiFileDirs = [...dirGroups.entries()].filter(([, count]) => count > 1);
    if (multiFileDirs.length > 0) {
      const groupSummary = multiFileDirs.slice(0, 3).map(([dir, count]) => {
        const shortDir = dir.split('/').pop() ?? dir;
        return dim(`${shortDir}/×${String(count)}`);
      }).join(' ');
      lines.push(` ${currentTheme.dimFg('textMuted', '📂')} ${groupSummary}`);
    }
    // Change density bar: proportional representation of changes per file
    const densityTotal = this.files.reduce((s, f) => s + f.additions + f.deletions, 0);
    if (densityTotal > 0 && this.files.length > 1) {
      const DENSITY_W = Math.min(30, width - 4);
      const densitySegments = this.files.map((f) => {
        const fileChanges = f.additions + f.deletions;
        const segLen = Math.max(1, Math.round((fileChanges / densityTotal) * DENSITY_W));
        const ratio = f.additions / Math.max(1, fileChanges);
        return ratio > 0.7 ? green('▓'.repeat(segLen))
          : ratio < 0.3 ? red('▓'.repeat(segLen))
          : yellow('▓'.repeat(segLen));
      });
      lines.push(` ${densitySegments.join('')}`);
    }
    lines.push(dim(` [v] ${this.mode === 'summary' ? 'stat' : this.mode === 'stat' ? 'full' : 'summary'}  [n/p] hunk  [b] blame  [r] refresh`));
    // Color legend
    lines.push(dim(` ${green('+')}added ${red('-')}deleted ${yellow('~')}modified ${currentTheme.fg('accent', '→')}renamed`));
    return lines;
  }

  /** Render stat-only mode: numstat per file without full diff content. */
  private renderStatMode(width: number): string[] {
    const lines: string[] = [];
    const totalAdd = this.files.reduce((s, f) => s + f.additions, 0);
    const totalDel = this.files.reduce((s, f) => s + f.deletions, 0);
    const totalChanged = totalAdd + totalDel;
    lines.push(bold(` ${this.files.length} file(s) · ${green(`+${totalAdd}`)} ${red(`-${totalDel}`)} · ${String(totalChanged)} changed`));
    lines.push('');
    for (const file of this.files) {
      const addStr = green(String(file.additions).padStart(4));
      const delStr = red(String(file.deletions).padStart(4));
      const filePath = file.path.length > width - 14 ? `…${file.path.slice(-(width - 15))}` : file.path;
      const hunkInfo = file.hunks.length > 0 ? dim(` ${String(file.hunks.length)}h`) : '';
      lines.push(` ${addStr} ${delStr}  ${filePath}${hunkInfo}`);
    }
    lines.push('');
    lines.push(dim(` [v] ${this.mode === 'stat' ? 'full' : 'summary'}  [r] refresh`));
    return lines;
  }

  private buildFlatLines(): Array<{ text: string; type: string }> {
    const lines: Array<{ text: string; type: string }> = [];
    let lineNum = 0; // Running line number for gutter

    for (const file of this.files) {
      const statusTag = file.status === 'added' ? green(' [new]')
        : file.status === 'deleted' ? red(' [del]')
        : file.status === 'renamed' ? currentTheme.fg('accent', ' [renamed]')
        : '';
      const blameHint = this.blameMode && this.blameCache.has(file.path)
        ? ` ${currentTheme.dimFg('textMuted', `(${this.blameCache.get(file.path)!})`)}`
        : '';
      lines.push({ text: bold(`── ${file.path} ──`) + statusTag + blameHint, type: 'header' });
      for (const hunk of file.hunks) {
        lines.push({ text: cyan(hunk.header), type: 'header' });
        // Render with inline word-level diff highlighting
        for (let i = 0; i < hunk.lines.length; i++) {
          const line = hunk.lines[i]!;
          switch (line.type) {
            case 'add': {
              // Check if previous line is a deletion (paired change)
              const prev = i > 0 ? hunk.lines[i - 1] : undefined;
              if (prev && prev.type === 'del') {
                // Detect indent-only changes (whitespace prefix differs, content same)
                const prevTrimmed = prev.content.trimStart();
                const curTrimmed = line.content.trimStart();
                const indentOnly = prevTrimmed === curTrimmed && prev.content !== line.content;
                // Inline word diff: highlight changed words
                const highlighted = this.inlineWordDiff(prev.content, line.content, 'add');
                const longWarn = line.content.length > 120 ? currentTheme.fg('warning', ' ⚠') : '';
                const trailWs = /\s+$/.test(line.content) && line.content.trim().length > 0 ? currentTheme.bg('error', ' ') : '';
                const indentTag = indentOnly ? currentTheme.dimFg('textMuted', ' [indent]') : '';
                lineNum++;
                const gutterAdd = currentTheme.dimFg('textMuted', String(lineNum).padStart(4) + ' ');
                lines.push({ text: gutterAdd + green('+') + highlighted + trailWs + longWarn + indentTag, type: 'add' });
              } else {
                const longWarn = line.content.length > 120 ? currentTheme.fg('warning', ' ⚠') : '';
                const trailWs = /\s+$/.test(line.content) && line.content.trim().length > 0 ? currentTheme.bg('error', ' ') : '';
                lineNum++;
                const gutterAdd2 = currentTheme.dimFg('textMuted', String(lineNum).padStart(4) + ' ');
                lines.push({ text: gutterAdd2 + green(`+${line.content}`) + trailWs + longWarn, type: 'add' });
              }
              break;
            }
            case 'del': {
              // Check if next line is an addition (paired change)
              const next = i + 1 < hunk.lines.length ? hunk.lines[i + 1] : undefined;
              if (next && next.type === 'add') {
                const highlighted = this.inlineWordDiff(line.content, next.content, 'del');
                const longWarn = line.content.length > 120 ? currentTheme.fg('warning', ' ⚠') : '';
                lines.push({ text: red('-') + highlighted + longWarn, type: 'del' });
              } else {
                const longWarn = line.content.length > 120 ? currentTheme.fg('warning', ' ⚠') : '';
                lines.push({ text: red(`-${line.content}`) + longWarn, type: 'del' });
              }
              break;
            }
            default:
              if (this.showContext) {
                lines.push({ text: currentTheme.dimFg('textMuted', ` ${line.content}`), type: 'context' });
              } else {
                // Show a collapse indicator for skipped context
                lines.push({ text: currentTheme.dimFg('border', ' ···'), type: 'context' });
              }
          }
        }
      }
      lines.push({ text: '', type: 'context' });
    }

    return lines;
  }

  /**
   * Compute inline word-level diff between two lines.
   * Returns the `current` line with changed words highlighted.
   */
  private inlineWordDiff(otherLine: string, currentLine: string, mode: 'add' | 'del'): string {
    const otherWords = otherLine.split(/(\s+)/);
    const currentWords = currentLine.split(/(\s+)/);

    // Simple LCS-based word diff for short lines
    if (currentWords.length > 40 || otherWords.length > 40) {
      // Too long for word diff, fall back to full-line coloring
      return mode === 'add' ? green(currentLine) : red(currentLine);
    }

    // Find common prefix and suffix
    let prefixLen = 0;
    while (prefixLen < Math.min(otherWords.length, currentWords.length) &&
           otherWords[prefixLen] === currentWords[prefixLen]) {
      prefixLen++;
    }
    let suffixLen = 0;
    while (suffixLen < Math.min(otherWords.length, currentWords.length) - prefixLen &&
           otherWords[otherWords.length - 1 - suffixLen] === currentWords[currentWords.length - 1 - suffixLen]) {
      suffixLen++;
    }

    const prefix = currentWords.slice(0, prefixLen).join('');
    const suffix = currentWords.slice(currentWords.length - suffixLen).join('');
    const changed = currentWords.slice(prefixLen, currentWords.length - suffixLen).join('');

    if (changed.length === 0) {
      return mode === 'add' ? green(currentLine) : red(currentLine);
    }

    // Render: normal prefix + highlighted change + normal suffix
    const baseColor = mode === 'add' ? green : red;
    const highlightColor = mode === 'add'
      ? (t: string) => currentTheme.bg('diffAdded', currentTheme.fg('textStrong', t))
      : (t: string) => currentTheme.bg('diffRemoved', currentTheme.fg('textStrong', t));

    return baseColor(prefix) + highlightColor(changed) + baseColor(suffix);
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
    // Detect binary files
    const isBinary = chunk.includes('Binary files') || chunk.includes('GIT binary patch');
    // Detect file mode changes (e.g. 100644 → 100755)
    let modeChange: string | undefined;
    const oldModeMatch = chunk.match(/old mode (\d+)/);
    const newModeMatch = chunk.match(/new mode (\d+)/);
    if (oldModeMatch && newModeMatch && oldModeMatch[1] !== newModeMatch[1]) {
      const fmt = (m: string) => m === '100755' ? '+x' : m === '100644' ? '-x' : m;
      modeChange = `${fmt(oldModeMatch[1]!)} → ${fmt(newModeMatch[1]!)}`;
    }

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

    // Detect whitespace-only changes (all added/removed lines differ only in whitespace)
    let whitespaceOnly = false;
    if (additions > 0 && additions === deletions && hunks.length > 0) {
      const addLines = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.content.trim()));
      const delLines = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'del').map((l) => l.content.trim()));
      whitespaceOnly = addLines.length === delLines.length && addLines.every((l, i) => l === delLines[i]);
    }

    // Detect import/require statement changes
    let hasImportChanges = false;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if ((line.type === 'add' || line.type === 'del') &&
            /^(import |from |require(|export )/.test(line.content.trim())) {
          hasImportChanges = true;
          break;
        }
      }
      if (hasImportChanges) break;
    }

    // Detect TODO/FIXME/HACK comments in added lines
    let todoCount = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add' && /\b(TODO|FIXME|HACK|XXX)\b/.test(line.content)) {
          todoCount++;
        }
      }
    }

    // Detect test files
    const isTestFile = /(\.spec\.|\.test\.|__tests__|\/test\/|\/tests\/)/.test(filePath);
    // Detect config files
    const isConfigFile = /(package\.json|tsconfig|\.env|\.ya?ml|\.toml|\.ini|\.cfg|webpack|vite\.config|\.eslintrc|\.prettierrc|Makefile|Dockerfile|\.github)/.test(filePath);
    // Detect documentation files
    const isDocFile = /(README|CHANGELOG|CONTRIBUTING|LICENSE|\.md$|\/docs?\/|\.mdx$|\.rst$)/.test(filePath);

    // Detect large changes (>500 lines total)
    const isLargeChange = (additions + deletions) > 500;

    files.push({ path: filePath, status, additions, deletions, hunks, isBinary, modeChange, whitespaceOnly, hasImportChanges, todoCount: todoCount > 0 ? todoCount : undefined, isTestFile, isConfigFile, isDocFile, isLargeChange });
  }

  return files;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function dim(text: string): string { return currentTheme.dimFg('textDim', text); }
function bold(text: string): string { return currentTheme.boldFg('textStrong', text); }
function green(text: string): string { return currentTheme.fg('diffAdded', text); }
function red(text: string): string { return currentTheme.fg('diffRemoved', text); }
function yellow(text: string): string { return currentTheme.fg('warning', text); }
function cyan(text: string): string { return currentTheme.fg('primary', text); }
function inverse(text: string): string { return currentTheme.bg('selectionBg', currentTheme.fg('selectionText', text)); }
