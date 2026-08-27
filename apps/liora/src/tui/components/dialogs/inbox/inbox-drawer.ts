/**
 * Conductor Inbox drawer — editor-replacement list of unread job notices
 * plus optional pending approval / question glance rows.
 *
 * PREMIUM.md §3 list grammar: two full-width borders, title +
 * (type to search), one hint line, Search: only while filtering,
 * SearchableList paging, printableChar type-to-search.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { SearchableList } from '#/tui/utils/ui/searchable-list';
import { ttui } from '#/tui/utils/tui-i18n';
import { inboxKindLabel } from '../../job-board/job-board-helpers';

export type InboxDrawerRowKind = 'notice' | 'approval' | 'question' | 'needs_user';

export interface InboxDrawerItem {
  readonly id: string;
  readonly kind: InboxDrawerRowKind;
  readonly title: string;
  readonly detail?: string;
  readonly jobId?: string;
  /** Raw inbox event kind (`job.needs_user`, …) when kind === 'notice'. */
  readonly eventKind?: string;
  /** Optional 1–2 line question preview under the row (needs_user). */
  readonly previewLines?: readonly string[];
}

export interface InboxDrawerOptions {
  readonly items: readonly InboxDrawerItem[];
  readonly onAct: (item: InboxDrawerItem) => void;
  /** Open Merge Preview for done/blocked jobs (M). */
  readonly onMergePreview?: (item: InboxDrawerItem) => void;
  /** Open Push Preview for done/blocked jobs (P). */
  readonly onPushPreview?: (item: InboxDrawerItem) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

const INBOX_PAGE_SIZE = 10;

export class InboxDrawerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: InboxDrawerOptions;
  private items: readonly InboxDrawerItem[];
  private list: SearchableList<InboxDrawerItem>;

  constructor(opts: InboxDrawerOptions) {
    super();
    this.opts = opts;
    this.items = opts.items;
    this.list = this.createList(opts.items);
  }

  setItems(items: readonly InboxDrawerItem[]): void {
    const selectedId = this.list.selected()?.id;
    this.items = items;
    this.list = this.createList(items, selectedId);
    this.opts.requestRender?.();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (matchesKey(data, Key.escape) && this.list.clearQuery()) {
        this.opts.requestRender?.();
        return;
      }
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = this.list.selected();
      if (item !== undefined) this.opts.onAct(item);
      return;
    }
    const queryEmpty = this.list.view().query.length === 0;
    const ch = printableChar(data);
    // Idle M/P are actions; once a query exists they type into search.
    if (queryEmpty && (ch === 'm' || ch === 'M')) {
      const item = this.list.selected();
      if (item !== undefined) this.opts.onMergePreview?.(item);
      return;
    }
    if (queryEmpty && (ch === 'p' || ch === 'P')) {
      const item = this.list.selected();
      if (item !== undefined) this.opts.onPushPreview?.(item);
      return;
    }
    if (this.list.handleKey(data)) {
      this.opts.requestRender?.();
    }
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const titleSuffix =
      view.query.length === 0
        ? currentTheme.fg('textMuted', ttui('tui.common.typeToSearch'))
        : '';
    const hintParts = [ttui('tui.dialog.inbox.hint')];
    if (view.page.pageCount > 1) hintParts.push(ttui('tui.common.hint.page'));
    const body: string[] = [];
    if (view.query.length > 0) {
      body.push(
        currentTheme.fg('primary', ` ${ttui('tui.common.searchLabel').trimEnd()} `) +
          currentTheme.fg('text', view.query),
      );
    }
    if (view.items.length === 0) {
      body.push(
        currentTheme.fg(
          'textMuted',
          this.items.length === 0
            ? ttui('tui.dialog.inbox.empty')
            : ttui('tui.dialog.inbox.noMatch'),
        ),
      );
    } else {
      for (let i = view.page.start; i < view.page.end; i++) {
        const item = view.items[i];
        if (item === undefined) continue;
        body.push(this.renderRow(item, i === view.selectedIndex, width));
        for (const preview of item.previewLines ?? []) {
          body.push(
            truncateToWidth(
              `    ${currentTheme.fg('warning', preview)}`,
              Math.max(1, width),
              '…',
            ),
          );
        }
      }
    }
    const footer: string[] = [];
    if (view.page.pageCount > 1 && view.page.end < view.items.length) {
      footer.push(
        currentTheme.fg(
          'textMuted',
          `  ▼ ${String(view.items.length - view.page.end)} more`,
        ),
      );
    }
    return renderRendererPanelChromeRows({
      width,
      title: ttui('tui.dialog.inbox.title'),
      titleSuffix,
      hint: ` ${hintParts.join(' · ')}`,
      body,
      footer,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'inbox-drawer:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: '…',
    });
  }

  private createList(
    items: readonly InboxDrawerItem[],
    selectedId?: string,
  ): SearchableList<InboxDrawerItem> {
    const initialIndex = Math.max(
      0,
      selectedId === undefined ? 0 : items.findIndex((item) => item.id === selectedId),
    );
    return new SearchableList({
      items,
      toSearchText: inboxSearchText,
      pageSize: INBOX_PAGE_SIZE,
      searchable: true,
      initialIndex,
    });
  }

  private renderRow(item: InboxDrawerItem, selected: boolean, width: number): string {
    const pointer = selected
      ? renderSelectPointer('inbox-drawer:pointer')
      : ' '.repeat(visibleWidth(SELECT_POINTER));
    const tone = selected ? 'primary' : 'text';
    const badge = rowBadge(item);
    const badgeStyled = currentTheme.fg(badgeTone(item), badge);
    const title = currentTheme.fg(tone, item.title);
    const detail =
      item.detail === undefined || item.detail.length === 0
        ? ''
        : currentTheme.fg('textDim', ` · ${item.detail}`);
    const prefix = `  ${pointer} `;
    const line = `${prefix}${badgeStyled} ${title}${detail}`;
    return truncateToWidth(line, Math.max(1, width), '…');
  }
}

function inboxSearchText(item: InboxDrawerItem): string {
  return [item.title, item.detail, item.jobId, item.kind, item.eventKind]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' ');
}

function rowBadge(item: InboxDrawerItem): string {
  switch (item.kind) {
    case 'approval':
      return ttui('tui.dialog.inbox.badge.approval');
    case 'question':
      return ttui('tui.dialog.inbox.badge.question');
    case 'needs_user':
      return ttui('tui.dialog.inbox.badge.needsUser');
    case 'notice':
      return `[${inboxKindLabel(item.eventKind ?? 'notice')}]`;
  }
}

function badgeTone(item: InboxDrawerItem): 'warning' | 'error' | 'info' | 'textMuted' {
  if (item.kind === 'approval' || item.kind === 'needs_user') return 'warning';
  if (item.kind === 'question') return 'info';
  const kind = item.eventKind ?? '';
  if (kind.includes('failed') || kind.includes('cancelled')) return 'error';
  if (kind.includes('blocked') || kind.includes('interrupted') || kind.includes('needs_user')) {
    return 'warning';
  }
  return 'textMuted';
}
