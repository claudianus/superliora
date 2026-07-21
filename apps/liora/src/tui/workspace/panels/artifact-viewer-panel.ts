import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
  renderParticleDivider,
} from '#/tui/utils/appearance-effects';

// ---------------------------------------------------------------------------
// ArtifactViewerPanel
// ---------------------------------------------------------------------------

/**
 * Displays markdown documents, plan files, and other text artifacts.
 * Supports scrolling through long documents with basic markdown rendering.
 */
export class ArtifactViewerPanel implements PanelDefinition {
  readonly id = 'artifact-viewer';
  readonly title = 'Artifact';
  readonly icon = '📄';
  readonly minWidth = 30;
  readonly minHeight = 8;

  private content: string[] = [];
  private renderedLines: string[] = [];
  private scrollTop = 0;
  private currentFile: string | null = null;
  private readonly watchDir: string;
  private showToc = false;

  constructor(watchDir: string) {
    this.watchDir = watchDir;
    this.scanForArtifacts();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean, searchQuery?: string): string[] {
    if (this.renderedLines.length === 0) {
      return [
        `  ${currentTheme.dimFg('textMuted', 'No artifact loaded')}`,
        `  ${currentTheme.dimFg('textMuted', 'Watching:')} ${currentTheme.fg('accent', path.basename(this.watchDir))}`,
        '',
        `  ${currentTheme.dimFg('textMuted', '[n] next artifact')}`,
        `  ${currentTheme.dimFg('textMuted', '[r] rescan')}`,
      ];
    }

    // TOC mode: show extracted headings as a navigable list
    if (this.showToc) {
      return this.renderToc(width, height);
    }

    const lines: string[] = [];

    // Header with file info and word count (visible when focused)
    if (focused && this.currentFile !== null) {
      const fileName = path.basename(this.currentFile);
      const wordCount = this.content.join(' ').split(/\s+/).filter(Boolean).length;
      const lineCount = this.content.length;
      const header = `${currentTheme.boldFg('textStrong', fileName)} ${currentTheme.dimFg('textMuted', `${String(wordCount)}w · ${String(lineCount)}L`)}`;
      lines.push(header);
    }

    // Clamp scroll
    const headerRows = focused && this.currentFile !== null ? 1 : 0;
    const maxScroll = Math.max(0, this.renderedLines.length - height + headerRows);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    const visible = this.renderedLines.slice(this.scrollTop, this.scrollTop + height - headerRows);
    const contentLines = visible.map((line) => {
      let truncated = (line ?? '').slice(0, width);
      // Highlight search matches
      if (searchQuery && searchQuery.length > 0) {
        truncated = this.highlightSearch(truncated, searchQuery);
      }
      return truncated;
    });
    // Add line numbers when focused
    if (focused) {
      const gutterWidth = String(this.scrollTop + visible.length).length + 1;
      for (let i = 0; i < contentLines.length; i++) {
        const lineNum = this.scrollTop + i + 1;
        const gutter = currentTheme.dimFg('border', String(lineNum).padStart(gutterWidth - 1) + ' ');
        contentLines[i] = `${gutter}${contentLines[i] ?? ''}`;
      }
    }
    lines.push(...contentLines);

    // Scroll indicator
    if (this.renderedLines.length > height) {
      const pct = Math.round((this.scrollTop / maxScroll) * 100);
      // Scroll progress bar
      const BAR_W = Math.min(20, width - 10);
      const filled = Math.round((pct / 100) * BAR_W);
      const bar = currentTheme.fg('accent', '━'.repeat(filled)) + currentTheme.dimFg('border', '┄'.repeat(BAR_W - filled));
      const footer = ` ${bar} ${currentTheme.fg('accent', `${String(pct)}%`)}`;
      if (lines.length > 0) {
        lines[lines.length - 1] = footer;
      }
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
        this.scrollTop = Math.max(0, this.scrollTop - 3);
        return true;
      }
      if (event.button === 'wheel-down') {
        this.scrollTop += 3;
        return true;
      }
      return false;
    }

    if (event.type !== 'key') return false;

