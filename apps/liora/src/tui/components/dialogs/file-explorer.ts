/**
 * FileExplorer — modal `/files` project file tree. Lists the workspace
 * (git-aware) as an expandable tree; navigating to a file and pressing
 * Enter/Space/L inserts its relative path into the editor via `onPick`.
 * Pressing `v` on a file opens a read-only preview via `onPreview`
 * (directories toggle, same as Enter).
 *
 * Mirrors the container-replacement pattern used by HelpPanel / TasksBrowser:
 * the host mounts the panel into `editorContainer`, focuses it, and tears it
 * down through `onClose` (Esc / Q). Selection + scrolling reuse the renderer's
 * `RendererSelectableListViewport`, the same primitive the tasks browser uses.
 */

import { basename } from 'node:path';

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
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { printableChar } from '#/tui/utils/printable-key';
import {
  flattenVisibleTree,
  type FileTreeNode,
  type FlatTreeRow,
} from '#/utils/fs/file-tree';

const ELLIPSIS = '…';

export interface FileExplorerOptions {
  readonly workDir: string;
  readonly nodes: readonly FileTreeNode[];
  readonly truncated: boolean;
  readonly source: 'git' | 'walk';
  readonly onPick: (relativePath: string) => void;
  /** Open a read-only preview of a file (`v`). Directories toggle instead. */
  readonly onPreview?: (relativePath: string) => void;
  readonly onClose: () => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

function countFiles(nodes: readonly FileTreeNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === 'file') total += 1;
    else if (node.children) total += countFiles(node.children);
  }
  return total;
}

function parentPath(path: string): string | null {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? null : path.slice(0, idx);
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

export class FileExplorerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: FileExplorerOptions;
  private readonly totalFiles: number;
  private readonly expanded = new Set<string>();
  private readonly viewport: RendererSelectableListViewport;
  private rows: FlatTreeRow[];

  constructor(opts: FileExplorerOptions) {
    super();
    this.opts = opts;
    this.totalFiles = countFiles(opts.nodes);
    this.rows = this.computeRows();
    this.viewport = new RendererSelectableListViewport({
      itemCount: this.rows.length,
      selectedIndex: 0,
    });
  }

  private computeRows(): FlatTreeRow[] {
    return flattenVisibleTree(this.opts.nodes, (path) => this.expanded.has(path));
  }

  private recompute(): void {
    this.rows = this.computeRows();
    this.viewport.update({ itemCount: this.rows.length });
  }

  private selectedRow(): FlatTreeRow | undefined {
    return this.rows[this.viewport.snapshot().selectedIndex];
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.viewport.moveSelection(delta);
    this.invalidate();
  }

  private activate(): void {
    const row = this.selectedRow();
    if (row === undefined) return;
    if (row.node.kind === 'directory') {
      if (this.expanded.has(row.node.path)) this.expanded.delete(row.node.path);
      else this.expanded.add(row.node.path);
      this.recompute();
      this.invalidate();
      return;
    }
    this.opts.onPick(row.node.path);
    this.opts.onClose();
  }

  private previewOrToggle(): void {
    const row = this.selectedRow();
    if (row === undefined) return;
    if (row.node.kind === 'directory') {
      this.activate();
      return;
    }
    this.opts.onPreview?.(row.node.path);
  }

  private collapseOrParent(): void {
    const row = this.selectedRow();
    if (row === undefined) return;
    if (row.node.kind === 'directory' && this.expanded.has(row.node.path)) {
      this.expanded.delete(row.node.path);
      this.recompute();
      this.invalidate();
      return;
    }
    const parent = parentPath(row.node.path);
    if (parent === null) return;
    const idx = this.rows.findIndex((r) => r.node.path === parent);
    if (idx === -1) return;
    this.viewport.select(idx);
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
      this.activate();
      return;
    }
    if (k === 'v' || k === 'V') {
      this.previewOrToggle();
      return;
    }
    if (matchesKey(data, Key.left) || k === 'h' || k === 'H') {
      this.collapseOrParent();
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
    const title = currentTheme.boldFg('primary', ` Files — ${basename(this.opts.workDir)} `);
    const truncatedTag = this.opts.truncated ? ' (truncated)' : '';
    const count = currentTheme.fg(
      'textMuted',
      ` ${this.totalFiles.toLocaleString('en-US')} files${truncatedTag} `,
    );
    const source = currentTheme.fg('textDim', ` ${this.opts.source === 'git' ? 'git' : 'fs walk'} `);
    return fitLine(title + count + source, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('↑/↓')} ${dim('move')}  ${key('enter')} ${dim('open/toggle')}  ` +
      `${key('v')} ${dim('view')}  ${key('h')} ${dim('collapse')}  ${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);

    if (this.rows.length === 0) {
      const empty = currentTheme.fg('textMuted', 'No files found');
      const lines: string[] = [empty];
      while (lines.length < innerHeight) lines.push('');
      return renderRendererFrameRows({
        title: ' Files ',
        content: lines,
        width,
        height,
        borderStyle,
        titleStyle,
        ellipsis: ELLIPSIS,
      });
    }

    const window = this.viewport.project({ items: this.rows, viewportRows: innerHeight });
    const lines: string[] = window.items.map((projected) =>
      this.renderRow(projected.item, projected.isSelected, innerWidth),
    );
    while (lines.length < innerHeight) lines.push('');

    return renderRendererFrameRows({
      title: ' Files ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderRow(row: FlatTreeRow, selected: boolean, innerWidth: number): string {
    const pointer = selected ? `${renderSelectPointer('files:pointer')} ` : '  ';
    const pointerStyled = currentTheme.fg(selected ? 'primary' : 'textDim', pointer);
    const indent = '  '.repeat(row.depth);

    const isDir = row.node.kind === 'directory';
    const glyph = isDir ? (this.expanded.has(row.node.path) ? '▾ ' : '▸ ') : '· ';
    const glyphStyled = currentTheme.fg(selected ? 'primary' : 'textMuted', glyph);

    const name = selected
      ? currentTheme.boldFg('primary', row.node.name)
      : isDir
        ? currentTheme.boldFg('textStrong', row.node.name)
        : currentTheme.fg('text', row.node.name);

    return fitLine(pointerStyled + indent + glyphStyled + name, innerWidth);
  }
}
