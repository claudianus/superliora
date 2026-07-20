/**
 * BlamePanel — modal `/blame` viewer. Renders per-line git attribution as
 * `<hash> <author> <date> │ <content>` rows; uncommitted lines (all-zero
 * SHA) get a warning-colored gutter. Selection + scrolling reuse the
 * renderer's `RendererSelectableListViewport`, the same primitive the
 * sibling panels (CommitBrowser, DiffReview) use; paging/edge keys mirror
 * FileViewer. Esc/Q closes through `onClose`.
 *
 * Mirrors the container-replacement pattern used by the sibling dialogs:
 * the host mounts the panel into `editorContainer`, focuses it, and tears
 * it down through `onClose`.
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
import { currentTheme, type ColorPalette } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { isUncommittedBlameHash, type BlameLine } from '#/utils/git/git-blame';

const ELLIPSIS = '…';
const HASH_WIDTH = 7;
const AUTHOR_WIDTH = 12;
const DATE_WIDTH = 10;

/** Format unix seconds as `YYYY-MM-DD` (UTC, fixed width); 0/invalid → `—`. */
function formatBlameDate(authorTime: number): string {
  const unknown = '—'.padEnd(DATE_WIDTH, ' ');
  if (authorTime <= 0) return unknown;
  const date = new Date(authorTime * 1000);
  if (!Number.isFinite(date.getTime())) return unknown;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(date.getUTCFullYear())}-${month}-${day}`;
}

/** Fit `author` into exactly AUTHOR_WIDTH columns (truncate with …, pad). */
function fitAuthor(author: string): string {
  const truncated =
    visibleWidth(author) > AUTHOR_WIDTH ? truncateToWidth(author, AUTHOR_WIDTH, ELLIPSIS) : author;
  const width = visibleWidth(truncated);
  return width < AUTHOR_WIDTH ? truncated + ' '.repeat(AUTHOR_WIDTH - width) : truncated;
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

export interface BlamePanelOptions {
  readonly lines: readonly BlameLine[];
  /** File path (or label) shown in the header. */
  readonly title?: string;
  readonly palette?: ColorPalette;
  readonly onClose: () => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

export class BlamePanelComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: BlamePanelOptions;
  private readonly viewport: RendererSelectableListViewport;

  constructor(opts: BlamePanelOptions) {
    super();
    this.opts = opts;
    this.viewport = new RendererSelectableListViewport({
      itemCount: opts.lines.length,
      selectedIndex: 0,
    });
  }

  private innerHeight(): number {
    return Math.max(1, (this.opts.maxVisible ?? 24) - 2);
  }

  private move(delta: number): void {
    if (this.opts.lines.length === 0) return;
    this.viewport.moveSelection(delta);
    this.invalidate();
  }

  private selectEdge(last: boolean): void {
    if (this.opts.lines.length === 0) return;
    if (last) this.viewport.selectLast();
    else this.viewport.selectFirst();
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
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl('u'))) {
      this.move(-this.innerHeight());
      return;
    }
    if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl('d'))) {
      this.move(this.innerHeight());
      return;
    }
    if (matchesKey(data, Key.home) || k === 'g') {
      this.selectEdge(false);
      return;
    }
    if (matchesKey(data, Key.end) || k === 'G') {
      this.selectEdge(true);
    }
  }

  override render(width: number): string[] {
    return [this.renderHeader(width), ...this.renderBody(width), this.renderFooter(width)];
  }

  private renderHeader(width: number): string {
    const t = currentTheme;
    const left =
      t.boldFg('primary', ' Blame ') +
      (this.opts.title !== undefined ? t.fg('textMuted', `${this.opts.title} `) : '');
    const meta = t.fg('textDim', `${this.opts.lines.length.toLocaleString('en-US')} lines `);
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
      ` ${key('↑/↓')} ${dim('move')}  ${key('pgup/pgdn')} ${dim('page')}  ` +
      `${key('g/G')} ${dim('top/bottom')}  ${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number): string[] {
    const height = Math.max(3, this.opts.maxVisible ?? 24);
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);
    const blameLines = this.opts.lines;

    if (blameLines.length === 0) {
      const lines: string[] = [currentTheme.dimFg('textMuted', 'No blame data')];
      while (lines.length < innerHeight) lines.push('');
      return renderRendererFrameRows({
        title: ' Blame ',
        content: lines,
        width,
        height,
        borderStyle,
        titleStyle,
        ellipsis: ELLIPSIS,
      });
    }

    const window = this.viewport.project({ items: blameLines, viewportRows: innerHeight });
    const lines: string[] = window.items.map((projected) =>
      this.renderRow(projected.item, projected.isSelected, innerWidth),
    );
    while (lines.length < innerHeight) lines.push('');

    return renderRendererFrameRows({
      title: ' Blame ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderRow(line: BlameLine, selected: boolean, innerWidth: number): string {
    const t = currentTheme;
    const pointer = selected ? `${renderSelectPointer('blame-panel:pointer')} ` : '  ';
    const pointerStyled = t.fg(selected ? 'primary' : 'textDim', pointer);
    const uncommitted = isUncommittedBlameHash(line.commit.hash);
    const gutterToken = uncommitted ? 'warning' : 'textMuted';
    const hash = t.fg(gutterToken, line.commit.hash.slice(0, HASH_WIDTH));
    const author = t.fg(gutterToken, fitAuthor(line.commit.author));
    const date = t.fg(gutterToken, formatBlameDate(line.commit.authorTime));
    const separator = t.fg('textDim', '│');
    const gutter = `${pointerStyled}${hash} ${author} ${date} ${separator} `;

    const budget = Math.max(0, innerWidth - visibleWidth(gutter));
    const content = t.fg('text', truncateToWidth(line.content, budget, ELLIPSIS));
    return fitLine(`${gutter}${content}`, innerWidth);
  }
}
