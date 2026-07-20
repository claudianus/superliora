/**
 * CommitBrowser — modal `/log` commit history. Lists recent commits one per
 * row (short hash · subject · `+a −d` · relative date · author); navigating
 * to a commit and pressing Enter/L opens its full diff in the diff review
 * dialog via `onOpenCommit`. Esc/Q closes through `onClose`.
 *
 * Mirrors the container-replacement pattern used by DiffReview/FileExplorer:
 * the host mounts the panel into `editorContainer`, focuses it, and tears it
 * down through `onClose`. Selection + scrolling reuse the renderer's
 * `RendererSelectableListViewport`, the same primitive the siblings use.
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
import type { GitLogCommit, GitLogReport } from '#/utils/git/git-log';

const ELLIPSIS = '…';
const MIN_SUBJECT_WIDTH = 10;

/** Format an ISO 8601 date as a compact relative span (`3h ago`). */
function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  const weeks = Math.floor(days / 7);
  return `${String(weeks)}w ago`;
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}

export interface CommitBrowserOptions {
  readonly report: GitLogReport;
  readonly filter?: string;
  readonly onClose: () => void;
  /** Open the selected commit's diff in the diff review dialog (Enter/L). */
  readonly onOpenCommit: (commit: GitLogCommit) => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

export class CommitBrowserComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: CommitBrowserOptions;
  private readonly viewport: RendererSelectableListViewport;

  constructor(opts: CommitBrowserOptions) {
    super();
    this.opts = opts;
    this.viewport = new RendererSelectableListViewport({
      itemCount: opts.report.commits.length,
      selectedIndex: 0,
    });
  }

  private selectedCommit(): GitLogCommit | undefined {
    return this.opts.report.commits[this.viewport.snapshot().selectedIndex];
  }

  private move(delta: number): void {
    if (this.opts.report.commits.length === 0) return;
    this.viewport.moveSelection(delta);
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
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.right) || k === 'l' || k === 'L') {
      const commit = this.selectedCommit();
      if (commit !== undefined) this.opts.onOpenCommit(commit);
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
    const { branch, commits } = this.opts.report;
    const sep = t.dimFg('textMuted', '·');
    let header = t.boldFg('primary', 'Commits');
    if (branch !== null) header += ` ${t.fg('textDim', `⎇ ${branch}`)}`;
    header += ` ${sep} ${t.fg('text', `${String(commits.length)} commit${commits.length === 1 ? '' : 's'}`)}`;
    const filter = this.opts.filter ?? '';
    if (filter.length > 0) header += ` ${sep} ${t.fg('textDim', `filter: ${filter}`)}`;
    return fitLine(header, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('↑/↓')} ${dim('move')}  ${key('enter')} ${dim('open diff')}  ` +
      `${key('esc')} ${dim('close')} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('primary', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);
    const commits = this.opts.report.commits;

    if (commits.length === 0) {
      const filter = this.opts.filter ?? '';
      const message =
        filter.length > 0
          ? currentTheme.dimFg('textMuted', `No commits match "${filter}"`)
          : currentTheme.dimFg('textMuted', 'No commits');
      const lines: string[] = [message];
      while (lines.length < innerHeight) lines.push('');
      return renderRendererFrameRows({
        title: ' Log ',
        content: lines,
        width,
        height,
        borderStyle,
        titleStyle,
        ellipsis: ELLIPSIS,
      });
    }

    const window = this.viewport.project({ items: commits, viewportRows: innerHeight });
    const lines: string[] = window.items.map((projected) =>
      this.renderRow(projected.item, projected.isSelected, innerWidth),
    );
    while (lines.length < innerHeight) lines.push('');

    return renderRendererFrameRows({
      title: ' Log ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderRow(commit: GitLogCommit, selected: boolean, innerWidth: number): string {
    const t = currentTheme;
    const pointer = selected ? `${renderSelectPointer('commit-browser:pointer')} ` : '  ';
    const pointerStyled = t.fg(selected ? 'primary' : 'textDim', pointer);
    const hashStyled = t.fg('accent', commit.hash.slice(0, 7));

    const addedText = t.fg(
      commit.additions > 0 ? 'diffAddedStrong' : 'textMuted',
      `+${String(commit.additions)}`,
    );
    const deletedText = t.fg(
      commit.deletions > 0 ? 'diffRemovedStrong' : 'textMuted',
      `−${String(commit.deletions)}`,
    );
    const sep = t.dimFg('textMuted', '·');
    const date = formatRelativeTime(commit.dateIso);

    // Right-aligned meta: `+a −d · 3h ago · author`; author drops when narrow.
    const statsMeta = `${addedText} ${deletedText} ${sep} ${t.fg('textDim', date)}`;
    const metaWithAuthor = `${statsMeta} ${sep} ${t.fg('textMuted', commit.author)}`;

    const leftFixedWidth = visibleWidth(pointerStyled) + visibleWidth(hashStyled) + 1;
    let meta = metaWithAuthor;
    let subjectBudget = innerWidth - leftFixedWidth - visibleWidth(meta) - 1;
    if (subjectBudget < MIN_SUBJECT_WIDTH) {
      meta = statsMeta;
      subjectBudget = innerWidth - leftFixedWidth - visibleWidth(meta) - 1;
    }
    subjectBudget = Math.max(MIN_SUBJECT_WIDTH, subjectBudget);

    const subjectText = truncateToWidth(commit.subject, subjectBudget, ELLIPSIS);
    const subject = selected ? t.boldFg('primary', subjectText) : t.fg('text', subjectText);

    const left = `${pointerStyled}${hashStyled} ${subject}`;
    const metaWidth = visibleWidth(meta);
    const gap = Math.max(1, innerWidth - visibleWidth(left) - metaWidth);
    return fitLine(`${left}${' '.repeat(gap)}${meta}`, innerWidth);
  }
}
