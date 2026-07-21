import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';

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

  constructor(watchDir: string) {
    this.watchDir = watchDir;
    this.scanForArtifacts();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    if (this.renderedLines.length === 0) {
      return [
        dim('  No artifact loaded'),
        dim('  Watching: ' + path.basename(this.watchDir)),
        dim(''),
        dim('  [n] next artifact'),
        dim('  [r] rescan'),
      ];
    }

    // Clamp scroll
    const maxScroll = Math.max(0, this.renderedLines.length - height);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    const visible = this.renderedLines.slice(this.scrollTop, this.scrollTop + height);
    const lines = visible.map((line) => (line ?? '').slice(0, width));

    // Scroll indicator
    if (this.renderedLines.length > height) {
      const pct = Math.round((this.scrollTop / maxScroll) * 100);
      const footer = dim(` ── ${pct}% ──`);
      if (lines.length > 0) {
        lines[lines.length - 1] = footer;
      }
    }

    return lines;
  }

  onInput(event: NativeInputEvent): boolean {
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
        return false;
      default:
        return false;
    }
  }

  dispose(): void {
    this.content = [];
    this.renderedLines = [];
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

    for (const line of lines) {
      if (line.startsWith('# ')) {
        rendered.push(bold(line.slice(2)));
        rendered.push(dim('─'.repeat(Math.min(40, line.length))));
      } else if (line.startsWith('## ')) {
        rendered.push(bold(line.slice(3)));
      } else if (line.startsWith('### ')) {
        rendered.push(underline(line.slice(4)));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        rendered.push(`  • ${line.slice(2)}`);
      } else if (line.startsWith('```')) {
        rendered.push(dim(line));
      } else if (line.startsWith('> ')) {
        rendered.push(dim(`│ ${line.slice(2)}`));
      } else if (line.trim() === '') {
        rendered.push('');
      } else {
        rendered.push(line);
      }
    }

    return rendered;
  }
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function dim(text: string): string { return `\x1b[2m${text}\x1b[0m`; }
function bold(text: string): string { return `\x1b[1m${text}\x1b[0m`; }
function underline(text: string): string { return `\x1b[4m${text}\x1b[0m`; }
