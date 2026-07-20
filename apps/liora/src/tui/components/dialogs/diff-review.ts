/**
 * DiffReview — modal `/diff` working-tree review. Lists changed files with a
 * status glyph and right-aligned `+a −d` counts per row; the selected file's
 * clustered diff renders inline below its row (one file expanded at a time).
 * `v` opens the selected file in the code viewer via `onOpenFile`; Esc/Q
 * closes through `onClose`.
 *
 * Mirrors the container-replacement pattern used by FileExplorer: the host
 * mounts the panel into `editorContainer`, focuses it, and tears it down
 * through `onClose`. Selection + scrolling reuse the renderer's
 * `RendererSelectableListViewport`, the same primitive the explorer uses.
 */

import {
  Container,
  Key,
  matchesKey,
  RendererSelectableListViewport,
  renderRendererFrameRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import { renderClusteredDiffBody } from '#/tui/components/media/diff-preview';
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { printableChar } from '#/tui/utils/printable-key';
import type { GitDiffFile, GitDiffFileStatus, GitDiffReport } from '#/utils/git/git-diff';

const ELLIPSIS = '…';
const MIN_PATH_WIDTH = 8;

const STATUS_GLYPH: Record<GitDiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  binary: 'B',
};

/** Status coloring aligned with the clustered diff formatter tokens. */
const STATUS_TOKEN: Record<GitDiffFileStatus, ColorToken> = {
  added: 'diffAddedStrong',
  modified: 'primary',
  deleted: 'diffRemovedStrong',
  renamed: 'accent',
  binary: 'textMuted',
};

export interface DiffReviewOptions {
  readonly report: GitDiffReport;
  readonly filter?: string;
  readonly onClose: () => void;
  /** Open the selected file in the code viewer (`v`). Binary files never call this. */
  readonly onOpenFile?: (relativePath: string) => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

/** Keep the file tail visible when narrow: `…src/foo.ts`. */
function truncatePathLeft(path: string, maxWidth: number): string {
  if (maxWidth <= 1) return '…';
  if (visibleWidth(path) <= maxWidth) return path;
  const keep = maxWidth - 1;
  let suffix = '';
  let used = 0;
  for (const ch of Array.from(path).toReversed()) {
    const w = visibleWidth(ch);
    if (used + w > keep) break;
    suffix = ch + suffix;
    used += w;
  }
  return `…${suffix}`;
}

export class DiffReviewComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: DiffReviewOptions;
  private readonly viewport: RendererSelectableListViewport;
  /** Whether the selected file's diff body is expanded. */
  private expanded = true;

  constructor(opts: DiffReviewOptions) {
    super();
    this.opts = opts;
    this.viewport = new RendererSelectableListViewport({
      itemCount: opts.report.files.length,
      selectedIndex: 0,
    });
  }

  private selectedFile(): GitDiffFile | undefined {
    return this.opts.report.files[this.viewport.snapshot().selectedIndex];
  }

  private move(delta: number): void {
    if (this.opts.report.files.length === 0) return;
    this.viewport.moveSelection(delta);
    // Moving the selection auto-expands the newly selected file.
    this.expanded = true;
    this.invalidate();
  }

