/**
 * FileViewer — modal read-only code viewer opened from the `/files`
 * explorer (`v` on a file). Renders syntax-highlighted content with a
 * line-number gutter; scroll-only by design (no editing, no search).
 *
 * Mirrors the container-replacement pattern used by FileExplorer /
 * HelpPanel: the host mounts the panel into `editorContainer`, focuses
 * it, and tears it down through `onClose` (Esc / Q).
 */

import { basename } from 'node:path';

import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import {
  Container,
  Key,
  matchesKey,
  renderRendererFrameRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme, type ColorPalette } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';

const ELLIPSIS = '…';

export interface FileViewerOptions {
  readonly relativePath: string;
  readonly content: string;
  readonly bytes: number;
  readonly palette?: ColorPalette;
  readonly onClose: () => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

export class FileViewerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: FileViewerOptions;
  private readonly lang: string | undefined;
  /** Highlighted body lines (ANSI-styled; clipped by the frame, not here). */
  private readonly lines: string[];
  private readonly gutterWidth: number;
  private topLine = 0;

  constructor(opts: FileViewerOptions) {
    super();
    this.opts = opts;
    this.lang = langFromPath(opts.relativePath);
    this.lines = highlightLines(opts.content, this.lang, opts.palette);
    this.gutterWidth = Math.max(1, String(this.lines.length).length);
  }

  private bodyHeight(): number {
    return Math.max(3, this.opts.maxVisible ?? 24);
  }

  private innerHeight(): number {
    return Math.max(1, this.bodyHeight() - 2);
  }

  private maxTopLine(): number {
    return Math.max(0, this.lines.length - this.innerHeight());
  }

  private scrollTo(top: number): void {
    const clamped = Math.max(0, Math.min(top, this.maxTopLine()));
    if (clamped === this.topLine) return;
    this.topLine = clamped;
    this.invalidate();
  }

  handleInput(data: string): void {
    const k = printableChar(data);

    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.opts.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.scrollTo(this.topLine - 1);
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.scrollTo(this.topLine + 1);
      return;
    }
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl('u'))) {
      this.scrollTo(this.topLine - this.innerHeight());
      return;
    }
    if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl('d'))) {
      this.scrollTo(this.topLine + this.innerHeight());
      return;
    }
    if (matchesKey(data, Key.home) || k === 'g') {
      this.scrollTo(0);
      return;
    }
    if (matchesKey(data, Key.end) || k === 'G') {
      this.scrollTo(this.maxTopLine());
    }
  }

  override render(width: number): string[] {
    return [this.renderHeader(width), ...this.renderBody(width), this.renderFooter(width)];
  }

  private renderHeader(width: number): string {
    const name = basename(this.opts.relativePath);
    const left =
      currentTheme.boldFg('primary', ` ${name} `) +
      (name === this.opts.relativePath
        ? ''
        : currentTheme.fg('textMuted', `${this.opts.relativePath} `));
    const langLabel = this.lang ?? 'text';
    const meta = currentTheme.fg(
      'textDim',
      `${langLabel} · ${this.lines.length.toLocaleString('en-US')} lines · ${formatBytes(this.opts.bytes)} `,
    );
    const leftWidth = visibleWidth(left);
    const metaWidth = visibleWidth(meta);
    if (leftWidth + metaWidth <= width) {
      return left + ' '.repeat(width - leftWidth - metaWidth) + meta;
    }
    return fitLine(left + meta, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('↑/↓')} ${dim('scroll')}  ${key('pgup/pgdn')} ${dim('page')}  ` +
      `${key('g/G')} ${dim('top/bottom')}  ${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number): string[] {
    const height = this.bodyHeight();
    const innerHeight = Math.max(0, height - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);

    const lines: string[] = [];
    for (let row = 0; row < innerHeight; row += 1) {
      const index = this.topLine + row;
      lines.push(index < this.lines.length ? this.renderLine(index) : '');
    }

    return renderRendererFrameRows({
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderLine(index: number): string {
    const number = currentTheme.fg(
      'textMuted',
      String(index + 1).padStart(this.gutterWidth, ' '),
    );
    const separator = currentTheme.fg('textDim', ' │ ');
    return number + separator + (this.lines[index] ?? '');
  }
}
