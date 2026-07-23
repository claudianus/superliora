import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageFileInfo {
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly ext: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.pnpm-store', 'dist', 'build', '.next',
  '.superliora', '.worktrees', 'coverage',
]);

const MAX_SCAN_DEPTH = 3;
const MAX_IMAGES = 50;

// ---------------------------------------------------------------------------
// ImagePreviewPanel
// ---------------------------------------------------------------------------

export class ImagePreviewPanel implements PanelDefinition {
  readonly id = 'image-preview';
  readonly title = 'Images';
  readonly icon = '🖼';
  readonly minWidth = 28;
  readonly minHeight = 8;

  private readonly cwd: string;
  private images: ImageFileInfo[] = [];
  private cursorIndex = 0;
  private scrollTop = 0;
  private lastScan = 0;
  private previewData: string | null = null;
  private previewName: string | null = null;
  private statusMessage: string | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.scanImages();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    // Re-scan every 30 seconds
    const now = Date.now();
    if (now - this.lastScan > 30_000) {
      this.scanImages();
    }

    const lines: string[] = [];

    // Header
    lines.push(this.pad(currentTheme.boldFg('primary', ` ${String(this.images.length)} images`), width));

    if (this.images.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', '(no images found)')}`, width));
      return this.fillLines(lines, height, width);
    }

    // Clamp cursor
    this.cursorIndex = Math.max(0, Math.min(this.cursorIndex, this.images.length - 1));

    // Image list (top half)
    const listHeight = Math.floor((height - 2) / 2);
    const maxScroll = Math.max(0, this.images.length - listHeight);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    // Ensure cursor visible
    if (this.cursorIndex < this.scrollTop) this.scrollTop = this.cursorIndex;
    if (this.cursorIndex >= this.scrollTop + listHeight) {
      this.scrollTop = this.cursorIndex - listHeight + 1;
    }

    const end = Math.min(this.images.length, this.scrollTop + listHeight);
    for (let i = this.scrollTop; i < end; i++) {
      const img = this.images[i]!;
      const selected = i === this.cursorIndex;
      const marker = selected ? currentTheme.fg('primary', '▸') : ' ';
      const size = formatSize(img.sizeBytes);
      const name = truncate(img.name, width - 10);
      const nameStyled = selected ? currentTheme.boldFg('textStrong', name) : currentTheme.fg('text', name);
      const sizeStyled = currentTheme.dimFg('textMuted', size);
      const line = `${marker} ${nameStyled} ${sizeStyled}`;
      if (selected && focused) {
        lines.push(this.pad(currentTheme.bg('selectionBg', currentTheme.fg('selectionText', line)), width));
      } else {
        lines.push(this.pad(line, width));
      }
    }

    // Fill list area
    while (lines.length < listHeight + 1) {
      lines.push(' '.repeat(width));
    }

    // Separator
    lines.push(this.pad(`${currentTheme.dimFg('border', ' ── ')}${currentTheme.fg('accent', '◈ preview')}${currentTheme.dimFg('border', ' ──')}`, width));