  handleInput(data: string): void {
    const k = printableChar(data);

    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.opts.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.move(1);
      return;
    }
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.right) ||
      k === ' ' ||
      k === 'l' ||
      k === 'L'
    ) {
      this.expanded = !this.expanded;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.left) || k === 'h' || k === 'H') {
      this.expanded = false;
      this.invalidate();
      return;
    }
    if (k === 'v' || k === 'V') {
      const file = this.selectedFile();
      if (file !== undefined && file.status !== 'binary') this.opts.onOpenFile?.(file.path);
    }
  }

  override render(width: number): string[] {
    const bodyHeight = Math.max(3, this.opts.maxVisible ?? 24);
    return [
      this.renderHeader(width),
      ...this.renderBody(width, bodyHeight),
      this.renderFooter(width),
    ];
  }

  private renderHeader(width: number): string {
    const t = currentTheme;
    const { branch, files, totalAdded, totalDeleted, truncated } = this.opts.report;
    const sep = t.dimFg('textMuted', '·');
    let header = t.boldFg('primary', 'Diff review');
    if (branch !== null) header += ` ${t.fg('textDim', `⎇ ${branch}`)}`;
    header +=
      ` ${sep} ${t.fg('text', `${String(files.length)} file${files.length === 1 ? '' : 's'}`)}` +
      ` ${sep} ${t.boldFg('diffAddedStrong', `+${String(totalAdded)}`)}` +
      ` ${t.boldFg('diffRemovedStrong', `−${String(totalDeleted)}`)}`;
    if (truncated) header += ` ${t.dimFg('textMuted', '(truncated)')}`;
    const filter = this.opts.filter ?? '';
    if (filter.length > 0) header += ` ${sep} ${t.fg('textDim', `filter: ${filter}`)}`;
    return fitLine(header, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('↑/↓')} ${dim('move')}  ${key('enter')} ${dim('expand/collapse')}  ` +
      `${key('v')} ${dim('view file')}  ${key('h')} ${dim('collapse')}  ${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);
    const files = this.opts.report.files;

    if (files.length === 0) {
      const filter = this.opts.filter ?? '';
      const message =
        filter.length > 0
          ? currentTheme.dimFg('textMuted', `No changes match "${filter}"`)
          : `${currentTheme.fg('success', '✓')} ${currentTheme.dimFg('textMuted', 'working tree clean')}`;
      const lines: string[] = [message];
      while (lines.length < innerHeight) lines.push('');
      return renderRendererFrameRows({
        title: ' Diff ',
        content: lines,
        width,
        height,
        borderStyle,
        titleStyle,
        ellipsis: ELLIPSIS,
      });
    }

    const diffBody = this.renderExpandedBody(innerHeight, innerWidth);
    const viewportRows = Math.max(1, innerHeight - diffBody.length);
    const window = this.viewport.project({ items: files, viewportRows });

    const lines: string[] = [];
    for (const projected of window.items) {
      lines.push(this.renderFileRow(projected.item, projected.isSelected, innerWidth));
      if (projected.isSelected) lines.push(...diffBody);
    }
    while (lines.length < innerHeight) lines.push('');

    return renderRendererFrameRows({
      title: ' Diff ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  /** Clustered diff body for the selected file (empty when collapsed). */
  private renderExpandedBody(innerHeight: number, innerWidth: number): string[] {
    if (!this.expanded) return [];
    const file = this.selectedFile();
    if (file === undefined) return [];
    if (file.status === 'binary') {
      return [currentTheme.dimFg('textMuted', '  binary file')];
    }
    if (file.lines.length === 0) return [];
    // Cap the body so the file rows stay navigable: viewport height minus one
    // row per file and a small reserve, never below 8 lines.
    const maxLines = Math.max(8, innerHeight - this.opts.report.files.length - 2);
    // Drop the formatter's own `+N -N path` header (index 0); the file row
    // above already carries the path and per-file counts.
    return renderClusteredDiffBody(file.lines, file.path, { maxLines })
      .slice(1)
      .map((line) => truncateToWidth(`  ${line}`, innerWidth, ELLIPSIS));
  }

  private renderFileRow(file: GitDiffFile, selected: boolean, innerWidth: number): string {
    const t = currentTheme;
    const pointer = selected ? `${renderSelectPointer('diff-review:pointer')} ` : '  ';
    const pointerStyled = t.fg(selected ? 'primary' : 'textDim', pointer);
    const glyph = t.boldFg(STATUS_TOKEN[file.status], STATUS_GLYPH[file.status]);

    const addedText = t.fg(
      file.added > 0 ? 'diffAddedStrong' : 'textMuted',
      `+${String(file.added)}`,
    );
    const deletedText = t.fg(
      file.deleted > 0 ? 'diffRemovedStrong' : 'textMuted',
      `−${String(file.deleted)}`,
    );
    const stats = `${addedText} ${deletedText}`;
    const statsWidth = visibleWidth(stats);

    const displayPath = file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path;
    // pointer (2) + glyph (1) + space after glyph + space before stats
    const pathBudget = Math.max(MIN_PATH_WIDTH, innerWidth - 4 - statsWidth - 1);
    const pathText = truncatePathLeft(displayPath, pathBudget);
    const path = selected ? t.boldFg('primary', pathText) : t.fg('text', pathText);

    const left = `${pointerStyled}${glyph} ${path}`;
    const gap = Math.max(1, innerWidth - visibleWidth(left) - statsWidth);
    return fitLine(`${left}${' '.repeat(gap)}${stats}`, innerWidth);
  }
}
