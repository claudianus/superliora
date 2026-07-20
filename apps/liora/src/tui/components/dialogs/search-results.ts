/**
 * SearchResults — modal `/search` project content results. Matches are
 * grouped under dim file header rows; navigation (j/k/arrows) moves across
 * match rows only and skips the headers. Enter/L opens the selected match
 * in the code viewer via `onOpenMatch`; Esc/Q closes through `onClose`.
 *
 * Mirrors the container-replacement pattern used by FileExplorer /
 * DiffReview: the host mounts the panel into `editorContainer`, focuses it,
 * and tears it down through `onClose`. Selection + scrolling reuse the
 * renderer's `RendererSelectableListViewport`.
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
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { printableChar } from '#/tui/utils/printable-key';
import type { SearchMatch, SearchResults } from '#/utils/fs/project-search';

const ELLIPSIS = '…';

export interface SearchResultsOptions {
  readonly results: SearchResults;
  readonly onClose: () => void;
  /** Open the selected match in the code viewer (Enter/L). */
  readonly onOpenMatch?: (match: SearchMatch) => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

type SearchRow =
  | { readonly kind: 'file'; readonly path: string; readonly count: number }
  | { readonly kind: 'match'; readonly match: SearchMatch };

/** Group matches under per-file header rows, preserving first-seen order. */
function buildRows(results: SearchResults): SearchRow[] {
  const rows: SearchRow[] = [];
  const counts = new Map<string, number>();
  for (const match of results.matches) {
    counts.set(match.path, (counts.get(match.path) ?? 0) + 1);
  }
  let lastPath: string | undefined;
  for (const match of results.matches) {
    if (match.path !== lastPath) {
      rows.push({ kind: 'file', path: match.path, count: counts.get(match.path) ?? 1 });
      lastPath = match.path;
    }
    rows.push({ kind: 'match', match });
  }
  return rows;
}

function firstMatchIndex(rows: readonly SearchRow[]): number {
  const index = rows.findIndex((row) => row.kind === 'match');
  return index === -1 ? 0 : index;
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

export class SearchResultsComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: SearchResultsOptions;
  private readonly rows: SearchRow[];
  private readonly gutterWidth: number;
  private readonly viewport: RendererSelectableListViewport;

  constructor(opts: SearchResultsOptions) {
    super();
    this.opts = opts;
    this.rows = buildRows(opts.results);
    this.gutterWidth = Math.max(
      1,
      ...opts.results.matches.map((match) => String(match.line).length),
    );
    this.viewport = new RendererSelectableListViewport({
      itemCount: this.rows.length,
      selectedIndex: firstMatchIndex(this.rows),
    });
  }

  private selectedMatch(): SearchMatch | undefined {
    const row = this.rows[this.viewport.snapshot().selectedIndex];
    return row !== undefined && row.kind === 'match' ? row.match : undefined;
  }

  /** Move the selection by one match row in `delta` direction, skipping file headers. */
  private move(delta: number): void {
    if (this.rows.length === 0) return;
    const current = this.viewport.snapshot().selectedIndex;
    let index = current;
    let next = current + delta;
    while (next >= 0 && next < this.rows.length) {
      if (this.rows[next]?.kind === 'match') {
        index = next;
        break;
      }
      next += delta;
    }
    if (index === current) return;
    this.viewport.select(index);
    this.invalidate();
  }

  private activate(): void {
    const match = this.selectedMatch();
    if (match === undefined) return;
    this.opts.onOpenMatch?.(match);
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
    const { pattern, matches, fileCount, truncated, engine } = this.opts.results;
    const sep = t.dimFg('textMuted', '·');
    let header =
      t.boldFg('primary', 'Search') +
      ` ${t.fg('text', `"${pattern}"`)}` +
      ` ${sep} ${t.fg('textMuted', `${String(matches.length)} match${matches.length === 1 ? '' : 'es'} in ${String(fileCount)} file${fileCount === 1 ? '' : 's'}`)}` +
      ` ${sep} ${t.fg('textDim', engine)}`;
    if (truncated) header += ` ${t.dimFg('textMuted', '(truncated)')}`;
    return fitLine(header, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('j/k')} ${dim('move')}  ${key('enter')} ${dim('open')}  ${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);
    const { matches, pattern } = this.opts.results;

    if (matches.length === 0) {
      const empty = currentTheme.fg('textMuted', `No matches for "${pattern}"`);
      const lines: string[] = [empty];
      while (lines.length < innerHeight) lines.push('');
      return renderRendererFrameRows({
        title: ' Search ',
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
      title: ' Search ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderRow(row: SearchRow, selected: boolean, innerWidth: number): string {
    const t = currentTheme;
    if (row.kind === 'file') {
      const header = t.fg('textMuted', `  ${row.path} (${String(row.count)})`);
      return fitLine(header, innerWidth);
    }
    const pointer = selected ? `${renderSelectPointer('search:pointer')} ` : '  ';
    const pointerStyled = t.fg(selected ? 'primary' : 'textDim', pointer);
    const lineNum = t.fg('textMuted', String(row.match.line).padStart(this.gutterWidth, ' '));
    const text = selected
      ? t.boldFg('primary', row.match.text)
      : t.fg('text', row.match.text);
    return fitLine(`${pointerStyled}${lineNum}${t.fg('textDim', ':')} ${text}`, innerWidth);
  }
}
