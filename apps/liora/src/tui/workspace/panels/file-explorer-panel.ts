import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  readonly name: string;
  readonly fullPath: string;
  readonly isDirectory: boolean;
  readonly depth: number;
  readonly gitStatus?: string;
}

// ---------------------------------------------------------------------------
// FileExplorerPanel
// ---------------------------------------------------------------------------

export class FileExplorerPanel implements PanelDefinition {
  readonly id = 'file-explorer';
  readonly title = 'Files';
  readonly icon = '📁';
  readonly minWidth = 20;
  readonly minHeight = 5;

  private readonly rootPath: string;
  private entries: FileEntry[] = [];
  private expandedDirs = new Set<string>();
  private cursorIndex = 0;
  private scrollTop = 0;
  private gitStatusMap = new Map<string, string>();
  private lastWidth = 30;
  private lastHeight = 20;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.refreshTree();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    this.lastWidth = width;
    this.lastHeight = height;

    if (this.entries.length === 0) {
      return [dim('  (empty)')];
    }

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, this.entries.length - 1));

    // Ensure cursor is visible
    if (this.cursorIndex < this.scrollTop) {
      this.scrollTop = this.cursorIndex;
    }
    if (this.cursorIndex >= this.scrollTop + height) {
      this.scrollTop = this.cursorIndex - height + 1;
    }

    const lines: string[] = [];
    const visibleEntries = this.entries.slice(this.scrollTop, this.scrollTop + height);

    for (let i = 0; i < visibleEntries.length; i++) {
      const entry = visibleEntries[i]!;
      const globalIndex = this.scrollTop + i;
      const isCursor = focused && globalIndex === this.cursorIndex;
      let line = this.renderEntry(entry, isCursor, width);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        line = this.highlightSearch(line, searchQuery);
      }
      lines.push(line);
    }

    return lines;
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
        this.cursorIndex = Math.min(this.entries.length - 1, this.cursorIndex + 3);
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
        this.cursorIndex = Math.min(this.entries.length - 1, this.cursorIndex + 1);
        return true;
      case 'enter':
      case 'right':
        this.toggleExpand();
        return true;
      case 'left':
        this.collapseCurrent();
        return true;
      case 'character':
        if (event.text === 'r' || event.text === 'R') {
          this.refreshTree();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  dispose(): void {
    this.entries = [];
    this.expandedDirs.clear();
    this.gitStatusMap.clear();
  }

  // -------------------------------------------------------------------------
  // Tree operations
  // -------------------------------------------------------------------------

  refreshTree(): void {
    this.loadGitStatus();
    this.rebuildEntries();
  }

  private rebuildEntries(): void {
    this.entries = [];
    this.walkDirectory(this.rootPath, 0);
  }

  private walkDirectory(dirPath: string, depth: number): void {
    if (depth > 8) return; // Prevent infinite recursion

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files, alphabetical
    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      // Skip hidden and common noise directories
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === '__pycache__') {
        continue;
      }

      const fullPath = path.join(dirPath, item.name);
      const isDirectory = item.isDirectory();

      this.entries.push({
        name: item.name,
        fullPath,
        isDirectory,
        depth,
        gitStatus: this.gitStatusMap.get(path.relative(this.rootPath, fullPath)),
      });

      if (isDirectory && this.expandedDirs.has(fullPath)) {
        this.walkDirectory(fullPath, depth + 1);
      }
    }
  }

  private toggleExpand(): void {
    const entry = this.entries[this.cursorIndex];
    if (!entry) return;
    if (!entry.isDirectory) return;

    if (this.expandedDirs.has(entry.fullPath)) {
      this.expandedDirs.delete(entry.fullPath);
    } else {
      this.expandedDirs.add(entry.fullPath);
    }
    this.rebuildEntries();
  }

  private collapseCurrent(): void {
    const entry = this.entries[this.cursorIndex];
    if (!entry) return;

    if (entry.isDirectory && this.expandedDirs.has(entry.fullPath)) {
      this.expandedDirs.delete(entry.fullPath);
      this.rebuildEntries();
    } else if (entry.depth > 0) {
      // Move to parent directory
      const parentPath = path.dirname(entry.fullPath);
      const parentIndex = this.entries.findIndex(
        (e) => e.fullPath === parentPath && e.isDirectory,
      );
      if (parentIndex >= 0) {
        this.cursorIndex = parentIndex;
      }
    }
  }

  private loadGitStatus(): void {
    this.gitStatusMap.clear();
    try {
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const output = execSync('git status --porcelain', {
        cwd: this.rootPath,
        encoding: 'utf-8',
        timeout: 5000,
      });
      for (const line of output.split('\n')) {
        if (line.length < 4) continue;
        const status = line.slice(0, 2).trim();
        const filePath = line.slice(3);
        if (status && filePath) {
          this.gitStatusMap.set(filePath, status);
        }
      }
    } catch {
      // Not a git repo or git not available
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderEntry(entry: FileEntry, isCursor: boolean, width: number): string {
    const connector = this.getTreeConnector(entry);
    const icon = entry.isDirectory
      ? this.expandedDirs.has(entry.fullPath)
        ? '▼'
        : '▶'
      : getFileIcon(entry.name);

    // Theme-aware icon coloring
    const styledIcon = entry.isDirectory
      ? currentTheme.fg('accent', icon)
      : currentTheme.dimFg('textMuted', icon);
    const gitBadge = entry.gitStatus ? ` ${gitStatusStyled(entry.gitStatus)}` : '';
    const nameStyled = entry.isDirectory
      ? currentTheme.boldFg('textStrong', entry.name)
      : currentTheme.fg('text', entry.name);
    const label = `${connector}${styledIcon} ${nameStyled}${gitBadge}`;

    const truncated = label.slice(0, width);
    if (isCursor) {
      return inverse(truncated.padEnd(width));
    }
    return truncated;
  }

  /**
   * Build a themed tree connector prefix (├── / └── / │) for the entry.
   * Root-level entries get no connector; nested entries get proper tree lines.
   */
  private getTreeConnector(entry: FileEntry): string {
    if (entry.depth === 0) return '';

    // Build the prefix segments for each ancestor level
    const segments: string[] = [];
    for (let d = 0; d < entry.depth - 1; d++) {
      // Check if the ancestor at this depth has more siblings below
      const ancestorPath = this.getAncestorPath(entry, d);
      const hasMoreSiblings = ancestorPath !== null && this.hasSiblingsBelow(ancestorPath, d);
      segments.push(hasMoreSiblings
        ? currentTheme.dimFg('border', '│ ')
        : '  ');
    }

    // Final connector: is this the last sibling at its level?
    const isLast = this.isLastSibling(entry);
    segments.push(isLast
      ? currentTheme.dimFg('border', '└─')
      : currentTheme.dimFg('border', '├─'));

    return segments.join('');
  }

  /** Get the ancestor directory path at a given depth for an entry. */
  private getAncestorPath(entry: FileEntry, depth: number): string | null {
    let p = entry.fullPath;
    const stepsUp = entry.depth - depth;
    for (let i = 0; i < stepsUp; i++) {
      p = path.dirname(p);
    }
    return p;
  }

  /** Check if there are more entries at the same depth below the given ancestor. */
  private hasSiblingsBelow(ancestorPath: string, depth: number): boolean {
    const idx = this.entries.findIndex((e) => e.fullPath === ancestorPath);
    if (idx === -1) return false;
    // Look for subsequent entries at the same depth that share this ancestor
    for (let i = idx + 1; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.depth <= depth) return false; // moved past this subtree
      if (e.depth === depth + 1) return true; // found a sibling
    }
    return false;
  }

  /** Check if this entry is the last sibling at its depth level. */
  private isLastSibling(entry: FileEntry): boolean {
    const idx = this.entries.indexOf(entry);
    if (idx === -1) return true;
    // Look at the next entry: if it's at the same or lower depth, this is last
    const next = this.entries[idx + 1];
    if (!next) return true;
    return next.depth <= entry.depth;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileIcon(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'TS';
    case '.js':
    case '.mjs':
      return 'JS';
    case '.json':
      return '{}';
    case '.md':
      return 'MD';
    case '.yaml':
    case '.yml':
      return 'YML';
    case '.py':
      return 'PY';
    case '.rs':
      return 'RS';
    case '.go':
      return 'GO';
    default:
      return '·';
  }
}

function gitStatusColor(status: string): string {
  // Return a short colored badge
  switch (status) {
    case 'M':
      return '[M]';
    case 'A':
    case '??':
      return '[+]';
    case 'D':
      return '[-]';
    default:
      return `[${status}]`;
  }
}

/** Theme-aware git status badge. */
function gitStatusStyled(status: string): string {
  switch (status) {
    case 'M':
      return currentTheme.fg('warning', '[M]');
    case 'A':
    case '??':
      return currentTheme.fg('success', '[+]');
    case 'D':
      return currentTheme.fg('error', '[-]');
    default:
      return currentTheme.dimFg('textMuted', `[${status}]`);
  }
}

function dim(text: string): string {
  return currentTheme.dimFg('textDim', text);
}

function inverse(text: string): string {
  return currentTheme.bg('selectionBg', currentTheme.fg('selectionText', text));
}
