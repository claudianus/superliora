/**
 * ProviderCatalogPickerComponent — the unified "connect a provider" picker.
 *
 * Replaces the old split between `/login` (hardcoded platform selector) and
 * `/provider`'s 3-way choice picker. One searchable list merges:
 *   - the managed SuperLiora (Kimi OAuth) account,
 *   - every models.dev catalog provider with an inferable wire type,
 *   - and the custom endpoint / custom registry escape hatches.
 *
 * Each row shows the provider name plus an auth-kind badge and model count;
 * a hint line below the highlighted row surfaces the base URL or the env var
 * that carries the API key, so the user knows exactly where to get a key.
 *
 * Layout and key bindings follow PREMIUM.md § List dialogs (mirrors
 * `ModelSelectorComponent`): two full-width borders, title + `(type to
 * search)` suffix, hint, search line, list, scroll indicator.
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

import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';
import { SearchableList } from '#/tui/utils/searchable-list';
import {
  type ProviderCatalogOption,
  type ProviderAuthKind,
  type ProviderCatalogSelection,
  resolveProviderSelection,
} from '#/tui/utils/provider-catalog-options';

const AUTH_BADGE: ReadonlyMap<ProviderAuthKind, string> = new Map<ProviderAuthKind, string>([
  ['oauth', 'OAuth'],
  ['api-key', 'API key'],
  ['keyless', 'no key'],
  ['cloud', 'cloud'],
  ['custom', 'custom'],
]);

const AUTH_TONE: ReadonlyMap<ProviderAuthKind, ColorToken> = new Map<ProviderAuthKind, ColorToken>([
  ['oauth', 'success'],
  ['api-key', 'accent'],
  ['keyless', 'textMuted'],
  ['cloud', 'accent'],
  ['custom', 'warning'],
]);

export interface ProviderCatalogPickerResult {
  readonly selection: ProviderCatalogSelection;
}

/**
 * @param options.catalog merged provider list (see {@link buildProviderCatalogOptions}).
 * @param options.currentValue the currently-connected provider value, marked with CURRENT_MARK.
 */
export interface ProviderCatalogPickerComponentOptions {
  readonly options: readonly ProviderCatalogOption[];
  readonly currentValue?: string;
  readonly onSelect: (result: ProviderCatalogPickerResult) => void;
  readonly onCancel: () => void;
}

export class ProviderCatalogPickerComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ProviderCatalogPickerComponentOptions;
  private readonly list: SearchableList<ProviderCatalogOption>;

  constructor(opts: ProviderCatalogPickerComponentOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.options.findIndex((o) => o.value === opts.currentValue);
    this.list = new SearchableList({
      items: opts.options,
      toSearchText: (option) => `${option.label} ${option.catalogId ?? ''} ${option.baseUrl ?? ''} ${(option.envVars ?? []).join(' ')}`,
      initialIndex: Math.max(currentIdx, 0),
      searchable: true,
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.list.clearQuery()) return;
      this.opts.onCancel();
      return;
    }

    // ←/→ page through the list (no horizontal value control here).
    if (matchesKey(data, Key.left)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.list.pageDown();
      return;
    }

    if (this.list.handleKey(data)) return;

    if (matchesKey(data, Key.enter)) {
      const selected = this.list.selected();
      if (selected === undefined) return;
      this.opts.onSelect({ selection: resolveProviderSelection(selected.value) });
      return;
    }
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const totalCount = this.opts.options.length;

    const titleSuffix =
      view.query.length === 0
        ? currentTheme.fg('textMuted', '  (type to search)')
        : '';

    const hintParts: string[] = ['↑↓ navigate'];
    if (view.page.pageCount > 1) hintParts.push('←→ page');
    hintParts.push('Enter select', 'Esc cancel');

    const body: string[] = [];

    if (view.query.length > 0) {
      body.push(currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query));
    }

    if (view.items.length === 0) {
      body.push(currentTheme.fg('textMuted', '   No matches'));
    } else {
      const nameCap = Math.max(12, Math.floor(width * 0.5));
      let nameWidth = 0;
      for (let i = view.page.start; i < view.page.end; i++) {
        const option = view.items[i];
        if (option !== undefined) nameWidth = Math.max(nameWidth, visibleWidth(option.label));
      }
      nameWidth = Math.min(nameWidth, nameCap);

      for (let i = view.page.start; i < view.page.end; i++) {
        const option = view.items[i];
        if (option === undefined) continue;
        const isSelected = i === view.selectedIndex;
        const isCurrent = option.value === this.opts.currentValue;
        body.push(...renderProviderRow(option, { isSelected, isCurrent, width, nameWidth }));
      }
    }

    const footer: string[] = [];
    if (view.query.length > 0) {
      footer.push(
        currentTheme.fg('textMuted', ` ${String(view.items.length)} / ${String(totalCount)}`),
      );
    } else {
      const below = view.items.length - view.page.end;
      if (below > 0) footer.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
    }

    const selected = this.list.selected();
    if (selected !== undefined) {
      if (footer.length > 0) footer.push('');
      for (const line of renderProviderDetail(selected, width)) {
        footer.push(line);
      }
      footer.push('');
    } else {
      footer.push('');
    }

    return renderRendererPanelChromeRows({
      width,
      title: ' Connect a provider',
      titleSuffix,
      hint: ' ' + hintParts.join(' · '),
      body,
      footer,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'provider-picker:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
    });
  }
}

function renderProviderRow(
  option: ProviderCatalogOption,
  ctx: { isSelected: boolean; isCurrent: boolean; width: number; nameWidth: number },
): string[] {
  const { isSelected, isCurrent, nameWidth } = ctx;
  const pointer = isSelected ? SELECT_POINTER : ' ';
  const truncatedName = truncateToWidth(option.label, nameWidth, '…');
  const namePad = ' '.repeat(Math.max(0, nameWidth - visibleWidth(truncatedName)));

  const badge = AUTH_BADGE.get(option.authKind) ?? option.authKind;
  const badgeTone = AUTH_TONE.get(option.authKind) ?? 'textMuted';

  let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
  line += (isSelected ? currentTheme.boldFg('primary', truncatedName) : currentTheme.fg('text', truncatedName)) + namePad;
  line += '  ' + currentTheme.fg(badgeTone, badge);
  if (option.modelCount > 0) {
    line += '  ' + currentTheme.fg('textMuted', `${String(option.modelCount)} models`);
  }
  if (isCurrent) line += ' ' + currentTheme.fg('success', CURRENT_MARK);

  return [truncateToWidth(line, ctx.width)];
}

function renderProviderDetail(option: ProviderCatalogOption, width: number): string[] {
  const lines: string[] = [];
  if (option.baseUrl !== undefined && option.baseUrl.length > 0) {
    lines.push(currentTheme.fg('textMuted', ` ${truncateToWidth(option.baseUrl, width - 1, '…')}`));
  }
  if (option.envVars !== undefined && option.envVars.length > 0) {
    const hint = ` env: ${option.envVars.join(', ')}`;
    lines.push(currentTheme.fg('textMuted', truncateToWidth(hint, width - 1, '…')));
  }
  if (option.docUrl !== undefined && option.docUrl.length > 0) {
    lines.push(currentTheme.fg('accent', ` ${truncateToWidth(option.docUrl, width - 1, '…')}`));
  }
  return lines;
}
