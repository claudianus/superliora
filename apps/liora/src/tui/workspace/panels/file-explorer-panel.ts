import { execSync } from 'node:child_process';
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
  readonly sizeBytes?: number;
  readonly isSymlink?: boolean;
  readonly isExecutable?: boolean;
  readonly mode?: number;
  readonly mtimeMs?: number;
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
  private sortMode: 'name' | 'type' = 'name';
  private showHidden = false;
  private gitStatusMap = new Map<string, string>();
  private gitBranch: string | null = null;
  private gitCommitCount = 0;
  private gitTag: string | null = null;
  private gitRemote: string | null = null;
  private gitAhead = 0;
  private gitBehind = 0;
  private gitStashCount = 0;
  private gitTagAnnotation: string | null = null;
  /** Git submodule paths */
  private submodulePaths: Set<string> = new Set();
  /** Quick search navigation */
  private quickSearchActive = false;
  private quickSearchQuery = '';
  /** Git blame cache for selected file */
  private blameCache: Map<string, string> = new Map();
  /** File content preview cache */
  private previewCache: Map<string, string[]> = new Map();
  private previewEnabled = true;
  /** Git commit count cache for selected file */
  private fileCommitCache: Map<string, number> = new Map();
  /** Duplicate file name detection */
  private duplicateNames: Set<string> = new Set();
  /** Branch divergence from main */
  private branchDivergence: { ahead: number; behind: number } | null = null;
  /** Recently modified files (within 1 hour) */
  private recentlyModified: Set<string> = new Set();
  /** Whether this is a git worktree */
  private isWorktree = false;
  /** Git ignore patterns cache */
  private gitignorePatterns: string[] = [];
  /** File type filter */
  private typeFilter: string | null = null;
  private static readonly TYPE_FILTERS = [null, '.ts', '.json', '.md', '.css', '.html'] as const;
  private lastWidth = 30;
  private lastHeight = 20;
  /** Render cache: avoids re-computing lines when nothing changed. */
  private renderCache: { key: string; lines: string[] } | null = null;
  private treeVersion = 0;

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

    // Fast-path: return cached lines when content hasn't changed
    const cacheKey = `${width}:${height}:${focused}:${searchQuery ?? ''}:${this.cursorIndex}:${this.scrollTop}:${this.treeVersion}`;
    if (this.renderCache !== null && this.renderCache.key === cacheKey) {
      return this.renderCache.lines;
    }

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, this.entries.length - 1));

    // Ensure cursor is visible
    if (this.cursorIndex < this.scrollTop) {
      this.scrollTop = this.cursorIndex;
    }
    const headerRows = focused ? 1 : 0;
    if (this.cursorIndex >= this.scrollTop + height - headerRows) {
      this.scrollTop = this.cursorIndex - height + headerRows + 1;
    }

    const lines: string[] = [];

    // Header stats line (visible when focused)
    if (focused) {
      const dirs = this.entries.filter((e) => e.isDirectory).length;
      const files = this.entries.length - dirs;
      const modified = this.entries.filter((e) => e.gitStatus === 'M').length;
      const added = this.entries.filter((e) => e.gitStatus === 'A' || e.gitStatus === '??').length;
      let stats = currentTheme.dimFg('textMuted', ` ${String(dirs)}d ${String(files)}f`);
      if (modified > 0) stats += currentTheme.fg('warning', ` ~${String(modified)}`);
      if (added > 0) stats += currentTheme.fg('success', ` +${String(added)}`);
      // Sort mode indicator
      if (this.sortMode === 'type') stats += currentTheme.fg('accent', ' [type]');
      // Type filter indicator
      if (this.typeFilter !== null) stats += currentTheme.fg('primary', ` [${this.typeFilter}]`);
      // Hidden files indicator
      if (this.showHidden) stats += currentTheme.fg('accent', ' [dot]');
      // Git branch badge
      if (this.gitBranch) stats += ` ${currentTheme.fg('primary', ` ${this.gitBranch}`)}`;
      // Git worktree indicator
      if (this.isWorktree) stats += currentTheme.fg('accent', ' ⑂wt');
      // Git commit count
      if (this.gitCommitCount > 0) stats += currentTheme.dimFg('textMuted', ` ${String(this.gitCommitCount)}c`);
      // Git tag (latest)
      if (this.gitTag) {
        stats += ` ${currentTheme.fg('accent', `🏷${this.gitTag}`)}`;
        if (this.gitTagAnnotation) {
          const shortAnnot = this.gitTagAnnotation.length > 25
            ? this.gitTagAnnotation.slice(0, 24) + '…'
            : this.gitTagAnnotation;
          stats += currentTheme.dimFg('textMuted', ` "${shortAnnot}"`);
        }
      }
      // Git remote
      if (this.gitRemote) stats += currentTheme.dimFg('textMuted', ` ⬡${this.gitRemote}`);
      // Git ahead/behind
      if (this.gitAhead > 0) stats += currentTheme.fg('success', ` ↑${String(this.gitAhead)}`);
      if (this.gitBehind > 0) stats += currentTheme.fg('warning', ` ↓${String(this.gitBehind)}`);
      // Breadcrumb path for selected entry (compact, shows relative path segments)
      const selectedEntry = this.entries[this.cursorIndex];
      if (selectedEntry && selectedEntry.depth > 0) {
        const relPath = selectedEntry.fullPath.replace(this.rootPath + '/', '');
        const segments = relPath.split('/');
        const breadcrumb = segments.length > 3
          ? segments.slice(0, 2).join('/') + '/…/' + segments[segments.length - 1]
          : relPath;
        stats += currentTheme.dimFg('textMuted', ` 📍${breadcrumb}`);
      }
      // Git blame for selected file (last author, cached)
      if (selectedEntry && !selectedEntry.isDirectory) {
        const blameKey = selectedEntry.fullPath;
        if (!this.blameCache.has(blameKey)) {
          try {
            const blameOutput = execSync(`git log -1 --format="%an" -- "${blameKey}"`, {
              cwd: this.rootPath,
              encoding: 'utf-8',
              timeout: 2000,
              stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
            this.blameCache.set(blameKey, blameOutput || '');
          } catch {
            this.blameCache.set(blameKey, '');
          }
        }
        const author = this.blameCache.get(blameKey);
        if (author && author.length > 0) {
          stats += currentTheme.dimFg('textMuted', ` ✍${author}`);
        }
        // Git commit count for the selected file
        if (!this.fileCommitCache.has(blameKey)) {
          try {
            const countOutput = execSync(`git rev-list --count HEAD -- "${blameKey}"`, {
              cwd: this.rootPath,
              encoding: 'utf-8',
              timeout: 2000,
              stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
            this.fileCommitCache.set(blameKey, parseInt(countOutput, 10) || 0);
          } catch {
            this.fileCommitCache.set(blameKey, 0);
          }
        }
        const commitCount = this.fileCommitCache.get(blameKey) ?? 0;
        if (commitCount > 0) {
          stats += currentTheme.dimFg('textMuted', ` ${String(commitCount)}c`);
        }
      }
      // Git stash count + latest stash preview
      if (this.gitStashCount > 0) {
        stats += currentTheme.fg('accent', ` ≡${String(this.gitStashCount)}`);
        // Show latest stash message (truncated)
        try {
          const stashMsg = execSync('git stash list -1 --format="%s"', {
            cwd: this.rootPath,
            encoding: 'utf-8',
            timeout: 2000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          if (stashMsg.length > 0) {
            const shortMsg = stashMsg.length > 20 ? stashMsg.slice(0, 19) + '…' : stashMsg;
            stats += currentTheme.dimFg('textMuted', ` "${shortMsg}"`);
          }
        } catch {
          // No stash or not a git repo
        }
      }
      lines.push(stats);
      // Git status summary bar (compact visual of modified/added/deleted/untracked)
      const modCount = this.entries.filter((e) => e.gitStatus === 'M').length;
      const addCount = this.entries.filter((e) => e.gitStatus === 'A').length;
      const delCount = this.entries.filter((e) => e.gitStatus === 'D').length;
      const untrackedCount = this.entries.filter((e) => e.gitStatus === '??').length;
      if (modCount + addCount + delCount + untrackedCount > 0) {
        const SUMMARY_W = Math.min(20, width - 4);
        const total = modCount + addCount + delCount + untrackedCount;
        const mW = Math.round((modCount / total) * SUMMARY_W);
        const aW = Math.round((addCount / total) * SUMMARY_W);
        const dW = Math.round((delCount / total) * SUMMARY_W);
        const uW = SUMMARY_W - mW - aW - dW;
        const summaryBar =
          currentTheme.fg('warning', '▓'.repeat(mW)) +
          currentTheme.fg('success', '▓'.repeat(aW)) +
          currentTheme.fg('error', '▓'.repeat(dW)) +
          currentTheme.dimFg('textMuted', '░'.repeat(Math.max(0, uW)));
        lines.push(` ${summaryBar}`);
      }
    }

    // File content preview (last 3 lines of panel when a file is selected)
    if (this.previewEnabled && focused && height > 8) {
      const selEntry = this.entries[this.cursorIndex];
      if (selEntry && !selEntry.isDirectory) {
        if (!this.previewCache.has(selEntry.fullPath)) {
          try {
            const fileContent = fs.readFileSync(selEntry.fullPath, 'utf-8');
            const previewLines = fileContent.split('\n').slice(0, 3).map((l) => l.slice(0, width - 4));
            this.previewCache.set(selEntry.fullPath, previewLines);
          } catch {
            this.previewCache.set(selEntry.fullPath, []);
          }
        }
        const preview = this.previewCache.get(selEntry.fullPath) ?? [];
        if (preview.length > 0) {
          lines.push(currentTheme.dimFg('border', '┄'.repeat(Math.min(width, 30))));
          for (const pl of preview) {
            lines.push(currentTheme.dimFg('textDim', `  ${pl}`));
          }
        }
      }
    }

    // Quick search bar overlay
    if (this.quickSearchActive) {
      const searchLabel = currentTheme.fg('primary', `/${this.quickSearchQuery}`) + currentTheme.fg('primary', '▏');
      lines.push(this.pad(searchLabel, width));
    }

    // Apply type filter
    const filteredEntries = this.typeFilter !== null
      ? this.entries.filter((e) => e.isDirectory || e.name.endsWith(this.typeFilter!))
      : this.entries;
    const visibleEntries = filteredEntries.slice(this.scrollTop, this.scrollTop + height - headerRows);

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

    // File path footer when focused (shows full path of selected entry)
    if (focused && this.entries.length > 0) {
      const selected = this.entries[this.cursorIndex];
      if (selected) {
        const relPath = path.relative(this.rootPath, selected.fullPath);
        const pathLine = currentTheme.dimFg('textMuted', ` ${truncate(relPath, width - 2)}`);
        lines.push(pathLine);
      }
    }

    this.renderCache = { key: cacheKey, lines };
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
        if (event.text === 'c' || event.text === 'C') {
          // Collapse all directories
          this.expandedDirs.clear();
          this.rebuildEntries();
          this.treeVersion++;
          this.renderCache = null;
          return true;
        }
        if (event.text === 'e' || event.text === 'E') {
          // Expand all directories (up to depth limit)
          this.expandAll();
          return true;
        }
        if (event.text === 's' || event.text === 'S') {
          // Toggle sort: name → type → name
          this.sortMode = this.sortMode === 'name' ? 'type' : 'name';
          this.rebuildEntries();
          this.treeVersion++;
          this.renderCache = null;
          return true;
        }
        if (event.text === 'h' || event.text === 'H') {
          // Toggle hidden files visibility
          this.showHidden = !this.showHidden;
          this.rebuildEntries();
          this.treeVersion++;
          this.renderCache = null;
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

  /** Pad a string to the given width with spaces (ANSI-aware). */
  private pad(text: string, width: number): string {
    // Strip ANSI to measure visible length
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, width - visible.length);
    return text + ' '.repeat(padding);
  }

  // -------------------------------------------------------------------------
  // Tree operations
  // -------------------------------------------------------------------------

  refreshTree(): void {
    this.loadGitStatus();
    this.rebuildEntries();
    this.treeVersion++;
    this.renderCache = null;
  }

  private rebuildEntries(): void {
    this.entries = [];
    this.walkDirectory(this.rootPath, 0);
  }

  private walkDirectory(dirPath: string, depth: number): void {
    if (depth > 8) {
      // Add a depth limit indicator entry
      this.entries.push({
        name: '…',
        fullPath: dirPath,
        isDirectory: false,
        depth,
      });
      return;
    }

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
      if (this.sortMode === 'type') {
        const extA = path.extname(a.name).toLowerCase();
        const extB = path.extname(b.name).toLowerCase();
        if (extA !== extB) return extA.localeCompare(extB);
      }
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      // Skip hidden and common noise directories
      if ((!this.showHidden && item.name.startsWith('.')) || item.name === 'node_modules' || item.name === '__pycache__') {
        continue;
      }

      const fullPath = path.join(dirPath, item.name);
      const isDirectory = item.isDirectory();
      const isSymlink = item.isSymbolicLink();

      // Get file size for non-directory entries
      let sizeBytes: number | undefined;
      let isExecutable = false;
      let fileMode: number | undefined;
      let mtimeMs: number | undefined;
      if (!isDirectory) {
        try {
          const stat = fs.statSync(fullPath);
          sizeBytes = stat.size;
          // Check executable bit (owner)
          isExecutable = (stat.mode & 0o100) !== 0;
          fileMode = stat.mode;
          mtimeMs = stat.mtimeMs;
          // Track recently modified files (within 1 hour)
          if (Date.now() - stat.mtimeMs < 3_600_000) {
            this.recentlyModified.add(fullPath);
          }
        } catch {
          // ignore stat errors
        }
      }

      this.entries.push({
        name: item.name,
        fullPath,
        isDirectory,
        depth,
        gitStatus: this.gitStatusMap.get(path.relative(this.rootPath, fullPath)),
        sizeBytes,
        isSymlink,
        isExecutable,
        mode: fileMode,
        mtimeMs,
      });

      if (isDirectory && this.expandedDirs.has(fullPath)) {
        this.walkDirectory(fullPath, depth + 1);
      }
    }

    // Detect duplicate file names across directories (only at root level walk completion)
    if (depth === 0) {
      const nameCounts = new Map<string, number>();
      for (const entry of this.entries) {
        if (!entry.isDirectory) {
          nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
        }
      }
      this.duplicateNames = new Set(
        [...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
      );
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
    this.treeVersion++;
    this.renderCache = null;
  }

  private collapseCurrent(): void {
    const entry = this.entries[this.cursorIndex];
    if (!entry) return;

    if (entry.isDirectory && this.expandedDirs.has(entry.fullPath)) {
      this.expandedDirs.delete(entry.fullPath);
      this.rebuildEntries();
      this.treeVersion++;
      this.renderCache = null;
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

  /** Expand all directories up to the depth limit. */
  private expandAll(): void {
    const expandRecursive = (dirPath: string, depth: number): void => {
      if (depth > 4) return; // Limit expansion depth for performance
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (!item.isDirectory()) continue;
        if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === '__pycache__') continue;
        const fullPath = path.join(dirPath, item.name);
        this.expandedDirs.add(fullPath);
        expandRecursive(fullPath, depth + 1);
      }
    };
    expandRecursive(this.rootPath, 0);
    this.rebuildEntries();
    this.treeVersion++;
    this.renderCache = null;
  }

  private loadGitStatus(): void {
    this.gitStatusMap.clear();
    this.gitBranch = null;
    this.gitCommitCount = 0;
    this.recentlyModified.clear();
    try {
      const SAFE_STDIO: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
      // Get current branch
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim();
        if (branch && branch !== 'HEAD') this.gitBranch = branch;
      } catch {
        // ignore branch detection errors
      }
      // Get commit count
      try {
        const countStr = execSync('git rev-list --count HEAD', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim();
        this.gitCommitCount = parseInt(countStr, 10) || 0;
      } catch {
        // ignore commit count errors
      }
      // Get latest tag
      try {
        const tag = execSync('git describe --tags --abbrev=0', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim();
        this.gitTag = tag || null;
        // Fetch tag annotation if available
        this.gitTagAnnotation = null;
        if (tag) {
          try {
            const annotation = execSync(`git tag -l --format='%(contents:subject)' "${tag}"`, {
              cwd: this.rootPath,
              encoding: 'utf-8',
              timeout: 2000,
              stdio: SAFE_STDIO,
            }).trim();
            if (annotation.length > 0) this.gitTagAnnotation = annotation;
          } catch {
            // Lightweight tag or no annotation
          }
        }
      } catch {
        this.gitTag = null;
      }
      // Get remote name
      try {
        const remote = execSync('git remote', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim().split('\n')[0] ?? '';
        this.gitRemote = remote || null;
      } catch {
        this.gitRemote = null;
      }
      // Get ahead/behind counts
      this.gitAhead = 0;
      this.gitBehind = 0;
      try {
        const abOutput = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim();
        const parts = abOutput.split(/\s+/);
        if (parts.length === 2) {
          this.gitAhead = parseInt(parts[0]!, 10) || 0;
          this.gitBehind = parseInt(parts[1]!, 10) || 0;
        }
      } catch {
        // No upstream or not a tracking branch
      }
      // Detect git submodules
      this.submodulePaths.clear();
      try {
        const submoduleOutput = execSync('git submodule status', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        });
        for (const line of submoduleOutput.split('\n')) {
          const match = line.match(/^\s*[-+ ]?[0-9a-f]+\s+(\S+)/);
          if (match && match[1]) {
            this.submodulePaths.add(require('node:path').join(this.rootPath, match[1]));
          }
        }
      } catch {
        // No submodules
      }
      // Load gitignore patterns
      this.gitignorePatterns = [];
      try {
        const gitignoreContent = require('node:fs').readFileSync(
          require('node:path').join(this.rootPath, '.gitignore'), 'utf-8'
        );
        this.gitignorePatterns = gitignoreContent
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0 && !l.startsWith('#'));
      } catch {
        // No .gitignore
      }
      // Detect git worktree
      this.isWorktree = false;
      try {
        const gitDir = execSync('git rev-parse --git-dir', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 2000,
          stdio: SAFE_STDIO,
        }).trim();
        // In a worktree, .git is a file pointing to .git/worktrees/<name>
        this.isWorktree = gitDir.includes('worktrees');
      } catch {
        // Not a git repo
      }
      // Get branch divergence from main/master
      this.branchDivergence = null;
      try {
        const baseBranch = execSync('git rev-parse --verify main', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 2000,
          stdio: SAFE_STDIO,
        }).trim();
        if (baseBranch) {
          const divOutput = execSync('git rev-list --left-right --count HEAD...main', {
            cwd: this.rootPath,
            encoding: 'utf-8',
            timeout: 2000,
            stdio: SAFE_STDIO,
          }).trim();
          const divParts = divOutput.split(/\s+/);
          if (divParts.length === 2) {
            this.branchDivergence = {
              ahead: parseInt(divParts[0]!, 10) || 0,
              behind: parseInt(divParts[1]!, 10) || 0,
            };
          }
        }
      } catch {
        // Not on a divergent branch or no main/master
      }
      // Get stash count
      this.gitStashCount = 0;
      try {
        const stashOutput = execSync('git stash list', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: SAFE_STDIO,
        }).trim();
        this.gitStashCount = stashOutput.length > 0 ? stashOutput.split('\n').length : 0;
      } catch {
        // Not a git repo or no stashes
      }
      const output = execSync('git status --porcelain', {
        cwd: this.rootPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: SAFE_STDIO,
      });
      for (const line of output.split('\n')) {
        if (line.length < 4) continue;
        const status = line.slice(0, 2).trim();
        const filePath = line.slice(3);
        if (status && filePath) {
          this.gitStatusMap.set(filePath, status);
        }
      }
      // Also load ignored files
      try {
        const ignoredOutput = execSync('git status --porcelain --ignored', {
          cwd: this.rootPath,
          encoding: 'utf-8',
          timeout: 5000,
        });
        for (const line of ignoredOutput.split('\n')) {
          if (line.startsWith('!!')) {
            const filePath = line.slice(3);
            if (filePath && !this.gitStatusMap.has(filePath)) {
              this.gitStatusMap.set(filePath, '!');
            }
          }
        }
      } catch {
        // Ignore errors from --ignored flag
      }
    } catch {
      // Not a git repo or git not available
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Jump to the first entry matching the quick search query. */
  private jumpToSearchMatch(): void {
    if (this.quickSearchQuery.length === 0) return;
    const lowerQuery = this.quickSearchQuery.toLowerCase();
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i]!.name.toLowerCase().includes(lowerQuery)) {
        this.cursorIndex = i;
        // Ensure visible
        if (this.cursorIndex < this.scrollTop) this.scrollTop = this.cursorIndex;
        if (this.cursorIndex >= this.scrollTop + this.lastHeight - 2) {
          this.scrollTop = this.cursorIndex - this.lastHeight + 3;
        }
        return;
      }
    }
  }

  private renderEntry(entry: FileEntry, isCursor: boolean, width: number): string {
    const connector = this.getTreeConnector(entry);
    const icon = entry.isDirectory
      ? this.expandedDirs.has(entry.fullPath)
        ? '▼'
        : '▶'
      : getFileIcon(entry.name);

    // Directory item count (show when expanded)
    let dirCountBadge = '';
    if (entry.isDirectory && this.expandedDirs.has(entry.fullPath)) {
      const childCount = this.entries.filter((e) =>
        e.depth === entry.depth + 1 && e.fullPath.startsWith(entry.fullPath + '/')
      ).length;
      if (childCount > 0) {
        dirCountBadge = currentTheme.dimFg('textMuted', ` (${String(childCount)})`);
      }
    }

    // Theme-aware icon coloring
    const styledIcon = entry.isDirectory
      ? currentTheme.fg('accent', icon)
      : currentTheme.fg(getFileToken(entry.name), icon);
    const gitBadge = entry.gitStatus ? ` ${gitStatusStyled(entry.gitStatus)}` : '';
    // Enhanced file type color coding based on extension category
    const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : '';
    const FILE_TYPE_TOKENS: Record<string, string> = {
      // Source code
      ts: 'primary', tsx: 'primary', js: 'warning', jsx: 'warning',
      py: 'success', rs: 'error', go: 'accent', rb: 'error',
      // Styles
      css: 'accent', scss: 'accent', less: 'accent',
      // Data/config
      json: 'warning', yaml: 'warning', yml: 'warning', toml: 'warning',
      // Docs
      md: 'textDim', mdx: 'textDim', txt: 'textDim', rst: 'textDim',
      // Images
      png: 'particle', jpg: 'particle', svg: 'particle', gif: 'particle',
      // Lock/generated
      lock: 'textMuted', log: 'textMuted',
    };
    const fileTypeToken = FILE_TYPE_TOKENS[ext];
    const nameStyled = entry.isDirectory
      ? currentTheme.boldFg('textStrong', entry.name)
      : fileTypeToken
        ? currentTheme.fg(fileTypeToken as keyof import('#/tui/theme').ColorPalette, entry.name)
        : currentTheme.fg(getFileNameToken(entry.name), entry.name);
    // Symlink indicator
    const symlinkBadge = entry.isSymlink ? currentTheme.fg('accent', ' @') : '';
    const execBadge = entry.isExecutable ? currentTheme.fg('success', ' *') : '';
    // File size for non-directory entries (compact)
    const sizeBadge = entry.sizeBytes !== undefined && entry.sizeBytes > 0
      ? ` ${currentTheme.dimFg('textMuted', formatFileSize(entry.sizeBytes))}`
      : '';
    // File permission badge (compact rwx)
    const permBadge = entry.mode !== undefined && !entry.isDirectory
      ? ` ${currentTheme.dimFg('textMuted', formatPerms(entry.mode))}`
      : '';
    // File age badge (compact relative time)
    const ageBadge = entry.mtimeMs !== undefined
      ? ` ${currentTheme.dimFg('textMuted', formatAge(entry.mtimeMs))}`
      : '';
    // Duplicate file name badge
    const dupBadge = !entry.isDirectory && this.duplicateNames.has(entry.name)
      ? currentTheme.fg('warning', ' ⧉')
      : '';
    // Recently modified "hot" badge
    const hotBadge = !entry.isDirectory && this.recentlyModified.has(entry.fullPath)
      ? currentTheme.fg('warning', ' 🔥')
      : '';
    // Git ignore pattern match indicator
    const ignoreMatch = entry.gitStatus === '!!' && this.gitignorePatterns.length > 0
      ? this.gitignorePatterns.find((p) => {
          const cleanPattern = p.replace(/^\//, '').replace(/\/$/, '');
          return entry.name.includes(cleanPattern) || entry.fullPath.includes(cleanPattern);
        })
      : undefined;
    const ignoreBadge = ignoreMatch
      ? currentTheme.dimFg('textMuted', ` (${ignoreMatch})`)
      : '';
    // Git submodule badge
    const submoduleBadge = entry.isDirectory && this.submodulePaths.has(entry.fullPath)
      ? currentTheme.fg('primary', ' ⬡')
      : '';
    const label = `${connector}${styledIcon} ${nameStyled}${dirCountBadge}${submoduleBadge}${symlinkBadge}${execBadge}${gitBadge}${sizeBadge}${permBadge}${ageBadge}${dupBadge}${hotBadge}${ignoreBadge}`;

    const truncated = label.slice(0, Math.max(0, width - 1));
    const line = ` ${truncated}`;
    if (isCursor) {
      return inverse(line.padEnd(width));
    }
    return line.padEnd(width);
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
        ? currentTheme.dimFg('border', '┊ ')
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

/** Format file size in human-readable form (B/K/M). */
/** Format file age as compact relative time (e.g. 2m, 3h, 5d). */
function formatAge(mtimeMs: number): string {
  const ageSec = Math.floor(Math.max(0, Date.now() - mtimeMs) / 1000);
  if (ageSec < 60) return 'now';
  if (ageSec < 3600) return `${String(Math.floor(ageSec / 60))}m`;
  if (ageSec < 86400) return `${String(Math.floor(ageSec / 3600))}h`;
  return `${String(Math.floor(ageSec / 86400))}d`;
}

/** Format file mode as compact rwx string (e.g. rw-r--r--). */
function formatPerms(mode: number): string {
  const perms = mode & 0o777;
  const r = (p: number) => (perms & p) ? '' : '-';
  const owner = `${(perms & 0o400) ? 'r' : '-'}${(perms & 0o200) ? 'w' : '-'}${(perms & 0o100) ? 'x' : '-'}`;
  const group = `${(perms & 0o040) ? 'r' : '-'}${(perms & 0o020) ? 'w' : '-'}${(perms & 0o010) ? 'x' : '-'}`;
  const other = `${(perms & 0o004) ? 'r' : '-'}${(perms & 0o002) ? 'w' : '-'}${(perms & 0o001) ? 'x' : '-'}`;
  return `${owner}${group}${other}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

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

/** Theme token for file type icon based on extension. */
function getFileToken(name: string): 'primary' | 'accent' | 'warning' | 'success' | 'textDim' | 'particle' {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'primary';
    case '.js':
    case '.mjs':
      return 'warning';
    case '.json':
    case '.yaml':
    case '.yml':
      return 'textDim';
    case '.md':
      return 'accent';
    case '.py':
      return 'success';
    case '.rs':
      return 'particle';
    case '.go':
      return 'primary';
    default:
      return 'textDim';
  }
}

/** Theme token for file name based on extension (subtler than icon). */
function getFileNameToken(name: string): 'text' | 'textDim' {
  const ext = path.extname(name).toLowerCase();
  // Config/lock files are dimmer
  if (['.lock', '.log', '.bak', '.tmp'].includes(ext)) return 'textDim';
  if (name.startsWith('.') || name === 'package-lock.json') return 'textDim';
  return 'text';
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
    case '!':
      return currentTheme.dimFg('textMuted', '[ig]');
    default:
      return currentTheme.dimFg('textMuted', `[${status}]`);
  }
}

function dim(text: string): string {
  return currentTheme.dimFg('textDim', text);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function inverse(text: string): string {
  return currentTheme.bg('selectionBg', currentTheme.fg('selectionText', text));
}