    switch (event.key) {
      case 'up':
        this.scrollTop = Math.max(0, this.scrollTop - 1);
        return true;
      case 'down':
        this.scrollTop++;
        return true;
      case 'pageup':
        this.scrollTop = Math.max(0, this.scrollTop - 10);
        return true;
      case 'pagedown':
        this.scrollTop += 10;
        return true;
      case 'character':
        if (event.text === 'r' || event.text === 'R') {
          this.scanForArtifacts();
          return true;
        }
        if (event.text === 'n' || event.text === 'N') {
          this.nextArtifact();
          return true;
        }
        if (event.text === 'g') {
          this.scrollTop = 0;
          return true;
        }
        if (event.text === 'G') {
          this.scrollTop = this.renderedLines.length;
          return true;
        }
        // Heading navigation: jump between markdown headings
        if (event.text === 'h' || event.text === 'H') {
          this.jumpToPrevHeading();
          return true;
        }
        if (event.text === 'l' || event.text === 'L') {
          this.jumpToNextHeading();
          return true;
        }
        // TOC toggle
        if (event.text === 't' || event.text === 'T') {
          this.showToc = !this.showToc;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  dispose(): void {
    this.content = [];
    this.renderedLines = [];
  }

  /** Jump to the next heading in the rendered lines. */
  /** Render a table of contents extracted from markdown headings. */
  private renderToc(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push(currentTheme.boldFg('primary', ' Table of Contents'));
    lines.push(currentTheme.dimFg('border', '─'.repeat(Math.min(width - 2, 30))));

    let headingCount = 0;
    for (let i = 0; i < this.content.length; i++) {
      const line = this.content[i] ?? '';
      if (line.startsWith('# ')) {
        lines.push(` ${currentTheme.boldFg('textStrong', line.slice(2))}`);
        headingCount++;
      } else if (line.startsWith('## ')) {
        lines.push(`   ${currentTheme.fg('accent', line.slice(3))}`);
        headingCount++;
      } else if (line.startsWith('### ')) {
        lines.push(`     ${currentTheme.dimFg('textDim', line.slice(4))}`);
        headingCount++;
      }
      if (lines.length >= height - 2) break;
    }

    if (headingCount === 0) {
      lines.push(`  ${currentTheme.dimFg('textMuted', '(no headings found)')}`);
    }

    lines.push('');
    lines.push(currentTheme.dimFg('textMuted', ' [t] close TOC  [h/l] heading nav'));
    return lines.slice(0, height);
  }

  private jumpToNextHeading(): void {
    for (let i = this.scrollTop + 1; i < this.renderedLines.length; i++) {
      const line = this.renderedLines[i] ?? '';
      // Detect headings by checking for bold/primary styled text (h1/h2 markers)
      if (line.includes('▎') || line.includes('─'.repeat(3))) {
        this.scrollTop = Math.max(0, i - 1);
        return;
      }
    }
    // Wrap around
    for (let i = 0; i <= this.scrollTop; i++) {
      const line = this.renderedLines[i] ?? '';
      if (line.includes('▎') || line.includes('─'.repeat(3))) {
        this.scrollTop = Math.max(0, i - 1);
        return;
      }
    }
  }

  /** Jump to the previous heading in the rendered lines. */
  private jumpToPrevHeading(): void {
    for (let i = this.scrollTop - 1; i >= 0; i--) {
      const line = this.renderedLines[i] ?? '';
      if (line.includes('▎') || line.includes('─'.repeat(3))) {
        this.scrollTop = Math.max(0, i - 1);
        return;
      }
    }
    // Wrap around
    for (let i = this.renderedLines.length - 1; i >= this.scrollTop; i--) {
      const line = this.renderedLines[i] ?? '';
      if (line.includes('▎') || line.includes('─'.repeat(3))) {
        this.scrollTop = Math.max(0, i - 1);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Artifact management
  // -------------------------------------------------------------------------

  /** Load a specific file into the viewer. */
  loadFile(filePath: string): void {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      this.currentFile = filePath;
      this.content = raw.split('\n');
      this.renderedLines = this.renderMarkdown(this.content);
      this.scrollTop = 0;
    } catch {
      this.renderedLines = [dim(`  Cannot read: ${filePath}`)];
    }
  }

  private artifacts: string[] = [];
  private artifactIndex = 0;

  private scanForArtifacts(): void {
    this.artifacts = [];
    this.findArtifacts(this.watchDir, 0);

    if (this.artifacts.length > 0) {
      this.loadFile(this.artifacts[this.artifactIndex]!);
    } else {
      this.renderedLines = [];
    }
  }

  private findArtifacts(dir: string, depth: number): void {
    if (depth > 3) return;
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.')) continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (item.name === 'node_modules' || item.name === 'dist') continue;
          this.findArtifacts(fullPath, depth + 1);
        } else if (this.isArtifact(item.name)) {
          this.artifacts.push(fullPath);
        }
      }
    } catch {
      // Permission denied or similar
    }
  }

  private isArtifact(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.endsWith('.md') ||
      lower.includes('plan') ||
      lower.includes('spec') ||
      lower.includes('research') ||
      lower.includes('report')
    );
  }

