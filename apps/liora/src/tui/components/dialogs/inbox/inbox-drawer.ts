/**
 * Conductor Inbox drawer — editor-replacement list of unread job notices
 * plus optional pending approval / question glance rows.
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
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

export class InboxDrawerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: InboxDrawerOptions;
  private items: readonly InboxDrawerItem[];
  private selectedIndex = 0;

  constructor(opts: InboxDrawerOptions) {
    super();
    this.opts = opts;
    this.items = opts.items;
  }

  setItems(items: readonly InboxDrawerItem[]): void {
    this.items = items;
    if (this.selectedIndex >= items.length) {
      this.selectedIndex = Math.max(0, items.length - 1);
    }
    this.opts.requestRender?.();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = this.items[this.selectedIndex];
      if (item !== undefined) this.opts.onAct(item);
      return;
    }
    const ch = printableChar(data);
    if (ch === 'm' || ch === 'M') {
      const item = this.items[this.selectedIndex];
      if (item !== undefined) this.opts.onMergePreview?.(item);
      return;
    }
    if (matchesKey(data, Key.up) || ch === 'k') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down) || ch === 'j') {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    }
  }

  override render(width: number): string[] {
    const hint = ttui('tui.dialog.inbox.hint');
    const body: string[] = [];
    if (this.items.length === 0) {
      body.push(currentTheme.fg('textMuted', ttui('tui.dialog.inbox.empty')));
    } else {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i]!;
        body.push(this.renderRow(item, i === this.selectedIndex, width));
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
    return renderRendererPanelChromeRows({
      width,
      title: ttui('tui.dialog.inbox.title'),
      hint: ` ${hint}`,
      body,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'inbox-drawer:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: '…',
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
