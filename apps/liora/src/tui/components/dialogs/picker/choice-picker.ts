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
import { resolveGridColumns } from '#/tui/utils/ui/grid-nav';

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
  /**
   * Layout: `list` (default 1 column) or `grid` (2–3 columns when wide enough).
   * Grid uses ←→ for horizontal focus; PgUp/PgDn still page.
   */
  readonly layout?: 'list' | 'grid';
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
    // Grid: ←→ move columns. List (1 col): ←→ still page for muscle memory.
    if (matchesKey(data, Key.left)) {
      if (this.list.getColumns() > 1) this.list.moveLeft();
      else this.list.pageUp();
      this.syncHighlight();
      return;
    }
    if (matchesKey(data, Key.right)) {
      if (this.list.getColumns() > 1) this.list.moveRight();
      else this.list.pageDown();
      this.syncHighlight();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      // Multi-column: step a full visual page (rows × columns).
      const stride = this.list.pageStride();
      const view = this.list.view();
      this.list.setSelectedIndex(Math.max(0, view.selectedIndex - stride));
      this.syncHighlight();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      const stride = this.list.pageStride();
      const view = this.list.view();
      this.list.setSelectedIndex(view.selectedIndex + stride);
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
    const viewPre = this.list.view();
    const columns = resolveGridColumns({
      width,
      itemCount: viewPre.items.length,
      preferGrid: this.opts.layout === 'grid',
      minCellWidth: 30,
      maxColumns: 3,
    });
    this.list.setColumns(columns);
    // Page size scales with grid rows so a page still fills the panel.
    const view = this.list.view();
    const options = view.items;
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);

    const navParts = columns > 1 ? ['↑↓←→ navigate'] : ['↑↓ navigate'];
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
    } else if (columns <= 1) {
      for (let i = view.page.start; i < view.page.end; i++) {
        const opt = options[i]!;
        const section = opt.section?.trim() ?? '';
        if (section.length > 0 && section !== lastSection) {
          lastSection = section;
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
        // Soft focus island on list rows (matches grid cell treatment).
        if (isSelected) {
          const pad = Math.max(0, width - visibleWidth(line));
          line = currentTheme.bg('surfaceRaised', line + ' '.repeat(pad));
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
    } else {
      // 2D grid: pack cells into rows of `columns`. Section headers span full width.
      const cellWidth = Math.max(12, Math.floor((width - 2) / columns));
      let i = view.page.start;
      while (i < view.page.end) {
        const opt = options[i]!;
        const section = opt.section?.trim() ?? '';
        if (section.length > 0 && section !== lastSection) {
          lastSection = section;
          lines.push(currentTheme.boldFg('accent', ` ${section}`));
        }
        // Collect one visual row of same-section cells (or until page end).
        const rowCells: number[] = [];
        const rowSection = section;
        while (i < view.page.end && rowCells.length < columns) {
          const cell = options[i]!;
          const cellSection = cell.section?.trim() ?? '';
          if (cellSection !== rowSection && cellSection.length > 0 && rowCells.length > 0) break;
          if (cellSection.length > 0 && cellSection !== lastSection) {
            lastSection = cellSection;
            if (rowCells.length > 0) break;
            lines.push(currentTheme.boldFg('accent', ` ${cellSection}`));
          }
          rowCells.push(i);
          i++;
        }
        const rowLineIndex = lines.length;
        const parts: string[] = [];
        for (const idx of rowCells) {
          itemLineByIndex[idx] = rowLineIndex;
          const cellOpt = options[idx]!;
          const isSelected = idx === view.selectedIndex;
          const isCurrent = cellOpt.value === this.opts.currentValue;
          const pointer = isSelected ? renderSelectPointer('choice:pointer') : ' ';
          const labelStyle = optionLabelStyle(cellOpt, isSelected);
          let cell =
            pointer +
            ' ' +
            (animated && isSelected && cellOpt.tone !== 'danger'
              ? renderAnimatedGradientText(cellOpt.label, `choice:cell:${cellOpt.value}`, appearance)
              : labelStyle(cellOpt.label));
          if (isCurrent) cell += ' ' + currentTheme.fg('success', CURRENT_MARK);
          const padded = truncateToWidth(cell, cellWidth - 1).padEnd(cellWidth - 1, ' ');
          // Selected cell: soft raised surface so the focus island is obvious in a grid.
          parts.push(
            isSelected
              ? currentTheme.bg('surfaceRaised', padded)
              : padded,
          );
        }
        lines.push(' ' + parts.join(''));
      }
      // Selected cell description under the grid (cells themselves stay dense).
      const selectedOpt = options[view.selectedIndex];
      if (selectedOpt?.description !== undefined && selectedOpt.description.length > 0) {
        const descriptionWidth = Math.max(1, width - 4);
        const descriptionColor =
          selectedOpt.descriptionTone !== undefined
            ? selectedOpt.descriptionTone
            : animated
              ? 'accent'
              : 'textMuted';
        for (const descLine of wrapDescription(selectedOpt.description, descriptionWidth)) {
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
