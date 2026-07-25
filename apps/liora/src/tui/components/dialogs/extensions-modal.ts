/**
 * ExtensionsModal — single audit surface for plugins / hooks / skills / MCP.
 *
 * Product job: operator answers "what is installed and is it on?" without
 * bouncing across /plugins /mcp /skills. Not a generic settings dashboard.
 *
 * Tabs (fixed): 플러그인 · 훅 · 스킬 · MCP
 * Enter opens deep-link action; Tab cycles tabs; Esc closes.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { renderTabStrip } from '#/tui/utils/tab-strip';
import {
  EXTENSIONS_TAB_LABELS_KO,
  EXTENSIONS_TAB_ORDER,
  extensionsTabSummary,
  rowsForExtensionsTab,
  type ExtensionsRow,
  type ExtensionsSnapshot,
  type ExtensionsTabId,
} from '#/tui/utils/extensions-rows';

const ELLIPSIS = '…';

export type ExtensionsModalAction =
  | { readonly kind: 'open-plugins' }
  | { readonly kind: 'open-mcp' }
  | { readonly kind: 'import-claude' }
  | { readonly kind: 'activate-skill'; readonly skillName: string }
  | { readonly kind: 'noop' };

export interface ExtensionsModalOptions {
  readonly snapshot: ExtensionsSnapshot;
  readonly initialTab?: ExtensionsTabId;
  readonly loading?: boolean;
  readonly onAction: (action: ExtensionsModalAction) => void;
  readonly onCancel: () => void;
}

export class ExtensionsModalComponent extends Container implements Focusable {
  focused = false;

  private readonly snapshot: ExtensionsSnapshot;
  private readonly onAction: (action: ExtensionsModalAction) => void;
  private readonly onCancel: () => void;
  private readonly loading: boolean;

  private activeTabIndex: number;
  private selectedIndex = 0;

  constructor(opts: ExtensionsModalOptions) {
    super();
    this.snapshot = opts.snapshot;
    this.onAction = opts.onAction;
    this.onCancel = opts.onCancel;
    this.loading = opts.loading === true;
    const initial = opts.initialTab ?? 'plugins';
    this.activeTabIndex = Math.max(
      0,
      EXTENSIONS_TAB_ORDER.findIndex((tab) => tab === initial),
    );
  }

  private get activeTab(): ExtensionsTabId {
    return EXTENSIONS_TAB_ORDER[this.activeTabIndex] ?? 'plugins';
  }

  private rows(): readonly ExtensionsRow[] {
    return rowsForExtensionsTab(this.activeTab, this.snapshot);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.activeTabIndex = (this.activeTabIndex + 1) % EXTENSIONS_TAB_ORDER.length;
      this.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, Key.shift('tab'))) {
      this.activeTabIndex =
        (this.activeTabIndex - 1 + EXTENSIONS_TAB_ORDER.length) % EXTENSIONS_TAB_ORDER.length;
      this.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.activeTabIndex =
        (this.activeTabIndex - 1 + EXTENSIONS_TAB_ORDER.length) % EXTENSIONS_TAB_ORDER.length;
      this.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.activeTabIndex = (this.activeTabIndex + 1) % EXTENSIONS_TAB_ORDER.length;
      this.selectedIndex = 0;
      return;
    }

    const rows = this.rows();
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      if (rows.length === 0) return;
      this.selectedIndex = (this.selectedIndex - 1 + rows.length) % rows.length;
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      if (rows.length === 0) return;
      this.selectedIndex = (this.selectedIndex + 1) % rows.length;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.dispatchSelection();
      return;
    }
    // i = Claude import shortcut (onboarding surface inside extensions).
    if (data === 'i' || data === 'I') {
      this.onAction({ kind: 'import-claude' });
    }
  }

  private dispatchSelection(): void {
    const row = this.rows()[this.selectedIndex];
    if (row === undefined) {
      this.onAction({ kind: 'noop' });
      return;
    }
    switch (this.activeTab) {
      case 'plugins':
      case 'hooks':
        this.onAction({ kind: 'open-plugins' });
        return;
      case 'mcp':
        this.onAction({ kind: 'open-mcp' });
        return;
      case 'skills': {
        if (row.id.startsWith('skill:')) {
          this.onAction({ kind: 'activate-skill', skillName: row.id.slice('skill:'.length) });
        } else {
          this.onAction({ kind: 'noop' });
        }
        return;
      }
    }
  }

  override render(width: number): string[] {
    return this.renderLines(width).map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderLines(width: number): string[] {
    const title = '확장 기능';
    const summary = extensionsTabSummary(this.snapshot);
    const colors = currentTheme.palette;
    const tabLabels = EXTENSIONS_TAB_ORDER.map((id) => EXTENSIONS_TAB_LABELS_KO[id]);
    const strip = renderTabStrip({
      labels: tabLabels,
      activeIndex: this.activeTabIndex,
      width: Math.max(20, width - 2),
      colors,
    });

    if (this.loading) {
      return this.renderChrome(width, {
        title,
        titleSuffix: currentTheme.fg('textMuted', `  ${summary}`),
        hint: '불러오는 중…',
        body: [strip, '', currentTheme.fg('textMuted', '확장 목록을 불러오는 중…')],
      });
    }

    const rows = this.rows();
    const body: string[] = [strip, ''];
    body.push(
      currentTheme.fg(
        'textDim',
        `${EXTENSIONS_TAB_LABELS_KO[this.activeTab]} · 설치/활성 상태를 한 화면에서 감사`,
      ),
    );
    body.push('');

    if (rows.length === 0) {
      body.push(currentTheme.fg('textMuted', '표시할 항목이 없습니다.'));
    } else {
      const maxVisible = 10;
      const start = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(maxVisible / 2), Math.max(0, rows.length - maxVisible)),
      );
      const visible = rows.slice(start, start + maxVisible);
      for (let i = 0; i < visible.length; i++) {
        const row = visible[i]!;
        const index = start + i;
        const selected = index === this.selectedIndex;
        const pointer = selected ? renderSelectPointer('extensions:pointer') : ' ';
        const titleStyle = selected
          ? (t: string) => currentTheme.boldFg('primary', t)
          : (t: string) => currentTheme.fg('text', t);
        const statusColor =
          row.status === '활성' || row.status === '연결됨'
            ? 'success'
            : row.status === '실패' || row.status === '오류'
              ? 'error'
              : 'textMuted';
        body.push(
          ` ${pointer} ${titleStyle(row.title)}  ${currentTheme.fg(statusColor, `[${row.status}]`)}`,
        );
        if (row.detail.length > 0) {
          body.push(`    ${currentTheme.fg('textDim', row.detail)}`);
        }
      }
    }

    body.push('');
    body.push(
      currentTheme.fg(
        'textMuted',
        'Tab 탭 · ↑↓ 이동 · Enter 열기 · i Claude 가져오기 · Esc 닫기',
      ),
    );

    return this.renderChrome(width, {
      title,
      titleSuffix: currentTheme.fg('textMuted', `  ${summary}`),
      hint: '플러그인 · 훅 · 스킬 · MCP',
      body,
    });
  }

  private renderChrome(
    width: number,
    options: {
      readonly title: string;
      readonly titleSuffix?: string;
      readonly hint?: string;
      readonly body?: readonly string[];
    },
  ): string[] {
    return renderRendererPanelChromeRows({
      width,
      title: options.title,
      titleSuffix: options.titleSuffix,
      hint: options.hint,
      body: options.body,
      footerTopGap: false,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'extensions-modal:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: ELLIPSIS,
    });
  }
}