  private nextArtifact(): void {
    if (this.artifacts.length === 0) return;
    this.artifactIndex = (this.artifactIndex + 1) % this.artifacts.length;
    this.loadFile(this.artifacts[this.artifactIndex]!);
  }

  // -------------------------------------------------------------------------
  // Markdown rendering (basic)
  // -------------------------------------------------------------------------

  private renderMarkdown(lines: string[]): string[] {
    const rendered: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) {
          const lang = line.slice(3).trim();
          const langLabel = lang.length > 0 ? ` ${lang} ` : ' code ';
          rendered.push(currentTheme.dimFg('border', '┌─') + currentTheme.fg('accent', langLabel) + currentTheme.dimFg('border', '─'));
        } else {
          rendered.push(currentTheme.dimFg('border', '└─────────'));
        }
        continue;
      }
      if (inCodeBlock) {
        rendered.push(currentTheme.fg('accent', `│ ${line}`));
        continue;
      }
      if (line.startsWith('# ')) {
        const heading = currentTheme.boldFg('primary', line.slice(2));
        rendered.push(heading);
        rendered.push(animate
          ? renderParticleDivider(Math.min(40, line.length + 4), 'artifact:h1', appearance)
          : currentTheme.dimFg('border', '─'.repeat(Math.min(40, line.length + 4))));
      } else if (line.startsWith('## ')) {
        rendered.push(currentTheme.boldFg('textStrong', `▎${line.slice(3)}`));
      } else if (line.startsWith('### ')) {
        rendered.push(currentTheme.fg('accent', `  ${line.slice(4)}`));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        rendered.push(`  ${currentTheme.fg('primary', '•')} ${currentTheme.fg('text', line.slice(2))}`);
      } else if (line.match(/^\d+\. /)) {
        const match = line.match(/^(\d+)\. (.*)/);
        if (match) {
          rendered.push(`  ${currentTheme.fg('accent', `${match[1]}.`)} ${currentTheme.fg('text', match[2] ?? '')}`);
        } else {
          rendered.push(currentTheme.fg('text', line));
        }
      } else if (line.startsWith('> ')) {
        rendered.push(`${currentTheme.fg('primary', '│')} ${currentTheme.dimFg('textDim', line.slice(2))}`);
      } else if (line.trim() === '') {
        rendered.push('');
      } else if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
        // Horizontal rule
        rendered.push(currentTheme.dimFg('border', '─'.repeat(Math.min(40, 40))));
      } else if (line.match(/^!\[.*\]\(.*\)/)) {
        // Markdown image: ![alt](url) — render as placeholder
        const altMatch = line.match(/^!\[(.*?)\]/);
        const alt = altMatch?.[1] ?? 'image';
        rendered.push(`  ${currentTheme.fg('accent', '🖼')} ${currentTheme.dimFg('textMuted', `[${alt}]`)}`);
      } else if (line.startsWith('**') && line.endsWith('**')) {
        rendered.push(currentTheme.boldFg('textStrong', line.slice(2, -2)));
      } else {
        rendered.push(this.renderInlineFormatting(line));
      }
    }

    return rendered;
  }

  /** Render inline markdown formatting: **bold**, *italic*, `code`. */
  private renderInlineFormatting(text: string): string {
    // Simple inline formatting: handle **bold**, *italic*, `code`
    let result = text;
    // Replace **bold** with themed bold
    result = result.replace(/\*\*(.+?)\*\*/g, (_m, p1: string) => currentTheme.boldFg('textStrong', p1));
    // Replace *italic* with themed italic (using dim as approximation)
    result = result.replace(/\*(.+?)\*/g, (_m, p1: string) => currentTheme.fg('accent', p1));
    // Replace `code` with themed inline code
    result = result.replace(/`(.+?)`/g, (_m, p1: string) => currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ${p1} `)));
    // Replace [text](url) with themed link
    result = result.replace(/\[(.+?)\]\((.+?)\)/g, (_m, p1: string, p2: string) => `${currentTheme.fg('primary', p1)}${currentTheme.dimFg('textMuted', ` (${p2})`)}`);
    // If no formatting was applied, wrap in default text color
    if (result === text) {
      return currentTheme.fg('text', text);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function dim(text: string): string { return currentTheme.dimFg('textDim', text); }
function bold(text: string): string { return currentTheme.boldFg('textStrong', text); }
function underline(text: string): string { return currentTheme.underlineFg('primary', text); }
