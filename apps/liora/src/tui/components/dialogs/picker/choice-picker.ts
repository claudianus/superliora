/**
 * ChoicePicker — modal single-select list for slash commands that ask
 * the user to pick from a small set of preset values.
 *
 * PREMIUM.md list dialog grammar + section headers + mouse (wheel + click).
 */

import {
  Container,
  matchesKey,
  Key,
  truncateToWidth,
  visibleWidth,
  type Focusable,
  type NativeInputEvent,
} from '#/tui/renderer';
import { CURRENT_MARK } from '#/tui/constant/symbols';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderAnimatedGradientText,
  renderParticleDivider,
  renderPremiumHeadline,
  renderShimmerPrefix,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { ttui } from '#/tui/utils/tui-i18n';
import { SearchableList } from '#/tui/utils/ui/searchable-list';
import {
  resolveCenterListMouse,
  type CenterListMouseLayout,
} from '#/tui/utils/ui/list-dialog-mouse';

export interface ChoiceOption {
  /** Value passed to onSelect (e.g. the actual editor command string). */
  readonly value: string;
  /** Display text shown in the list. */
  readonly label: string;
  /** Optional group header (rendered once above contiguous rows). */
  readonly section?: string;
  /** Optional semantic tone for labels that need stronger visual treatment. */
  readonly tone?: 'danger';
  /** Optional explanatory text shown below the label. */
  readonly description?: string | undefined;
  /** Color token applied to the description while this option is selected. */
  readonly descriptionTone?: ColorToken;
  /** Hide from the default list, but include in search results and when current. */
  readonly searchOnly?: boolean;
  /** Extra fuzzy-search tokens; never rendered. */
  readonly keywords?: readonly string[];
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
  private mouseLayout: CenterListMouseLayout | undefined;
  /** Lines stacked above this panel in center-modal overlay (breadcrumb). */
  private crumbLines = 0;

  constructor(opts: ChoicePickerOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.options
      .filter((o) => choiceOptionVisible(o, '', opts.currentValue))
      .findIndex((o) => o.value === opts.currentValue);
    this.list = new SearchableList({
      items: opts.options,
      toSearchText: (o) =>
        `${o.label} ${o.description ?? ''} ${o.section ?? ''} ${(o.keywords ?? []).join(' ')}`,
      isVisible: (o, query) => choiceOptionVisible(o, query, opts.currentValue),
      pageSize: opts.pageSize ?? 12,
      initialIndex: Math.max(currentIdx, 0),
      searchable: opts.searchable === true,
    });
    this.syncHighlight();
  }

  /** Center-modal breadcrumb offset for click hit-testing. */
  setCrumbLines(count: number): void {
    this.crumbLines = Math.max(0, count);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.list.clearQuery()) {
        this.syncHighlight();
        return;
      }
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.pageUp)) {
      this.list.pageUp();
      this.syncHighlight();
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.pageDown)) {
      this.list.pageDown();
      this.syncHighlight();
      return;
    }
    const isSpace = matchesKey(data, Key.space) || printableChar(data) === ' ';
    if (matchesKey(data, Key.enter) || (isSpace && this.opts.searchable !== true)) {
      const chosen = this.list.selected();
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
      return;
    }
    if (this.list.handleKey(data)) this.syncHighlight();
  }

  /** Mouse: wheel navigates, click highlights / second-click selects. */
  handleNativeInput(event: NativeInputEvent): boolean {
    const view = this.list.view();
    const action = resolveCenterListMouse(event, this.mouseLayout, view.selectedIndex);
    if (action.type === 'none') return false;
    if (action.type === 'move') {
      if (action.delta < 0) this.list.moveUp();
      else this.list.moveDown();
      this.syncHighlight();
      return true;
    }
    if (action.type === 'highlight') {
      this.list.setSelectedIndex(action.index);
      this.syncHighlight();
      return true;
    }
    if (action.type === 'activate') {
      this.list.setSelectedIndex(action.index);
      const chosen = this.list.selected();
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
      return true;
    }
    return false;
  }

  override render(width: number): string[] {
    const searchable = this.opts.searchable === true;
    const view = this.list.view();
    const options = view.items;
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);

    const navParts = ['↑↓ navigate'];
    if (view.page.pageCount > 1) navParts.push('PgUp/PgDn page');
    navParts.push('Enter select', 'wheel scroll', 'click select', 'Esc cancel');
    const hint = this.opts.hint ?? navParts.join(' · ');

    const titleSuffix =
      searchable && view.query.length === 0
        ? currentTheme.fg('textMuted', ttui('tui.common.typeToSearch'))
        : '';
    const hintLines = hint.split(/\r?\n/);
    const title = animated
      ? ` ${renderPremiumHeadline(this.opts.title, `choice:title:${this.opts.title}`, appearance)}`
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

    const itemLineByIndex: number[] = new Array(options.length).fill(-1);
    let lastSection = '';

    if (options.length === 0) {
      lines.push(currentTheme.fg('textMuted', `   ${ttui('tui.common.noMatches')}`));
    }
    for (let i = view.page.start; i < view.page.end; i++) {
      const opt = options[i]!;
      const section = opt.section?.trim() ?? '';
      if (section.length > 0 && section !== lastSection) {
        lastSection = section;
        if (i > view.page.start || lines[lines.length - 1] !== '') {
          // subtle gap between groups when not first
        }
        lines.push(currentTheme.boldFg('accent', ` ${section}`));
      }
      const isSelected = i === view.selectedIndex;
      const isCurrent = opt.value === this.opts.currentValue;
      itemLineByIndex[i] = lines.length;
      const pointer = isSelected ? renderSelectPointer('choice:pointer') : ' ';
      const labelStyle = optionLabelStyle(opt, isSelected);
      const pulse = animated && isSelected ? renderShimmerPrefix(appearance) : '';
      let line =
        currentTheme.fg(isSelected ? 'primary' : 'textDim', '  ') +
        pulse +
        pointer +
        currentTheme.fg(isSelected ? 'primary' : 'textDim', ' ');
      line +=
        animated && isSelected && opt.tone !== 'danger'
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
            : animated && isSelected
              ? 'accent'
              : 'textMuted';
        for (const descLine of wrapDescription(opt.description, descriptionWidth)) {
          lines.push(currentTheme.fg(descriptionColor, `    ${descLine}`));
        }
      }
    }

    lines.push('');
    if (view.page.pageCount > 1) {
      const hiddenAbove = view.page.start;
      const hiddenBelow = Math.max(0, options.length - view.page.end);
      const parts: string[] = [
        `Page ${String(view.page.page + 1)}/${String(view.page.pageCount)}`,
      ];
      if (hiddenBelow > 0) parts.push(`▼ ${String(hiddenBelow)} more`);
      if (hiddenAbove > 0) parts.push(`▲ ${String(hiddenAbove)} above`);
      lines.push(currentTheme.fg('textMuted', ` ${parts.join(' · ')}`));
    }
    const selected = options[view.selectedIndex];
    if (selected !== undefined && this.opts.renderPreview !== undefined) {
      lines.push('');
      for (const previewLine of this.opts.renderPreview(selected, width)) {
        lines.push(previewLine);
      }
    }
    lines.push(renderParticleDivider(width, `choice:bottom:${this.opts.title}`, appearance));

    const out = lines.map((line) => truncateToWidth(line, width));
    this.mouseLayout = {
      panelLineCount: out.length,
      panelWidth: width,
      itemLineByIndex,
      crumbLines: this.crumbLines,
    };
    return out;
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
