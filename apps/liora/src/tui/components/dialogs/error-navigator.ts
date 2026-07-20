/**
 * ErrorNavigator — modal `/errors` diagnostic list. Lists errors collected
 * from the current session transcript one per row (`#<entry> Tool — summary`
 * for failed tool calls, `#<entry> summary` for error-colored status lines);
 * typing filters the list, and Enter jumps the transcript viewport to the
 * selected entry via `onSelect` (the dialog stays open so the user can jump
 * to more errors). Esc closes through `onCancel`.
 *
 * Mirrors the container-replacement pattern used by CommitBrowser /
 * SearchResults: the host mounts the panel into `editorContainer`, focuses
 * it, and tears it down through `onCancel`. Selection + scrolling reuse the
 * renderer's `RendererSelectableListViewport`, the same primitive the
 * siblings use.
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
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';
import { ttui } from '#/tui/utils/tui-i18n';
import type { TranscriptErrorItem } from '#/tui/utils/transcript-errors';

const ELLIPSIS = '…';

export interface ErrorNavigatorOptions {
  readonly items: readonly TranscriptErrorItem[];
  /** Jump the transcript viewport to the selected error (Enter). */
  readonly onSelect: (item: TranscriptErrorItem) => void;
  /** Close the navigator (Esc). */
  readonly onCancel: () => void;
  /** Body frame height (including its two border rows). Defaults to 24. */
  readonly maxVisible?: number;
}

export class ErrorNavigatorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: ErrorNavigatorOptions;
  private readonly viewport: RendererSelectableListViewport;
  private filter = '';

  constructor(opts: ErrorNavigatorOptions) {
    super();
    this.opts = opts;
    this.viewport = new RendererSelectableListViewport({
      itemCount: opts.items.length,
      selectedIndex: 0,
    });
  }

  /** Items matching the current type-to-filter query, in transcript order. */
  private filteredItems(): readonly TranscriptErrorItem[] {
    const needle = this.filter.toLowerCase();
    if (needle.length === 0) return this.opts.items;
    return this.opts.items.filter((item) => {
      const haystack = `${item.toolName ?? ''} ${item.summary}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  private move(delta: number): void {
    if (this.filteredItems().length === 0) return;
    this.viewport.moveSelection(delta);
    this.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
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
    if (matchesKey(data, Key.enter)) {
      const items = this.filteredItems();
      const item = items[this.viewport.snapshot().selectedIndex];
      if (item !== undefined) this.opts.onSelect(item);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.viewport.select(0);
        this.invalidate();
      }
      return;
    }
    const ch = printableChar(data);
    if (isPrintableChar(ch)) {
      this.filter += ch;
      this.viewport.select(0);
      this.invalidate();
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
    const total = this.opts.items.length;
    const sep = t.dimFg('textMuted', '·');
    let header =
      t.boldFg('error', ttui('tui.errors.title')) +
      ` ${sep} ${t.fg('text', ttui('tui.errors.count', { count: total }))}`;
    if (this.filter.length > 0) {
      const matched = this.filteredItems().length;
      header +=
        ` ${sep} ${t.fg('textDim', `filter: ${this.filter}`)}` +
        ` ${t.fg('textMuted', `${String(matched)}/${String(total)}`)}`;
    }
    return fitLine(header, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const line =
      ` ${key('↑/↓')} ${dim(ttui('tui.errors.footer.move'))}  ${key('enter')} ` +
      ` ${dim(ttui('tui.errors.footer.jump'))}  ${key('esc')} ` +
      ` ${dim(ttui('tui.errors.footer.close'))}  ${dim(ttui('tui.errors.footer.filter'))} `;
    return fitLine(line, width);
  }

  private renderBody(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);
    const borderStyle = (text: string): string => currentTheme.fg('error', text);
    const titleStyle = (text: string): string => currentTheme.boldFg('textStrong', text);

    const items = this.filteredItems();
    if (this.opts.items.length === 0) {
      return this.renderEmptyBody(ttui('tui.errors.empty'), width, height, innerHeight, borderStyle, titleStyle);
    }
    if (items.length === 0) {
      return this.renderEmptyBody(ttui('tui.errors.noMatches'), width, height, innerHeight, borderStyle, titleStyle);
    }

    const window = this.viewport.project({ items, viewportRows: innerHeight });
    const lines: string[] = window.items.map((projected) =>
      this.renderRow(projected.item, projected.isSelected, innerWidth),
    );
    while (lines.length < innerHeight) lines.push('');

    return renderRendererFrameRows({
      title: ' Errors ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderEmptyBody(
    message: string,
    width: number,
    height: number,
    innerHeight: number,
    borderStyle: (text: string) => string,
    titleStyle: (text: string) => string,
  ): string[] {
    const lines: string[] = [currentTheme.dimFg('textMuted', message)];
    while (lines.length < innerHeight) lines.push('');
    return renderRendererFrameRows({
      title: ' Errors ',
      content: lines,
      width,
      height,
      borderStyle,
      titleStyle,
      ellipsis: ELLIPSIS,
    });
  }

  private renderRow(item: TranscriptErrorItem, selected: boolean, innerWidth: number): string {
    const t = currentTheme;
    const pointer = selected ? `${renderSelectPointer('error-navigator:pointer')} ` : '  ';
    const pointerStyled = t.fg(selected ? 'primary' : 'textDim', pointer);
    const indexLabel = t.fg('textMuted', `#${String(item.index + 1)}`);

    let left: string;
    if (item.source === 'tool' && item.toolName !== undefined) {
      const name = t.fg('error', item.toolName);
      left = `${pointerStyled}${indexLabel} ${name} ${t.dimFg('textMuted', '—')} `;
    } else {
      left = `${pointerStyled}${indexLabel} `;
    }

    const budget = Math.max(1, innerWidth - visibleWidth(left));
    const summaryText = truncateToWidth(item.summary, budget, ELLIPSIS);
    const summary = selected ? t.boldFg('primary', summaryText) : t.fg('text', summaryText);
    return fitLine(`${left}${summary}`, innerWidth);
  }
}

/** Fit `line` into exactly `width` columns (ANSI-aware truncate + pad). */
function fitLine(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w < width ? s + ' '.repeat(width - w) : s;
}
