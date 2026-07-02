/**
 * ChoicePicker — modal single-select list for slash commands that ask
 * the user to pick from a small set of preset values.
 *
 * Mirrors SessionPickerComponent's container-replacement pattern: host
 * calls `showChoicePicker(...)` which clears the editor container,
 * addChild(picker), setFocus(picker); the picker invokes `onSelect` or
 * `onCancel`, and the host tears it down.
 */

import {
  Container,
  matchesKey,
  Key,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderAnimatedGradientText,
  renderParticleDivider,
  renderShimmerPrefix,
  resolveAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';

export interface ChoiceOption {
  /** Value passed to onSelect (e.g. the actual editor command string). */
  readonly value: string;
  /** Display text shown in the list. */
  readonly label: string;
  /** Optional semantic tone for labels that need stronger visual treatment. */
  readonly tone?: 'danger';
  /** Optional explanatory text shown below the label. */
  readonly description?: string | undefined;
  /** Color token applied to the description while this option is selected, drawing
   *  attention to important details. Falls back to `textMuted` when unset or not selected. */
  readonly descriptionTone?: ColorToken;
  /** Hide from the default list, but include in search results and when current. */
  readonly searchOnly?: boolean;
}

export interface ChoicePickerOptions {
  readonly title: string;
  readonly hint?: string;
  readonly formatHint?: (text: string) => string;
  readonly notice?: string;
  /** Color tone for the notice line. Defaults to 'success'. */
  readonly noticeTone?: 'success' | 'warning';
  readonly options: readonly ChoiceOption[];
  readonly currentValue?: string;
  /** When true, typed characters filter the list (fuzzy) and a search line is shown. */
  readonly searchable?: boolean;
  /** Items per page. Lists longer than this paginate. */
  readonly pageSize?: number;
  /** Called when the highlighted option changes. */
  readonly onHighlight?: (value: string) => void;
  /** Optional preview block for the highlighted option. */
  readonly renderPreview?: (option: ChoiceOption, width: number) => readonly string[];
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

function wrapDescription(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, '…');
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

export class ChoicePickerComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ChoicePickerOptions;
  private readonly list: SearchableList<ChoiceOption>;
  private highlightedValue: string | undefined;

  constructor(opts: ChoicePickerOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.options
      .filter((o) => choiceOptionVisible(o, '', opts.currentValue))
      .findIndex((o) => o.value === opts.currentValue);
    this.list = new SearchableList({
      items: opts.options,
      toSearchText: (o) => `${o.label} ${o.description ?? ''}`,
      isVisible: (o, query) => choiceOptionVisible(o, query, opts.currentValue),
      pageSize: opts.pageSize,
      initialIndex: Math.max(currentIdx, 0),
      searchable: opts.searchable === true,
    });
    this.syncHighlight();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.list.clearQuery()) {
        this.syncHighlight();
        return;
      }
      this.opts.onCancel();
      return;
    }
    // Left/Right page through the list (this picker has no horizontal control).
    if (matchesKey(data, Key.left)) {
      this.list.pageUp();
      this.syncHighlight();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.list.pageDown();
      this.syncHighlight();
      return;
    }
    // Enter always selects. Space selects too — but only when the list is not
    // searchable; in a searchable list a space must reach the query instead.
    const isSpace = matchesKey(data, Key.space) || printableChar(data) === ' ';
    if (matchesKey(data, Key.enter) || (isSpace && this.opts.searchable !== true)) {
      const chosen = this.list.selected();
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
      return;
    }
    if (this.list.handleKey(data)) this.syncHighlight();
  }

  override render(width: number): string[] {
    const searchable = this.opts.searchable === true;
    const view = this.list.view();
    const options = view.items;
    const appearance = getActiveAppearancePreferences();
    const premium =
      shouldRenderAmbientEffects(appearance) && resolveAmbientEffectMode(appearance) === 'premium';

    // Header mirrors the model dialog (see model-selector.ts): border, title
    // with a "(type to search)" suffix until you type, the hint, a blank, then
    // the search line. Key vocabulary is lowercase to match every list dialog.
    const navParts = ['↑↓ navigate'];
    if (view.page.pageCount > 1) navParts.push('←→ page');
    navParts.push('Enter select', 'Esc cancel');
    const hint = this.opts.hint ?? navParts.join(' · ');

    const titleSuffix =
      searchable && view.query.length === 0
        ? currentTheme.fg('textMuted', '  (type to search)')
        : '';
    const hintLines = hint.split(/\r?\n/);
    const title = premium
      ? renderAnimatedGradientText(
          ` ${this.opts.title}`,
          `choice:title:${this.opts.title}`,
          appearance,
        )
      : currentTheme.boldFg('primary', ` ${this.opts.title}`);
    const lines: string[] = [
      renderParticleDivider(width, `choice:top:${this.opts.title}`, appearance),
      title + titleSuffix,
    ];
    for (const hintLine of hintLines) {
      lines.push(
        this.opts.formatHint === undefined
          ? currentTheme.fg('textMuted', ` ${hintLine}`)
          : this.opts.formatHint(` ${hintLine}`),
      );
    }
    if (this.opts.notice !== undefined) {
      const tone = this.opts.noticeTone ?? 'success';
      const noticeWidth = Math.max(1, width - 1);
      for (const noticeLine of this.opts.notice.split(/\r?\n/)) {
        for (const wrapped of wrapDescription(noticeLine, noticeWidth)) {
          lines.push(currentTheme.fg(tone, ` ${wrapped}`));
        }
      }
    }
    lines.push('');
    if (searchable && view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ` Search: `) + currentTheme.fg('text', view.query));
    }

    if (options.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No matches'));
    }
    for (let i = view.page.start; i < view.page.end; i++) {
      const opt = options[i]!;
      const isSelected = i === view.selectedIndex;
      const isCurrent = opt.value === this.opts.currentValue;
      const pointer = isSelected ? SELECT_POINTER : ' ';
      const labelStyle = optionLabelStyle(opt, isSelected);
      const pulse = premium && isSelected ? renderShimmerPrefix(appearance) : '';
      let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pulse}${pointer} `);
      line += premium && isSelected && opt.tone !== 'danger'
        ? renderAnimatedGradientText(opt.label, `choice:row:${opt.value}`, appearance)
        : labelStyle(opt.label);
      if (isCurrent) {
        line += ' ' + currentTheme.fg('success', CURRENT_MARK);
      }
      lines.push(line);
      if (opt.description !== undefined && opt.description.length > 0) {
        const descriptionWidth = Math.max(1, width - 4);
        const descriptionColor =
          isSelected && opt.descriptionTone !== undefined
            ? opt.descriptionTone
            : premium && isSelected
              ? 'accent'
              : 'textMuted';
        for (const descLine of wrapDescription(opt.description, descriptionWidth)) {
          lines.push(currentTheme.fg(descriptionColor, `    ${descLine}`));
        }
      }
    }

    lines.push('');
    if (view.page.pageCount > 1) {
      lines.push(
        currentTheme.fg('textMuted',
          ` Page ${String(view.page.page + 1)}/${String(view.page.pageCount)}`,
        ),
      );
    }
    const selected = options[view.selectedIndex];
    if (selected !== undefined && this.opts.renderPreview !== undefined) {
      lines.push('');
      for (const previewLine of this.opts.renderPreview(selected, width)) {
        lines.push(previewLine);
      }
    }
    lines.push(renderParticleDivider(width, `choice:bottom:${this.opts.title}`, appearance));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private syncHighlight(): void {
    const selected = this.list.selected();
    if (selected === undefined || selected.value === this.highlightedValue) return;
    this.highlightedValue = selected.value;
    this.opts.onHighlight?.(selected.value);
  }
}

function choiceOptionVisible(
  option: ChoiceOption,
  query: string,
  currentValue: string | undefined,
): boolean {
  return option.searchOnly !== true || query.length > 0 || option.value === currentValue;
}

function optionLabelStyle(
  option: ChoiceOption,
  selected: boolean,
): (text: string) => string {
  if (option.tone === 'danger') {
    return selected
      ? (text) => currentTheme.boldFg('error', text)
      : (text) => currentTheme.fg('error', text);
  }
  return selected
    ? (text) => currentTheme.boldFg('primary', text)
    : (text) => currentTheme.fg('text', text);
}
