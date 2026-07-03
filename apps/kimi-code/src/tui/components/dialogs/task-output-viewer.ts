/**
 * TaskOutputViewer — full-screen pi-tui rendered output viewer for
 * a single background task. Replaces the previous "shell out to less"
 * approach so the experience stays inside the TUI: same colors, same
 * fonts, same redraw cycle, no alt-screen flip-flop.
 *
 * Mounted by `kimi-tui.ts` via nested container swap on top of the
 * TasksBrowserApp. Snapshot view (no live tail) — content is fetched
 * once when the viewer opens.
 */

import {
  Container,
  Key,
  fitRendererLineToWidth,
  formatRendererScrollPosition,
  matchesKey,
  renderRendererFooterRow,
  renderRendererScrollableFrameRows,
  type RendererScrollableFrameRowsProjection,
  RendererScrollableLineViewport,
  type RendererTerminalHost,
  type RendererViewportScrollAction,
  type Focusable,
} from '#/tui/renderer';
import type { BackgroundTaskInfo, BackgroundTaskStatus } from '@moonshot-ai/kimi-code-sdk';

import { currentTheme } from '#/tui/theme';
import { printableChar } from '@/tui/utils/printable-key';

const ELLIPSIS = '…';

export interface TaskOutputViewerProps {
  readonly taskId: string;
  readonly info: BackgroundTaskInfo | undefined;
  readonly output: string;
  readonly onClose: () => void;
}

const STATUS_LABEL: Record<BackgroundTaskStatus, string> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed out',
  killed: 'killed',
  lost: 'lost',
};

function statusColor(status: BackgroundTaskStatus): 'success' | 'textMuted' | 'error' {
  switch (status) {
    case 'running':
      return 'success';
    case 'completed':
      return 'textMuted';
    case 'failed':
    case 'timed_out':
    case 'killed':
    case 'lost':
      return 'error';
  }
}

export class TaskOutputViewer extends Container implements Focusable {
  focused = false;

  private props: TaskOutputViewerProps;
  private readonly terminal: RendererTerminalHost;
  /** Output split on '\n'. Replaced on `setProps` when `output` changes. */
  private lines: string[];
  private readonly viewport: RendererScrollableLineViewport;

  constructor(props: TaskOutputViewerProps, terminal: RendererTerminalHost) {
    super();
    this.props = props;
    this.terminal = terminal;
    this.lines = this.splitOutput(props.output);
    this.viewport = new RendererScrollableLineViewport({
      contentRows: this.lines.length,
      viewportRows: this.viewableRows(),
    });
  }

  /**
   * Update viewer props. When `output` grows (the watched task wrote
   * new content), follow the tail like `less +F` if the user is parked
   * at the bottom; otherwise keep the user's current scroll position
   * so they can read history without being yanked around.
   */
  setProps(next: TaskOutputViewerProps): void {
    const previousOutput = this.props.output;
    this.props = next;
    if (next.output !== previousOutput) {
      this.lines = this.splitOutput(next.output);
      this.viewport.update({
        contentRows: this.lines.length,
        viewportRows: this.viewableRows(),
      });
    }
    this.invalidate();
  }

  private splitOutput(output: string): string[] {
    return (output.length > 0 ? output : '[no output captured]').split('\n');
  }

  // ── input ──────────────────────────────────────────────────────────

  handleInput(data: string): void {
    const visible = this.viewableRows();
    const k = printableChar(data);

    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.props.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.scrollViewport('line-up');
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.scrollViewport('line-down');
      return;
    }
    if (
      matchesKey(data, Key.pageUp) ||
      matchesKey(data, Key.ctrl('u')) ||
      k === ' ' ||
      data === '\u0002' /* C-b */
    ) {
      this.scrollViewport('page-up', Math.max(1, visible - 1));
      return;
    }
    if (
      matchesKey(data, Key.pageDown) ||
      matchesKey(data, Key.ctrl('d')) ||
      data === '\u0006' /* C-f */
    ) {
      this.scrollViewport('page-down', Math.max(1, visible - 1));
      return;
    }
    if (matchesKey(data, Key.home) || k === 'g') {
      this.scrollViewport('home');
      return;
    }
    if (matchesKey(data, Key.end) || k === 'G') {
      this.scrollViewport('end');
      return;
    }
  }

  private scrollViewport(action: RendererViewportScrollAction, amount?: number): void {
    this.viewport.scroll(action, amount);
    this.invalidate();
  }

  /**
   * Number of content rows visible inside the body frame: total terminal
   * rows minus header(1) + footer(1) + top border(1) + bottom border(1).
   */
  private viewableRows(): number {
    return Math.max(1, this.terminal.rows - 4);
  }

  // ── render ─────────────────────────────────────────────────────────

  override render(width: number): string[] {
    const rows = Math.max(3, this.terminal.rows);
    const bodyHeight = rows - 2;

    const header = this.renderHeader(width);
    const body = this.renderBody(width, bodyHeight);
    const footer = this.renderFooter(width, body);

    const out: string[] = [header];
    for (const line of body.rows) out.push(line);
    out.push(footer);
    return out;
  }

  private renderHeader(width: number): string {
    const title = currentTheme.boldFg('primary', ' Task output ');
    const id = currentTheme.boldFg('text', this.props.taskId);
    const info = this.props.info;
    const segments: string[] = [];
    if (info !== undefined) {
      segments.push(currentTheme.fg(statusColor(info.status), STATUS_LABEL[info.status]));
      if (info.kind === 'process' && info.exitCode !== null) {
        segments.push(currentTheme.fg('textMuted', `exit ${String(info.exitCode)}`));
      }
      if (info.description && info.description.length > 0) {
        segments.push(currentTheme.fg('textMuted', info.description));
      }
    }
    const composed = title + id + (segments.length > 0 ? '  ' + segments.join('  ') : '');
    return fitRendererLineToWidth(composed, width, ELLIPSIS);
  }

  private renderBody(width: number, bodyHeight: number): RendererScrollableFrameRowsProjection {
    return renderRendererScrollableFrameRows({
      viewport: this.viewport,
      body: this.lines,
      fill: '',
      width,
      height: bodyHeight,
      paddingX: 1,
      formatLine: ({ line }) => currentTheme.fg('text', line),
      borderStyle: (text) => currentTheme.fg('primary', text),
      ellipsis: ELLIPSIS,
    });
  }

  private renderFooter(
    width: number,
    window: RendererScrollableFrameRowsProjection,
  ): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);

    const position = currentTheme.fg(
      'textMuted',
      formatRendererScrollPosition(window),
    );
    const keys =
      `${key('↑↓')} ${dim('line')}  ` +
      `${key('PgUp/PgDn/Ctrl+U/D')} ${dim('page')}  ` +
      `${key('g/G')} ${dim('top/bot')}  ` +
      `${key('Q/Esc')} ${dim('cancel')}`;
    const left = ` ${keys}`;
    return renderRendererFooterRow({
      width,
      left,
      right: position,
      ellipsis: ELLIPSIS,
    });
  }
}
