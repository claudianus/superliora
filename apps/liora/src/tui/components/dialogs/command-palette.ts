/**
 * CommandPalette — unified fuzzy-search omnibox (Ctrl-Space).
 *
 * Merges slash commands, skills, and a small set of session actions into one
 * searchable list. Reuses {@link SearchableList} like the other pickers. On
 * select, the host receives either a slash-command name (executed as `/<name>`)
 * or an action id (handled by the host directly).
 */

import {Container, Key, matchesKey, truncateToWidth, visibleWidth, type Focusable} from '#/tui/renderer';
import {renderSelectPointer} from '#/tui/utils/select-pointer';
import {currentTheme} from '#/tui/theme';
import {getActiveAppearancePreferences, renderParticleDivider, renderPremiumHeadline, shouldRenderAmbientEffects} from '#/tui/utils/appearance-effects';
import {ttui} from '#/tui/utils/tui-i18n';
import {SearchableList} from '#/tui/utils/searchable-list';

export type PaletteEntryKind = 'command' | 'skill' | 'action';

export interface PaletteEntry {
  readonly kind: PaletteEntryKind;
  /** The value the host acts on: a slash command name, skill id, or action id. */
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface CommandPaletteOptions {
  readonly entries: readonly PaletteEntry[];
  readonly onSelect: (entry: PaletteEntry) => void;
  readonly onCancel: () => void;
}

const CATEGORY_LABEL: Readonly<Record<PaletteEntryKind, string>> = {
  command: ttui('tui.palette.category.commands'),
  skill: ttui('tui.palette.category.skills'),
  action: ttui('tui.palette.category.actions'),
};

export class CommandPaletteComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: CommandPaletteOptions;
  private readonly list: SearchableList<PaletteEntry>;

  constructor(opts: CommandPaletteOptions) {
    super();
    this.opts = opts;
    this.list = new SearchableList({
      items: opts.entries,
      toSearchText: (entry) => `${entry.label} ${entry.description ?? ''} ${entry.value}`,
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
      ? ` ${renderPremiumHeadline(ttui('tui.palette.title'), 'palette:title', appearance)}`
      : currentTheme.boldFg('primary', ` ${ttui('tui.palette.title')}`);

    const lines: string[] = [
      renderParticleDivider(width, 'palette:top', appearance),
      title,
      currentTheme.fg('textMuted', ` ${ttui('tui.palette.hint')}`),
    ];

    if (view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ` Search: `) + currentTheme.fg('text', view.query));
    }
    lines.push('');

    if (items.length === 0) {
      lines.push(currentTheme.fg('textMuted', `   ${ttui('tui.common.noMatches')}`));
    }

    for (let i = view.page.start; i < view.page.end; i++) {
      const entry = items[i]!;
      const isSelected = i === view.selectedIndex;
      const pointer = isSelected ? renderSelectPointer('palette:pointer') : ' ';
      const category = currentTheme.fg('accent', CATEGORY_LABEL[entry.kind]);
      const prefix = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      const label = currentTheme.fg(isSelected ? 'primary' : 'text', entry.label);
      const maxDescWidth = Math.max(1, width - 5 - visibleWidth(entry.label) - visibleWidth(CATEGORY_LABEL[entry.kind]) - 3);
      const desc =
        entry.description !== undefined && entry.description.length > 0
          ? visibleWidth(entry.description) <= maxDescWidth
            ? entry.description
            : truncateToWidth(entry.description, maxDescWidth, '…')
          : '';
      const descColored = desc.length > 0 ? currentTheme.fg('textMuted', `  ${desc}`) : '';
      lines.push(`${prefix}${label} ${category}${descColored}`);
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

    lines.push(renderParticleDivider(width, 'palette:bottom', appearance));
    return lines.map((line) => truncateToWidth(line, width));
  }
}
