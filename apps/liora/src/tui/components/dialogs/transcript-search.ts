/**
 * TranscriptSearchDialog — fuzzy search over transcript entries (Ctrl-F).
 *
 * Searches the plain-text of each transcript entry and, on Enter, tells the
 * host which entry index matched so it can scroll it into view. The host owns
 * the actual scrolling (via the transcript viewport), so this component stays
 * presentational.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderPremiumHeadline,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { ttui } from '#/tui/utils/tui-i18n';
import { SearchableList } from '#/tui/utils/searchable-list';

export interface TranscriptSearchEntry {
  readonly index: number;
  readonly text: string;
}

export interface TranscriptSearchOptions {
  readonly entries: readonly TranscriptSearchEntry[];
  readonly onSelect: (index: number) => void;
  readonly onCancel: () => void;
}

export class TranscriptSearchDialogComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: TranscriptSearchOptions;
  private readonly list: SearchableList<TranscriptSearchEntry>;

  constructor(opts: TranscriptSearchOptions) {
    super();
    this.opts = opts;
    this.list = new SearchableList({
      items: opts.entries,
      toSearchText: (entry) => entry.text,
      initialIndex: 0,
      searchable: true,
    });
  }

  /** The number of entries matching the current query. */
  matchCount(): number {
    return this.list.filtered().length;
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
      if (selected !== undefined) this.opts.onSelect(selected.index);
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
      ? ` ${renderPremiumHeadline(ttui('tui.search.title'), 'search:title', appearance)}`
      : currentTheme.boldFg('primary', ` ${ttui('tui.search.title')}`);

    const lines: string[] = [
      renderParticleDivider(width, 'search:top', appearance),
      title,
      currentTheme.fg('textMuted', ` ${ttui('tui.search.hint')}`),
    ];

    if (view.query.length > 0) {
      const countLabel =
        items.length > 0
          ? ttui('tui.search.matches', { count: items.length })
          : ttui('tui.search.noMatches');
      lines.push(currentTheme.fg('primary', ` Search: `) + currentTheme.fg('text', view.query));
      lines.push(currentTheme.fg('textMuted', ` ${countLabel}`));
    }
    lines.push('');

    for (let i = view.page.start; i < view.page.end; i++) {
      const entry = items[i]!;
      const isSelected = i === view.selectedIndex;
      const pointer = isSelected ? renderSelectPointer('transcript:pointer') : ' ';
      const prefix = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      const maxTextWidth = Math.max(1, width - 5);
      const displayText =
        visibleWidth(entry.text) <= maxTextWidth
          ? entry.text.replace(/\n/g, ' ')
          : truncateToWidth(entry.text.replace(/\n/g, ' '), maxTextWidth, '…');
      lines.push(prefix + currentTheme.fg(isSelected ? 'primary' : 'text', displayText));
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

    lines.push(renderParticleDivider(width, 'search:bottom', appearance));
    return lines.map((line) => truncateToWidth(line, width));
  }
}
