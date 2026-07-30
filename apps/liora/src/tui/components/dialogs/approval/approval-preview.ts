/**
 * ApprovalPreviewViewer — full-screen preview of an Edit diff or Write
 * file content for the approval flow.
 *
 * Mounted by `kimi-tui.ts` via the same nested-takeover pattern as
 * `TaskOutputViewer`: the active approval panel is preserved underneath
 * and restored on close. The viewer is intentionally a snapshot — its
 * lines are rendered once at construction and only sliced on scroll, so
 * the per-frame render cost stays in `O(viewport)` even when the
 * underlying diff/content is very large.
 *
 * This avoids the prior failure mode where pressing ctrl+e on an Edit
 * with a long hunk inflated the approval panel past one screen, which
 * collided with pi-tui's inline differential renderer and the terminal
 * emulator's "snap to bottom on stdout" reflex, causing flicker and an
 * unscrollable history pane.
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

import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import { renderDiffLines } from '#/tui/components/media/diff-preview';
import type { DiffDisplayBlock, FileContentDisplayBlock } from '#/tui/reverse-rpc/types';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';

const ELLIPSIS = '…';

export type ApprovalPreviewBlock = DiffDisplayBlock | FileContentDisplayBlock;

export interface ApprovalPreviewViewerProps {
  readonly block: ApprovalPreviewBlock;
  readonly onClose: () => void;
}

export class ApprovalPreviewViewer extends Container implements Focusable {
  focused = false;

  private readonly props: ApprovalPreviewViewerProps;
  private readonly terminal: RendererTerminalHost;
  /** Pre-rendered body lines (ANSI-styled, no border / no gutter). */
  private bodyLines: string[];
  /** Title shown in the header (path + diff stats / "Write" label). */
  private headerTitle: string;
  private readonly viewport: RendererScrollableLineViewport;

  constructor(props: ApprovalPreviewViewerProps, terminal: RendererTerminalHost) {
    super();
    this.props = props;
    this.terminal = terminal;
    const built = buildBody(props.block);
    this.bodyLines = built.lines;
    this.headerTitle = built.title;
    this.viewport = new RendererScrollableLineViewport({
      contentRows: this.bodyLines.length,
      viewportRows: this.viewableRows(),
    });
  }

  handleInput(data: string): void {
    const visible = this.viewableRows();
    const k = printableChar(data);

    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('e')) ||
      k === 'q' ||
      k === 'Q'
    ) {
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
    if (matchesKey(data, Key.pageUp) || k === ' ' || data === '\u0002') {
      this.scrollViewport('page-up', Math.max(1, visible - 1));
      return;
    }
    if (matchesKey(data, Key.pageDown) || data === '\u0006') {
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

  override invalidate(): void {
    const built = buildBody(this.props.block);
    this.bodyLines = built.lines;
    this.headerTitle = built.title;
    this.viewport.update({
      contentRows: this.bodyLines.length,
      viewportRows: this.viewableRows(),
    });
  }

  private scrollViewport(action: RendererViewportScrollAction, amount?: number): void {
    this.viewport.scroll(action, amount);
    super.invalidate();
  }

  /** Body rows = terminal rows − header(1) − top border(1) − bottom border(1) − footer(1). */
  private viewableRows(): number {
    return Math.max(1, this.terminal.rows - 4);
  }

  override render(width: number): string[] {
    const rows = Math.max(3, this.terminal.rows);
    const bodyHeight = rows - 2;

    const header = this.renderHeader(width);
    const body = this.renderBody(width, bodyHeight);
    const footer = this.renderFooter(width, body);

    return [header, ...body.rows, footer];
  }

  private renderHeader(width: number): string {
    const title = currentTheme.boldFg('primary', ' Preview ');
    return fitRendererLineToWidth(title + this.headerTitle, width, ELLIPSIS);
  }

  private renderBody(width: number, bodyHeight: number): RendererScrollableFrameRowsProjection {
    return renderRendererScrollableFrameRows({
      viewport: this.viewport,
      body: this.bodyLines,
      fill: '',
      width,
      height: bodyHeight,
      paddingX: 1,
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
      `${key('PgUp/PgDn')} ${dim('page')}  ` +
      `${key('g/G')} ${dim('top/bot')}  ` +
      `${key('Q/Esc/Ctrl+E')} ${dim('cancel')}`;
    const left = ` ${keys}`;
    return renderRendererFooterRow({
      width,
      left,
      right: position,
      ellipsis: ELLIPSIS,
    });
  }
}

interface BuiltBody {
  lines: string[];
  title: string;
}

function buildBody(block: ApprovalPreviewBlock): BuiltBody {
  if (block.type === 'diff') {
    return buildDiffBody(block);
  }
  return buildFileContentBody(block);
}

function buildDiffBody(block: DiffDisplayBlock): BuiltBody {
  // renderDiffLines emits a `+N -M path` header on its first line followed
  // by every changed line. We pull the header out into the viewer chrome so
  // the body is purely scrollable diff content; this also means we don't
  // double-render the path.
  const rendered = renderDiffLines(
    block.old_text,
    block.new_text,
    block.path,
    false,
    block.old_start ?? 1,
    block.new_start ?? 1,
  );
  const [header = '', ...rest] = rendered;
  return { lines: rest, title: stripLeadingSpace(header) };
}

function buildFileContentBody(block: FileContentDisplayBlock): BuiltBody {
  const lang = block.language ?? langFromPath(block.path);
  const highlighted = highlightLines(block.content, lang);
  const lines = highlighted.map(
    (line, i) => currentTheme.fg('diffGutter', String(i + 1).padStart(4) + '  ') + line,
  );
  const title = currentTheme.fg('textStrong', block.path);
  return { lines, title };
}

function stripLeadingSpace(s: string): string {
  return s.replace(/^ +/, '');
}
