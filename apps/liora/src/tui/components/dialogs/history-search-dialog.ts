/**
 * HistorySearchDialog — fuzzy-search overlay over the persisted input history.
 *
 * Triggered by Ctrl-R (when the editor is empty). Reuses {@link SearchableList}
 * for fuzzy matching and paging, exactly like ChoicePicker/ModelSelector. On
 * select, the chosen entry's text is injected into the editor; Esc cancels.
 *
 * History entries are loaded lazily by the host via `loadInputHistory()` and
 * passed in as `items`, so this component stays a pure presentational layer.
 */

import {Container, Key, matchesKey, truncateToWidth, visibleWidth, type Focusable} from '#/tui/renderer';
import {renderSelectPointer} from '#/tui/utils/select-pointer';
import {currentTheme} from '#/tui/theme';
import {getActiveAppearancePreferences, renderParticleDivider, renderPremiumHeadline, shouldRenderAmbientEffects} from '#/tui/utils/appearance-effects';
import {ttui} from '#/tui/utils/tui-i18n';
import {SearchableList} from '#/tui/utils/searchable-list';

export interface HistorySearchDialogOptions {
  readonly items: readonly string[];
  readonly onSelect: (text: string) => void;
  readonly onCancel: () => void;
}

export class HistorySearchDialogComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: HistorySearchDialogOptions;
  private readonly list: SearchableList<string>;

  constructor(opts: HistorySearchDialogOptions) {
    super();
    this.opts = opts;
    this.list = new SearchableList({
      items: opts.items,
      toSearchText: (entry) => entry,
      initialIndex: 0,
      searchable: true,
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.list.clearQuery()) return;
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.list.pageDown();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const selected = this.list.selected();
      if (selected !== undefined) this.opts.onSelect(selected);
      return;
    }
    this.list.handleKey(data);
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const items = view.items;
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);

    const title = animated
      ? ` ${renderPremiumHeadline(ttui('tui.history.title'), 'history:title', appearance)}`
      : currentTheme.boldFg('primary', ` ${ttui('tui.history.title')}`);

    const lines: string[] = [
      renderParticleDivider(width, 'history:top', appearance),
      title,
      currentTheme.fg('textMuted', ` ${ttui('tui.history.hint')}`),
    ];

    if (view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ` Search: `) + currentTheme.fg('text', view.query));
    }
    lines.push('');

    if (items.length === 0) {
      const message =
        view.query.length > 0 ? ttui('tui.common.noMatches') : ttui('tui.history.empty');
      lines.push(currentTheme.fg('textMuted', `   ${message}`));
    }

    for (let i = view.page.start; i < view.page.end; i++) {
      const entry = items[i]!;
      const isSelected = i === view.selectedIndex;
      const pointer = isSelected ? renderSelectPointer('history:pointer') : ' ';
      const prefix = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      const maxEntryWidth = Math.max(1, width - 5);
      const displayEntry =
        visibleWidth(entry) <= maxEntryWidth ? entry : truncateToWidth(entry, maxEntryWidth, '…');
      lines.push(prefix + currentTheme.fg(isSelected ? 'primary' : 'text', displayEntry));
    }

    if (view.page.pageCount > 1) {
      lines.push('');
      lines.push(
        currentTheme.fg(
          'textMuted',
          ` Page ${String(view.page.page + 1)}/${String(view.page.pageCount)}`,
        ),
      );
    }

    lines.push(renderParticleDivider(width, 'history:bottom', appearance));
    return lines.map((line) => truncateToWidth(line, width));
  }
}
