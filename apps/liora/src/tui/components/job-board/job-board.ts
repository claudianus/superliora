/**
 * JobBoardApp — full-screen Conductor job desk board (alt-screen takeover).
 *
 * Two-pane layout: left grouped job list (running / needs-user / blocked /
 * queued / interrupted / failed / done / cancelled), right drill-down with
 * the selected job's detail and inbox history. Header shows strip counts,
 * pool backpressure, and unread inbox.
 *
 * Mounted by `JobBoardController` via container swap (same pattern as
 * TasksBrowserApp). Data flows in through `setProps` from
 * `appState.conductorJobs`; actions fire the `on*` callbacks.
 */

import {
  Container,
  Key,
  matchesKey,
  RendererSelectableListViewport,
  renderRendererFrameRows,
  renderRendererVerticalScrollbar,
  truncateToWidth,
  visibleWidth,
  type Focusable,
  type RendererTerminalHost,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { renderPulseText } from '../../features/appearance/appearance-pulse';
import { printableChar } from '../../utils/printable-key';
import { renderSelectPointer } from '../../utils/ui/select-pointer';
import type {
  ConductorJobCard,
  ConductorJobInboxEntry,
  ConductorJobsSnapshot,
} from '../../utils/job/job-strip';
import {
  ELLIPSIS,
  fitExactly,
  formatRelativeTime,
  singleLine,
} from '../dialogs/tasks/tasks-browser-helpers';
import {
  computeJobBackpressure,
  groupJobCards,
  inboxKindLabel,
  JOB_BOARD_DETAIL_INBOX_MAX,
  JOB_BOARD_LIST_COL_MAX,
  JOB_BOARD_LIST_COL_MIN,
  JOB_BOARD_LIST_COL_RATIO,
  JOB_BOARD_MIN_HEIGHT,
  JOB_BOARD_MIN_WIDTH,
  JOB_STATUS_META,
  shortJobId,
  worktreeLeaf,
  type JobBoardGroup,
} from './job-board-helpers';

export interface JobBoardProps {
  readonly snapshot: ConductorJobsSnapshot;
  readonly selectedJobId: string | undefined;
  readonly flashMessage: string | undefined;
  readonly onSelect: (jobId: string) => void;
  readonly onCancel: () => void;
  /** Fired on Enter — inspect the job in the transcript via JobInspect. */
  readonly onInspect: (jobId: string) => void;
}

type JobBoardRow =
  | { readonly kind: 'group'; readonly group: JobBoardGroup }
  | { readonly kind: 'job'; readonly card: ConductorJobCard };

export class JobBoardApp extends Container implements Focusable {
  focused = false;

  private props: JobBoardProps;
  private readonly terminal: RendererTerminalHost;
  private rows: JobBoardRow[];
  private flatCards: ConductorJobCard[];
  private readonly listViewport: RendererSelectableListViewport;

  constructor(props: JobBoardProps, terminal: RendererTerminalHost) {
    super();
    this.props = props;
    this.terminal = terminal;
    this.rows = [];
    this.flatCards = [];
    this.listViewport = new RendererSelectableListViewport({ itemCount: 0 });
    this.rebuildRows();
    this.syncSelectionFromProps();
  }

  setProps(next: JobBoardProps): void {
    this.props = next;
    this.rebuildRows();
    this.syncSelectionFromProps();
    this.invalidate();
  }

  handleInput(data: string): void {
    const k = printableChar(data);

    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.props.onCancel();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.moveSelection(1);
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.jumpToFirstJob();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.jumpToLastJob();
      return;
    }
    if (matchesKey(data, Key.enter) || k === 'i' || k === 'I') {
      const card = this.selectedCard();
      if (card !== undefined) this.props.onInspect(card.id);
      return;
    }
  }

  /**
   * Render the entire screen as `terminal.rows` lines of `width` cols.
   * Layout: header(1) + body(rows-2) + footer(1).
   */
  override render(width: number): string[] {
    const rows = Math.max(1, this.terminal.rows);
    if (width < JOB_BOARD_MIN_WIDTH || rows < JOB_BOARD_MIN_HEIGHT) {
      return this.renderTooSmall(width, rows);
    }

    const header = this.renderHeader(width);
    const footer = this.renderFooter(width);
    const bodyHeight = rows - 2;

    const listWidth = Math.max(
      JOB_BOARD_LIST_COL_MIN,
      Math.min(JOB_BOARD_LIST_COL_MAX, Math.floor(width * JOB_BOARD_LIST_COL_RATIO)),
    );
    const rightWidth = width - listWidth;

    const listFrame = this.renderListFrame(listWidth, bodyHeight);
    const rightFrames = this.renderRightStack(rightWidth, bodyHeight);

    const lines: string[] = [header];
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(
        (listFrame[i] ?? ' '.repeat(listWidth)) + (rightFrames[i] ?? ' '.repeat(rightWidth)),
      );
    }
    lines.push(footer);
    return lines;
  }

  // ── row model ────────────────────────────────────────────────────────

  private rebuildRows(): void {
    const groups = groupJobCards(this.props.snapshot.jobs ?? []);
    const rows: JobBoardRow[] = [];
    const flat: ConductorJobCard[] = [];
    for (const group of groups) {
      rows.push({ kind: 'group', group });
      for (const card of group.cards) {
        rows.push({ kind: 'job', card });
        flat.push(card);
      }
    }
    this.rows = rows;
    this.flatCards = flat;
  }

  private syncSelectionFromProps(): void {
    if (this.rows.length === 0) {
      this.listViewport.update({ itemCount: 0, selectedIndex: 0 });
      return;
    }
    const wanted = this.props.selectedJobId;
    if (wanted !== undefined) {
      const idx = this.rows.findIndex((row) => row.kind === 'job' && row.card.id === wanted);
      if (idx !== -1) {
        this.listViewport.update({ itemCount: this.rows.length, selectedIndex: idx });
        return;
      }
    }
    const firstJob = this.rows.findIndex((row) => row.kind === 'job');
    this.listViewport.update({
      itemCount: this.rows.length,
      selectedIndex: firstJob === -1 ? 0 : firstJob,
    });
  }

  private moveSelection(delta: 1 | -1): void {
    if (this.flatCards.length === 0) return;
    const { selectedIndex } = this.listViewport.snapshot();
    let next = selectedIndex + delta;
    while (next >= 0 && next < this.rows.length && this.rows[next]!.kind !== 'job') {
      next += delta;
    }
    if (next < 0 || next >= this.rows.length) return;
    this.listViewport.update({ itemCount: this.rows.length, selectedIndex: next });
    this.emitSelect();
    this.invalidate();
  }

  private jumpToFirstJob(): void {
    const idx = this.rows.findIndex((row) => row.kind === 'job');
    if (idx === -1) return;
    this.listViewport.update({ itemCount: this.rows.length, selectedIndex: idx });
    this.emitSelect();
    this.invalidate();
  }

  private jumpToLastJob(): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.kind === 'job') {
        this.listViewport.update({ itemCount: this.rows.length, selectedIndex: i });
        this.emitSelect();
        this.invalidate();
        return;
      }
    }
  }

  private emitSelect(): void {
    const card = this.selectedCard();
    if (card !== undefined) this.props.onSelect(card.id);
  }

  private selectedCard(): ConductorJobCard | undefined {
    const row = this.rows[this.listViewport.snapshot().selectedIndex];
    return row !== undefined && row.kind === 'job' ? row.card : undefined;
  }

  // ── header / footer ──────────────────────────────────────────────────

  private renderHeader(width: number): string {
    const title = currentTheme.boldFg('primary', ' CONDUCTOR JOB DESK ');
    const s = this.props.snapshot;
    const segments: string[] = [];
    if (s.running > 0) {
      segments.push(renderPulseText(` ${String(s.running)} running `, 'job-board:running', 'primary'));
    }
    if (s.needsUser > 0)
      segments.push(currentTheme.fg('warning', ` ${String(s.needsUser)} needs user `));
    if (s.blocked > 0)
      segments.push(currentTheme.fg('error', ` ${String(s.blocked)} blocked `));
    if (s.queued > 0) segments.push(currentTheme.fg('info', ` ${String(s.queued)} queued `));
    if (s.interrupted > 0)
      segments.push(currentTheme.fg('textDim', ` ${String(s.interrupted)} paused `));
    if (s.failed > 0) segments.push(currentTheme.fg('error', ` ${String(s.failed)} failed `));
    const done = s.total - s.running - s.needsUser - s.blocked - s.queued - s.interrupted - s.failed;
    if (done > 0) segments.push(currentTheme.fg('success', ` ${String(done)} done `));

    const rightParts: string[] = [];
    const backpressure = computeJobBackpressure(s);
    if (backpressure !== undefined) {
      rightParts.push(currentTheme.fg(backpressure.token, ` ${backpressure.label} `));
    }
    if (s.unreadInbox > 0) {
      rightParts.push(currentTheme.fg('accent', ` inbox ${String(s.unreadInbox)} `));
    }
    const right = rightParts.join('');

    const left = title + segments.join('');
    const total = visibleWidth(left) + visibleWidth(right);
    if (total <= width) {
      return left + ' '.repeat(width - total) + right;
    }
    return fitExactly(left, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);

    const parts = [
      ` ${key('↑↓')} ${dim('navigate')}`,
      `${key('Enter/I')} ${dim('inspect')}`,
      `${key('Q/Esc')} ${dim('cancel')} `,
    ];
    const left = parts.join('  ');
    const flash = this.props.flashMessage;
    if (flash !== undefined && flash.length > 0) {
      const flashStyled = currentTheme.fg('warning', ` ${flash} `);
      const total = visibleWidth(left) + visibleWidth(flashStyled);
      if (total <= width) {
        return left + ' '.repeat(width - total) + flashStyled;
      }
    }
    return fitExactly(left, width);
  }

  // ── frame primitive ──────────────────────────────────────────────────

  private renderFrame(
    title: string,
    content: readonly string[],
    width: number,
    height: number,
  ): string[] {
    return renderRendererFrameRows({
      title,
      content,
      width,
      height,
      borderStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => currentTheme.boldFg('textStrong', text),
      ellipsis: ELLIPSIS,
    });
  }

  // ── left: grouped job list ───────────────────────────────────────────

  private renderListFrame(width: number, height: number): string[] {
    const s = this.props.snapshot;
    const title = `Jobs [${String(this.flatCards.length)}]`;
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = width - 2;

    if (this.rows.length === 0) {
      const lines: string[] = [];
      if (s.total > 0) {
        lines.push(
          currentTheme.fg(
            'textDim',
            'Ledger counts only — run /jobs to load job rows here.',
          ),
        );
      } else {
        lines.push(currentTheme.fg('textMuted', 'No Conductor jobs yet.'));
        lines.push(currentTheme.fg('textMuted', 'Plan work with Conductor; jobs stream in live.'));
      }
      while (lines.length < innerHeight) lines.push('');
      return this.renderFrame(title, lines.map((line) => fitExactly(line, innerWidth)), width, height);
    }

    const window = this.listViewport.project({ items: this.rows, viewportRows: innerHeight });
    const hasScrollbar = window.hasOverflow && innerHeight > 0 && innerWidth > 8;
    const rowWidth = hasScrollbar ? innerWidth - 1 : innerWidth;
    const scrollbar = hasScrollbar
      ? renderRendererVerticalScrollbar({
          contentRows: window.itemCount,
          viewportRows: window.viewportRows,
          offsetFromBottom: window.maxScrollTop - window.scrollTop,
          trackRows: innerHeight,
        })
      : [];

    const lines: string[] = [];
    for (const [index, row] of window.items.entries()) {
      const line =
        row.item.kind === 'group'
          ? this.renderGroupRow(row.item.group, rowWidth)
          : this.renderJobRow(row.item.card, row.isSelected, rowWidth);
      lines.push(line + this.renderScrollbarCell(scrollbar[index], hasScrollbar));
    }
    while (lines.length < innerHeight) {
      lines.push(
        ' '.repeat(rowWidth) + this.renderScrollbarCell(scrollbar[lines.length], hasScrollbar),
      );
    }
    return this.renderFrame(title, lines, width, height);
  }

  private renderScrollbarCell(glyph: string | undefined, visible: boolean): string {
    if (!visible) return '';
    return currentTheme.fg(glyph === '█' ? 'primary' : 'textDim', glyph ?? ' ');
  }

  private renderGroupRow(group: JobBoardGroup, rowWidth: number): string {
    const { meta } = group;
    const label = `${meta.glyph} ${meta.label} (${String(group.cards.length)})`;
    const styled =
      meta.token === 'primary'
        ? renderPulseText(label, `job-board:group:${group.status}`, meta.token)
        : currentTheme.boldFg(meta.token, label);
    return fitExactly(`  ${styled}`, rowWidth);
  }

  private renderJobRow(card: ConductorJobCard, selected: boolean, rowWidth: number): string {
    const meta = JOB_STATUS_META[card.status];
    const pointerStyled = selected
      ? `${renderSelectPointer('job-board:pointer')} `
      : currentTheme.fg('textDim', '  ');

    const idText = selected
      ? currentTheme.boldFg('primary', shortJobId(card.id).padEnd(9))
      : currentTheme.fg('textMuted', shortJobId(card.id).padEnd(9));
    const kindText = currentTheme.fg('textDim', `${card.kind} p${String(card.priority)}`.padEnd(13));
    const prefix = `${pointerStyled}${currentTheme.fg(meta.token, meta.glyph)} ${idText}${kindText}`;
    const prefixWidth = visibleWidth(prefix);
    const titleBudget = Math.max(0, rowWidth - prefixWidth - 1);
    if (titleBudget < 4) return fitExactly(prefix, rowWidth);

    const title = truncateToWidth(singleLine(card.title) || card.id, titleBudget, ELLIPSIS);
    const titleStyled = selected ? currentTheme.boldFg('textStrong', title) : currentTheme.fg('text', title);
    return fitExactly(`${prefix} ${titleStyled}`, rowWidth);
  }

  // ── right: detail + inbox stack ──────────────────────────────────────

  private renderRightStack(width: number, height: number): string[] {
    const detailHeight = Math.max(9, Math.min(Math.floor(height * 0.55), height - 4));
    const inboxHeight = height - detailHeight;
    return [
      ...this.renderDetailFrame(width, detailHeight),
      ...this.renderInboxFrame(width, inboxHeight),
    ];
  }

  private renderDetailFrame(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = width - 2;
    const card = this.selectedCard();
    if (card === undefined) {
      const empty = currentTheme.fg(
        'textMuted',
        this.flatCards.length === 0
          ? 'Waiting for job events…'
          : 'Select a job to inspect it.',
      );
      const lines: string[] = [empty];
      while (lines.length < innerHeight) lines.push('');
      return this.renderFrame('Detail', lines.map((line) => fitExactly(line, innerWidth)), width, height);
    }

    const meta = JOB_STATUS_META[card.status];
    const label = (text: string): string => currentTheme.fg('textMuted', text.padEnd(10));
    const value = (text: string): string => currentTheme.fg('text', text);

    const lines: string[] = [
      `${label('Prompt:')}${value(truncateToWidth(singleLine(card.title), Math.max(0, innerWidth - 10), ELLIPSIS))}`,
      `${label('Job:')}${value(card.id)}`,
      `${label('Status:')}${currentTheme.fg(meta.token, `${meta.glyph} ${meta.label}`)}`,
      `${label('Kind:')}${value(`${card.kind} · priority ${String(card.priority)}`)}`,
    ];
    if (card.worktreePath !== undefined) {
      lines.push(
        `${label('Worktree:')}${value(truncateToWidth(worktreeLeaf(card.worktreePath), Math.max(0, innerWidth - 10), ELLIPSIS))}`,
      );
      lines.push(
        currentTheme.fg('textDim', truncateToWidth(`  ${card.worktreePath}`, innerWidth, ELLIPSIS)),
      );
    }
    if (card.workerAgentId !== undefined) {
      lines.push(`${label('Worker:')}${value(truncateToWidth(card.workerAgentId, Math.max(0, innerWidth - 10), ELLIPSIS))}`);
    }
    if (card.missionRunId !== undefined) {
      lines.push(`${label('Mission:')}${value(card.missionRunId)}`);
    }
    lines.push(`${label('Updated:')}${currentTheme.fg('textMuted', formatRelativeTime(card.updatedAtMs))}`);
    if (card.resultSummary !== undefined && card.resultSummary.length > 0) {
      lines.push(`${label('Result:')}${value(truncateToWidth(singleLine(card.resultSummary), Math.max(0, innerWidth - 10), ELLIPSIS))}`);
    }
    if (card.status === 'failed' || card.status === 'blocked') {
      lines.push(
        currentTheme.fg(
          'error',
          truncateToWidth(
            card.status === 'failed'
              ? 'Worker failed — Enter runs JobInspect for full detail.'
              : 'Blocked — answer or resume via /job.',
            innerWidth,
            ELLIPSIS,
          ),
        ),
      );
    }
    if (card.status === 'needs_user') {
      lines.push(
        currentTheme.fg(
          'warning',
          truncateToWidth('Answer with /job answer <id> <text>', innerWidth, ELLIPSIS),
        ),
      );
    }
    while (lines.length < innerHeight) lines.push('');
    return this.renderFrame(
      'Detail',
      lines.slice(0, innerHeight).map((line) => fitExactly(line, innerWidth)),
      width,
      height,
    );
  }

  private renderInboxFrame(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = width - 2;
    const card = this.selectedCard();
    const inbox = this.props.snapshot.inbox ?? [];
    const entries = (
      card !== undefined ? inbox.filter((entry) => entry.jobId === card.id) : [...inbox]
    ).slice(-JOB_BOARD_DETAIL_INBOX_MAX);

    if (entries.length === 0) {
      const hint = currentTheme.fg(
        'textMuted',
        card !== undefined ? 'No inbox notices for this job.' : 'No inbox notices yet.',
      );
      const lines: string[] = [hint];
      while (lines.length < innerHeight) lines.push('');
      return this.renderFrame('Inbox', lines.map((line) => fitExactly(line, innerWidth)), width, height);
    }

    const lines: string[] = [];
    for (const entry of [...entries].reverse()) {
      if (lines.length >= innerHeight) break;
      lines.push(this.renderInboxEntryLine(entry, innerWidth));
      if (entry.summary !== undefined && entry.summary.length > 0 && lines.length < innerHeight) {
        lines.push(
          fitExactly(
            currentTheme.fg('textDim', truncateToWidth(`  ${singleLine(entry.summary)}`, innerWidth, ELLIPSIS)),
            innerWidth,
          ),
        );
      }
    }
    while (lines.length < innerHeight) lines.push('');
    return this.renderFrame('Inbox', lines, width, height);
  }

  private renderInboxEntryLine(entry: ConductorJobInboxEntry, rowWidth: number): string {
    const kind = inboxKindLabel(entry.kind);
    const token =
      kind === 'completed'
        ? 'success'
        : kind === 'failed' || kind === 'blocked'
          ? 'error'
          : kind === 'needs_user' || kind === 'interrupted'
            ? 'warning'
            : 'textDim';
    const time = currentTheme.fg('textMuted', formatRelativeTime(entry.atMs));
    const head = `${currentTheme.fg(token, kind)} ${currentTheme.fg('text', truncateToWidth(singleLine(entry.title), Math.max(0, rowWidth - visibleWidth(time) - kind.length - 3), ELLIPSIS))}`;
    return fitExactly(`${head} ${time}`, rowWidth);
  }

  // ── too-small fallback ──────────────────────────────────────────────

  private renderTooSmall(width: number, rows: number): string[] {
    const lines: string[] = [];
    const msg = currentTheme.fg(
      'error',
      `Terminal too small (need ≥ ${String(JOB_BOARD_MIN_WIDTH)} × ${String(JOB_BOARD_MIN_HEIGHT)})`,
    );
    lines.push(fitExactly(msg, width));
    for (let i = 1; i < rows; i++) lines.push(' '.repeat(width));
    return lines;
  }
}