    // Preview area (bottom half)
    const selected = this.images[this.cursorIndex];
    if (selected !== undefined) {
      if (this.previewName !== selected.path) {
        this.loadPreview(selected);
      }
      if (this.statusMessage !== null) {
        lines.push(this.pad(` ${currentTheme.fg('warning', this.statusMessage)}`, width));
      } else {
        // File info header
        const extBadge = currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ${selected.ext.slice(1).toUpperCase()} `));
        lines.push(this.pad(` ${currentTheme.boldFg('textStrong', selected.name)} ${extBadge}`, width));
        lines.push(this.pad(` ${currentTheme.dimFg('textMuted', `${formatSize(selected.sizeBytes)}`)}`, width));
        // Visual preview placeholder — same rounded language as bento tiles.
        lines.push(this.pad(` ${currentTheme.dimFg('border', '╭')}${currentTheme.dimFg('border', '─'.repeat(Math.min(width - 4, 24)))}${currentTheme.dimFg('border', '╮')}`, width));
        lines.push(this.pad(` ${currentTheme.dimFg('border', '│')} ${currentTheme.fg('accent', '🖼')} ${currentTheme.dimFg('textMuted', 'Kitty inline preview')}${currentTheme.dimFg('border', ' │')}`, width));
        lines.push(this.pad(` ${currentTheme.dimFg('border', '╰')}${currentTheme.dimFg('border', '─'.repeat(Math.min(width - 4, 24)))}${currentTheme.dimFg('border', '╯')}`, width));
      }
    }

    // Hint
    if (focused) {
      lines.push(this.pad(` ${currentTheme.dimFg('textMuted', 'j/k:nav ↵:preview r:rescan')}`, width));
    }

    return this.fillLines(lines, height, width);
  }

  onInput(event: NativeInputEvent): boolean {
    // Mouse wheel support
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        this.cursorIndex = Math.max(0, this.cursorIndex - 3);
        return true;
      }
      if (event.button === 'wheel-down') {
        this.cursorIndex = Math.min(this.images.length - 1, this.cursorIndex + 3);
        return true;
      }
      return false;
    }

    if (event.type !== 'key') return false;

    if (event.key === 'up') {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      return true;
    }
    if (event.key === 'down') {
      this.cursorIndex = Math.min(this.images.length - 1, this.cursorIndex + 1);
      return true;
    }
    if (event.key === 'enter') {
      const img = this.images[this.cursorIndex];
      if (img !== undefined) this.loadPreview(img);
      return true;
    }

    if (event.key === 'character' && event.text !== undefined) {
      const ch = event.text;
      if (ch === 'k') {
        this.cursorIndex = Math.max(0, this.cursorIndex - 1);
        return true;
      }
      if (ch === 'j') {
        this.cursorIndex = Math.min(this.images.length - 1, this.cursorIndex + 1);
        return true;
      }
      if (ch === 'r') {
        this.scanImages();
        return true;
      }
      if (ch === 'g') {
        this.cursorIndex = 0;
        this.scrollTop = 0;
        return true;
      }
      if (ch === 'G') {
        this.cursorIndex = this.images.length - 1;
        return true;
      }
    }

    return false;
  }

  dispose(): void {
    this.images = [];
    this.previewData = null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private scanImages(): void {
    this.images = [];
    this.lastScan = Date.now();
    this.scanDir(this.cwd, 0);
    // Sort by name
    this.images.sort((a, b) => a.name.localeCompare(b.name));
  }

  private scanDir(dir: string, depth: number): void {
    if (depth > MAX_SCAN_DEPTH || this.images.length >= MAX_IMAGES) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (this.images.length >= MAX_IMAGES) return;
      if (entry.startsWith('.')) continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (IGNORED_DIRS.has(entry)) continue;
        this.scanDir(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          this.images.push({
            path: fullPath,
            name: basename(entry),
            sizeBytes: stat.size,
            ext,
          });
        }
      }
    }
  }

  private loadPreview(img: ImageFileInfo): void {
    this.previewName = img.path;
    this.previewData = null;
    this.statusMessage = null;

    try {
      const data = readFileSync(img.path);
      // Store base64 for potential Kitty graphics output
      this.previewData = data.toString('base64');

      // For SVG, show text content preview
      if (img.ext === '.svg') {
        const text = data.toString('utf-8').slice(0, 200);
        this.statusMessage = text.replace(/\n/g, ' ').slice(0, 60);
      }
    } catch {
      this.statusMessage = 'read error';
    }
  }

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  private pad(text: string, width: number): string {
    const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (visibleLen >= width) return text;
    return text + ' '.repeat(width - visibleLen);
  }

  private fillLines(lines: string[], height: number, width: number): string[] {
    const result = lines.slice(0, height);
    while (result.length < height) {
      result.push(' '.repeat(width));
    }
    return result;
  }

  private dim(text: string): string {
    return currentTheme.dimFg('textDim', text);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
