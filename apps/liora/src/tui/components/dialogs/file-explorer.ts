/**
 * FileExplorer — modal `/files` project file tree. Lists the workspace
 * (git-aware) as an expandable tree; navigating to a file and pressing
 * Enter/Space/L inserts its relative path into the editor via `onPick`.
 * Pressing `v` on a file opens a read-only preview via `onPreview`
 * (directories toggle, same as Enter). Pressing `/` or `f` starts a
 * type-to-filter search over all paths; Esc clears the filter first and
 * closes on a second press.
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
import { printableChar, isPrintableChar } from '#/tui/utils/printable-key';
import {
  filterFileTree,
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
  private filterActive = false;
  private filterQuery = '';
  /** Matching file count for the active filter (total files when unfiltered). */
  private matchCount = 0;

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
    if (this.filterQuery.length === 0) {
      this.matchCount = this.totalFiles;
      return flattenVisibleTree(this.opts.nodes, (path) => this.expanded.has(path));
    }
    // While filtering, every directory is treated as expanded so matches stay
    // visible without touching the user's manual expansion state.
    const filtered = filterFileTree(this.opts.nodes, this.filterQuery);
    this.matchCount = filtered.matchCount;
    return flattenVisibleTree(filtered.nodes, () => true);
  }

  private recompute(): void {
    this.rows = this.computeRows();
    this.viewport.update({ itemCount: this.rows.length });
  }

  private setFilterQuery(query: string): void {
    this.filterQuery = query;
    this.recompute();
    this.viewport.select(0);
    this.invalidate();
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
    if (this.filterActive) {
      this.handleFilterInput(data);
      return;
    }
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
    if (k === '/' || k === 'f' || k === 'F') {
      this.filterActive = true;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.left) || k === 'h' || k === 'H') {
      this.collapseOrParent();
    }
  }

  /**
   * Keys while the filter line is active. Mirrors the SearchableList
   * convention used by the search dialogs: every printable character goes
   * into the query (so `j`/`k` type, not move); navigation is arrows only.
   */
  private handleFilterInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      // One step: clear the query and leave filter mode. A second Esc
      // (now in normal mode) closes the explorer.
      this.filterActive = false;
      this.setFilterQuery('');
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const row = this.selectedRow();
      if (row === undefined) return;
      if (row.node.kind === 'file') {
        this.opts.onPick(row.node.path);
        this.opts.onClose();
        return;
      }
      // Directory: stop editing but keep the active filter for browsing.
      this.filterActive = false;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.move(1);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.filterQuery.length > 0) this.setFilterQuery(this.filterQuery.slice(0, -1));
      return;
    }
    const ch = printableChar(data);
    if (isPrintableChar(ch)) {
      this.setFilterQuery(this.filterQuery + ch);
    }
  }

  override render(width: number): string[] {
    const bodyHeight = Math.max(3, this.opts.maxVisible ?? 24);
    const lines = [this.renderHeader(width), ...this.renderBody(width, bodyHeight)];
    if (this.filterActive) {
      const label = currentTheme.boldFg('primary', ' Filter ');
      const cursor = currentTheme.fg('textDim', '▏');
      lines.push(fitLine(label + currentTheme.fg('text', this.filterQuery) + cursor, width));
    } else if (this.filterQuery.length > 0) {
      lines.push(fitLine(currentTheme.fg('textMuted', ` Filter: ${this.filterQuery}`), width));
    }
    lines.push(this.renderFooter(width));
    return lines;
  }

  private renderHeader(width: number): string {
    const title = currentTheme.boldFg('primary', ` Files — ${basename(this.opts.workDir)} `);
    const truncatedTag = this.opts.truncated ? ' (truncated)' : '';
    const count = currentTheme.fg(
      'textMuted',
      ` ${this.totalFiles.toLocaleString('en-US')} files${truncatedTag} `,
    );
    const source = currentTheme.fg('textDim', ` ${this.opts.source === 'git' ? 'git' : 'fs walk'} `);
    const filterTag =
      this.filterQuery.length > 0
        ? currentTheme.fg(
            'textDim',
            this.matchCount > 0
              ? ` · ${this.matchCount.toLocaleString('en-US')} matches `
              : ' · no matches ',
          )
        : '';
    return fitLine(title + count + source + filterTag, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    if (this.filterActive) {
      const line =
        ` ${dim('type to filter')}  ${key('⏎')} ${dim('open')}  ${key('esc')} ${dim('clear')} `;
      return fitLine(line, width);
    }
    const filterHint =
      this.filterQuery.length > 0 ? ` ${key('f')} ${dim('edit filter')} ` : '';
    const line =
      ` ${key('↑/↓')} ${dim('move')}  ${key('enter')} ${dim('open/toggle')}  ` +
      `${key('v')} ${dim('view')}  ${key('h')} ${dim('collapse')}  ${key('esc')} ${dim('close')}${filterHint} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);

    if (this.rows.length === 0) {
      const message = this.filterQuery.length > 0 ? 'No matches' : 'No files found';
      const empty = currentTheme.fg('textMuted', message);
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
    const dirExpanded = this.filterQuery.length > 0 || this.expanded.has(row.node.path);
    const glyph = isDir ? (dirExpanded ? '▾ ' : '▸ ') : '· ';
    const glyphStyled = currentTheme.fg(selected ? 'primary' : 'textMuted', glyph);

    const name = selected
      ? currentTheme.boldFg('primary', row.node.name)
      : isDir
        ? currentTheme.boldFg('textStrong', row.node.name)
        : currentTheme.fg('text', row.node.name);

    return fitLine(pointerStyled + indent + glyphStyled + name, innerWidth);
  }
}
