/**
 * Command Hub component — wide center modal with status strip, search, and 2-pane idle nav.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
  type NativeInputEvent,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderPremiumBoxFrame,
  renderPremiumHeadline,
  renderPulseText,
  renderSettleFlash,
  renderShimmerPrefix,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import {
  resolveCenterListMouse,
  type CenterListMouseLayout,
} from '#/tui/utils/ui/list-dialog-mouse';
import {
  gridMoveDown,
  gridMoveLeft,
  gridMoveRight,
  gridMoveUp,
  resolveGridColumns,
} from '#/tui/utils/ui/grid-nav';

import {
  COMMAND_HUB_PAGE_SIZE,
  HUB_ENTRY_MIN_RATIO,
  HUB_ENTRY_MS,
  HUB_SLIDE_MS,
  hubClamp01,
  hubEaseOutCubic,
} from './command-hub-animation';
import { filterHubItems } from './command-hub-filter';
import {
  HUB_CATEGORY_COL_WIDTH,
  hubCategories,
  hubItemsInCategory,
  hubPreferTwoPane,
} from './command-hub-panes';
import type {
  CommandHubActionId,
  CommandHubItem,
  CommandHubOptions,
  CommandHubSelectMode,
} from './command-hub-types';

type HubFocusPane = 'categories' | 'items';

export class CommandHubComponent extends Container implements Focusable {
  focused = false;

  private items: readonly CommandHubItem[];
  private readonly onSelect: (item: CommandHubItem, mode: CommandHubSelectMode) => void;
  private readonly onCancel: () => void;
  private readonly onIntroDismiss: (() => void) | undefined;
  private readonly title: string;
  private filtered: CommandHubItem[];
  private selectedIndex = 0;
  private query = '';
  private intro: boolean;
  private readonly openedAtMs = appearanceAnimationNow();
  private flashId: string | null = null;
  private flashAtMs = 0;
  /** Last selection move — drives the pointer slide-in micro-interaction. */
  private selectionMovedAtMs = 0;
  private mouseLayout: CenterListMouseLayout | undefined;
  private crumbLines = 0;
  /** Grid columns for item pane / search results (1 = list). */
  private gridColumns = 1;
  /** Idle two-pane: which side has focus. */
  private focusPane: HubFocusPane = 'items';
  private categoryIndex = 0;
  private twoPane = false;

  constructor(opts: CommandHubOptions) {
    super();
    this.items = opts.items;
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.onIntroDismiss = opts.onIntroDismiss;
    this.title = opts.title ?? 'Command Hub';
    this.query = opts.initialQuery ?? '';
    this.intro = opts.intro === true;
    this.filtered = filterHubItems(this.items, this.query);
    this.syncCategoryFromSelection();
  }

  /** Live-refresh badges / Now section while Hub stays open. */
  setItems(items: readonly CommandHubItem[]): void {
    const selectedId = this.visibleItems()[this.selectedIndex]?.id;
    this.items = items;
    this.filtered = filterHubItems(this.items, this.query);
    this.syncCategoryFromSelection(selectedId);
    this.invalidate();
  }

  /** Trigger settle-flash on a toggled row. */
  noteToggleFlash(id: CommandHubActionId): void {
    this.flashId = id;
    this.flashAtMs = appearanceAnimationNow();
    this.invalidate();
  }

  dismissIntro(): void {
    if (!this.intro) return;
    this.intro = false;
    this.onIntroDismiss?.();
    this.invalidate();
  }

  /** Center-modal breadcrumb offset for click hit-testing. */
  setCrumbLines(count: number): void {
    this.crumbLines = Math.max(0, count);
  }

  handleNativeInput(event: NativeInputEvent): boolean {
    const action = resolveCenterListMouse(event, this.mouseLayout, this.selectedIndex);
    if (action.type === 'none') return false;
    if (action.type === 'move') {
      this.moveItemSelection(this.selectedIndex + action.delta);
      return true;
    }
    if (action.type === 'highlight') {
      this.focusPane = 'items';
      this.moveItemSelection(action.index);
      return true;
    }
    if (action.type === 'activate') {
      this.focusPane = 'items';
      this.moveItemSelection(action.index);
      this.activate('enter');
      return true;
    }
    return false;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.intro) {
        this.dismissIntro();
        return;
      }
      if (this.query.length > 0) {
        this.query = '';
        this.refilter();
        return;
      }
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (this.twoPane && this.focusPane === 'categories') {
        this.focusPane = 'items';
        this.selectedIndex = 0;
        this.invalidate();
        return;
      }
      this.activate('enter');
      return;
    }
    if (matchesKey(data, Key.space) || printableChar(data) === ' ') {
      if (this.twoPane && this.focusPane === 'categories') {
        this.focusPane = 'items';
        this.invalidate();
        return;
      }
      this.activate('space');
      return;
    }

    if (this.twoPane && this.focusPane === 'categories') {
      this.handleCategoryKeys(data);
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      if (this.gridColumns > 1) {
        this.moveItemSelection(
          gridMoveUp({
            index: this.selectedIndex,
            count: this.visibleItems().length,
            columns: this.gridColumns,
          }),
        );
      } else {
        this.moveItemSelection(this.selectedIndex - 1);
      }
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      if (this.gridColumns > 1) {
        this.moveItemSelection(
          gridMoveDown({
            index: this.selectedIndex,
            count: this.visibleItems().length,
            columns: this.gridColumns,
          }),
        );
      } else {
        this.moveItemSelection(this.selectedIndex + 1);
      }
      return;
    }
    if (matchesKey(data, Key.left)) {
      if (this.twoPane && this.gridColumns <= 1) {
        this.focusPane = 'categories';
        this.invalidate();
        return;
      }
      if (this.gridColumns > 1) {
        const next = gridMoveLeft({
          index: this.selectedIndex,
          count: this.visibleItems().length,
          columns: this.gridColumns,
        });
        if (this.twoPane && next === this.selectedIndex && this.selectedIndex % this.gridColumns === 0) {
          this.focusPane = 'categories';
          this.invalidate();
          return;
        }
        this.moveItemSelection(next);
      } else {
        this.moveItemSelection(this.sectionJumpIndex(-1));
      }
      return;
    }
    if (matchesKey(data, Key.right)) {
      if (this.gridColumns > 1) {
        this.moveItemSelection(
          gridMoveRight({
            index: this.selectedIndex,
            count: this.visibleItems().length,
            columns: this.gridColumns,
          }),
        );
      } else if (this.twoPane) {
        // Already on items pane; no-op stay.
        this.invalidate();
      } else {
        this.moveItemSelection(this.sectionJumpIndex(1));
      }
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.moveItemSelection(
        this.selectedIndex - COMMAND_HUB_PAGE_SIZE * Math.max(1, this.gridColumns),
      );
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.moveItemSelection(
        this.selectedIndex + COMMAND_HUB_PAGE_SIZE * Math.max(1, this.gridColumns),
      );
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.moveItemSelection(0);
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.moveItemSelection(this.visibleItems().length - 1);
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.refilter();
      }
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length > 0 && ch !== ' ') {
      if (this.query.length === 0 && ch >= '1' && ch <= '9') {
        const index = Number(ch) - 1;
        if (this.visibleItems()[index] !== undefined) {
          this.selectedIndex = index;
          this.activate('enter');
        }
        return;
      }
      if (this.intro) this.dismissIntro();
      this.query += ch;
      this.refilter();
    }
  }

  private handleCategoryKeys(data: string): void {
    const cats = hubCategories(this.filtered);
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.categoryIndex = Math.max(0, this.categoryIndex - 1);
      this.selectedIndex = 0;
      this.selectionMovedAtMs = appearanceAnimationNow();
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.categoryIndex = Math.min(cats.length - 1, this.categoryIndex + 1);
      this.selectedIndex = 0;
      this.selectionMovedAtMs = appearanceAnimationNow();
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
      this.focusPane = 'items';
      this.selectedIndex = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.categoryIndex = 0;
      this.selectedIndex = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.categoryIndex = Math.max(0, cats.length - 1);
      this.selectedIndex = 0;
      this.invalidate();
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length > 0 && ch !== ' ') {
      if (this.intro) this.dismissIntro();
      this.query += ch;
      this.refilter();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const appearance = getActiveAppearancePreferences();
    const ambient = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();
    const regionWidth = Math.max(24, width);

    const entryT = ambient ? hubEaseOutCubic((now - this.openedAtMs) / HUB_ENTRY_MS) : 1;
    const minWidth = Math.min(
      regionWidth,
      Math.max(36, Math.round(regionWidth * HUB_ENTRY_MIN_RATIO)),
    );
    const boxWidth = Math.min(
      regionWidth,
      Math.max(22, Math.round(minWidth + (regionWidth - minWidth) * entryT)),
    );
    const padLeft = Math.max(0, Math.floor((regionWidth - boxWidth) / 2));
    const inner = boxWidth - 2;

    const filtering = this.query.length > 0;
    this.twoPane = hubPreferTwoPane(this.query, inner);
    if (!this.twoPane) this.focusPane = 'items';

    const itemsPaneWidth = this.twoPane
      ? Math.max(24, inner - HUB_CATEGORY_COL_WIDTH - 1)
      : inner;

    this.gridColumns = resolveGridColumns({
      width: itemsPaneWidth,
      itemCount: this.visibleItems().length,
      preferGrid: filtering || this.twoPane,
      minCellWidth: 28,
      maxColumns: 3,
    });

    const hint = filtering
      ? this.gridColumns > 1
        ? '↑↓←→ · Enter go · wheel · Esc clear filter'
        : '↑↓ · Enter go · wheel scroll · Esc clear filter'
      : this.twoPane
        ? '↑↓←→ navigate · ← categories · Space flip · Enter go · 1–9 · type search · Esc'
        : '↑↓ · ←→ section · Space flip · Enter go · 1–9 · type search · Esc';

    const body: string[] = [
      truncateToWidth(theme.fg('textMuted', ` ${hint}`), inner),
      truncateToWidth(` ${this.renderStatusStrip(inner - 1, appearance)}`, inner),
      truncateToWidth(renderParticleDivider(inner, 'hub:strip', appearance), inner),
      '',
    ];

    if (this.intro) {
      body.push(
        truncateToWidth(
          ` ${renderPulseText('Your home base — flip a mode, then type', 'hub:intro', 'accent', appearance)}`,
          inner,
        ),
      );
      body.push(
        truncateToWidth(
          theme.fg('textMuted', ' Space stays open · Enter applies & closes · Esc dismisses tip'),
          inner,
        ),
      );
      body.push('');
    }

    const visible = this.visibleItems();
    const itemLineByIndex: number[] = Array.from({ length: visible.length }, () => -1);

    if (visible.length === 0 && !this.twoPane) {
      body.push(
        truncateToWidth(
          ` ${renderPulseText('No matches — Esc clears the filter', 'hub:empty', 'accent', appearance)}`,
          inner,
        ),
      );
    } else if (this.twoPane) {
      this.renderTwoPane(body, itemLineByIndex, inner, itemsPaneWidth, appearance, ambient, now);
    } else if (this.gridColumns > 1) {
      this.renderItemGrid(body, itemLineByIndex, visible, inner, appearance, 0);
    } else {
      this.renderSectionedList(body, itemLineByIndex, inner, appearance, ambient, now);
    }

    const titleStyled =
      renderPulseText('•', 'hub:orn:l', 'accent', appearance) +
      ` ${renderPremiumHeadline(this.title, 'command-hub:title', appearance)} ` +
      renderPulseText('•', 'hub:orn:r', 'accent', appearance);
    const footerLeftPlain = filtering ? `filter: ${this.query}` : undefined;
    const footerRightPlain = filtering
      ? `${String(this.filtered.length)}/${String(this.items.length)}`
      : this.twoPane
        ? hubCategories(this.filtered)[this.categoryIndex]
        : undefined;
    const frame = renderPremiumBoxFrame(body, {
      width: boxWidth,
      title: titleStyled,
      titlePlain: `• ${this.title} •`,
      footerLeft: footerLeftPlain === undefined ? undefined : theme.fg('textMuted', footerLeftPlain),
      footerLeftPlain,
      footerRight:
        footerRightPlain === undefined ? undefined : theme.boldFg('primary', footerRightPlain),
      footerRightPlain,
      appearance,
      openedAtMs: this.openedAtMs,
    });
    const framed =
      padLeft === 0
        ? frame.map((row) => truncateToWidth(row, regionWidth))
        : frame.map((row) => truncateToWidth(' '.repeat(padLeft) + row, regionWidth));
    this.mouseLayout = {
      panelLineCount: frame.length,
      panelWidth: boxWidth,
      itemLineByIndex,
      crumbLines: this.crumbLines,
    };
    return framed;
  }

  private renderTwoPane(
    body: string[],
    itemLineByIndex: number[],
    inner: number,
    itemsPaneWidth: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    ambient: boolean,
    now: number,
  ): void {
    const theme = currentTheme;
    const cats = hubCategories(this.filtered);
    if (cats.length === 0) {
      body.push(truncateToWidth(theme.fg('textMuted', ' No actions'), inner));
      return;
    }
    if (this.categoryIndex >= cats.length) this.categoryIndex = cats.length - 1;
    const catW = HUB_CATEGORY_COL_WIDTH;
    const visible = this.visibleItems();
    const catFocus = this.focusPane === 'categories';
    const rowCount = Math.max(cats.length, Math.ceil(visible.length / Math.max(1, this.gridColumns)));

    for (let row = 0; row < rowCount; row++) {
      const cat = cats[row];
      let left = ' '.repeat(catW);
      if (cat !== undefined) {
        const selected = row === this.categoryIndex;
        const pointer = selected && catFocus ? renderSelectPointer('command-hub') : ' ';
        const label = selected
          ? catFocus
            ? theme.boldFg('primary', cat)
            : theme.boldFg('accent', cat)
          : theme.fg('textMuted', cat);
        left = truncateToWidth(`${pointer}${label}`, catW - 1).padEnd(catW - 1, ' ');
        if (selected && catFocus) left = theme.bg('surfaceRaised', left);
      }

      const parts: string[] = [];
      if (this.gridColumns > 1) {
        const cellW = Math.max(12, Math.floor((itemsPaneWidth - 1) / this.gridColumns));
        const base = row * this.gridColumns;
        for (let c = 0; c < this.gridColumns; c++) {
          const i = base + c;
          if (i >= visible.length) break;
          const item = visible[i]!;
          itemLineByIndex[i] = body.length;
          const selected = i === this.selectedIndex && !catFocus;
          const pointer = selected ? renderSelectPointer('command-hub') : ' ';
          const hotkey =
            i < 9 ? theme.fg('textMuted', `${String(i + 1)} `) : '  ';
          const label = selected
            ? theme.boldFg('primary', item.label)
            : theme.fg('text', item.label);
          const padded = truncateToWidth(`${pointer}${hotkey}${label}`, cellW - 1).padEnd(
            cellW - 1,
            ' ',
          );
          parts.push(selected ? theme.bg('surfaceRaised', padded) : padded);
        }
      } else if (visible[row] !== undefined) {
        const item = visible[row]!;
        itemLineByIndex[row] = body.length;
        const selected = row === this.selectedIndex && !catFocus;
        const reveal = ambient ? hubClamp01((now - this.openedAtMs - 60 - row * 24) / 200) : 1;
        const pointer = selected ? renderSelectPointer('command-hub') : ' ';
        const hotkey =
          row < 9 ? theme.fg('textMuted', `${String(row + 1)} `) : '  ';
        const label = selected
          ? theme.boldFg('primary', item.label)
          : reveal < 1
            ? theme.fg('textMuted', item.label)
            : theme.fg('text', item.label);
        const badge = this.renderBadge(item, appearance);
        parts.push(truncateToWidth(`${pointer}${hotkey}${label}${badge}`, itemsPaneWidth - 1));
      }

      const right = truncateToWidth(parts.join(''), itemsPaneWidth);
      const divider = theme.fg('textMuted', '│');
      body.push(truncateToWidth(` ${left}${divider}${right}`, inner));
    }

    const selected = visible[this.selectedIndex];
    if (selected !== undefined && !catFocus) {
      body.push(
        truncateToWidth(
          ` ${' '.repeat(catW)}${renderShimmerPrefix(appearance)}${theme.fg('textMuted', selected.description)}`,
          inner,
        ),
      );
    } else if (catFocus) {
      const cat = cats[this.categoryIndex] ?? '';
      body.push(
        truncateToWidth(
          ` ${theme.fg('textMuted', `${cat} · → items · ${String(visible.length)} actions`)}`,
          inner,
        ),
      );
    }
  }

  private renderItemGrid(
    body: string[],
    itemLineByIndex: number[],
    visible: readonly CommandHubItem[],
    inner: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    _pad: number,
  ): void {
    const theme = currentTheme;
    const cellW = Math.max(12, Math.floor((inner - 1) / this.gridColumns));
    for (let index = 0; index < visible.length; index += this.gridColumns) {
      const rowLine = body.length;
      const parts: string[] = [];
      for (let c = 0; c < this.gridColumns; c++) {
        const i = index + c;
        if (i >= visible.length) break;
        const item = visible[i]!;
        itemLineByIndex[i] = rowLine;
        const selected = i === this.selectedIndex;
        const pointer = selected ? renderSelectPointer('command-hub') : ' ';
        const label = selected
          ? theme.boldFg('primary', item.label)
          : theme.fg('text', item.label);
        const padded = truncateToWidth(`${pointer}${label}`, cellW - 1).padEnd(cellW - 1, ' ');
        parts.push(selected ? theme.bg('surfaceRaised', padded) : padded);
      }
      body.push(truncateToWidth(` ${parts.join('')}`, inner));
    }
    const selected = visible[this.selectedIndex];
    if (selected !== undefined) {
      body.push(
        truncateToWidth(
          `    ${renderShimmerPrefix(appearance)}${theme.fg('textMuted', selected.description)}`,
          inner,
        ),
      );
    }
  }

  private renderSectionedList(
    body: string[],
    itemLineByIndex: number[],
    inner: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    ambient: boolean,
    now: number,
  ): void {
    const theme = currentTheme;
    let lastSection = '';
    const showHotkeys = this.query.length === 0;
    for (let index = 0; index < this.filtered.length; index += 1) {
      const item = this.filtered[index]!;
      if (item.section !== lastSection) {
        lastSection = item.section;
        const sectionLabel =
          item.section === 'Now' || item.section === 'Recent'
            ? renderPulseText(item.section, `hub:sec:${item.section}`, 'accent', appearance)
            : theme.boldFg('accent', item.section);
        body.push(truncateToWidth(` ${sectionLabel}`, inner));
      }
      const selected = index === this.selectedIndex;
      const reveal = ambient ? hubClamp01((now - this.openedAtMs - 60 - index * 24) / 200) : 1;
      const pointer = selected ? renderSelectPointer('command-hub') : ' ';
      const slidePad =
        selected &&
        ambient &&
        this.selectionMovedAtMs > 0 &&
        now - this.selectionMovedAtMs < HUB_SLIDE_MS
          ? ' '
          : '';
      const hotkey =
        showHotkeys && index < 9
          ? theme.fg('textMuted', `${String(index + 1)} `)
          : showHotkeys
            ? '  '
            : '';
      const badge = this.renderBadge(item, appearance);
      const flashing = this.flashId === item.id;
      itemLineByIndex[index] = body.length;
      const label = flashing
        ? renderSettleFlash(item.label, `hub:flash:${item.id}`, this.flashAtMs, appearance)
        : selected
          ? theme.boldFg('primary', item.label)
          : reveal < 1
            ? theme.fg('textMuted', item.label)
            : theme.fg('text', item.label);
      const kindHint =
        item.kind === 'toggle' || item.kind === 'cycle'
          ? theme.fg(
              'textMuted',
              item.kind === 'cycle' ? '  cycle' : selected ? '  toggle' : '',
            )
          : '';
      body.push(
        truncateToWidth(`${slidePad} ${pointer}${hotkey}${label}${kindHint}${badge}`, inner),
      );
      if (selected) {
        body.push(
          truncateToWidth(
            `    ${renderShimmerPrefix(appearance)}${theme.fg('textMuted', item.description)}`,
            inner,
          ),
        );
      }
    }
  }

  private visibleItems(): CommandHubItem[] {
    if (!this.twoPane || this.query.length > 0) return [...this.filtered];
    const cats = hubCategories(this.filtered);
    const cat = cats[this.categoryIndex];
    if (cat === undefined) return [...this.filtered];
    return hubItemsInCategory(this.filtered, cat);
  }

  private syncCategoryFromSelection(preferredId?: string): void {
    const cats = hubCategories(this.filtered);
    if (cats.length === 0) {
      this.categoryIndex = 0;
      this.selectedIndex = 0;
      return;
    }
    if (preferredId !== undefined) {
      for (let ci = 0; ci < cats.length; ci++) {
        const items = hubItemsInCategory(this.filtered, cats[ci]!);
        const idx = items.findIndex((item) => item.id === preferredId);
        if (idx >= 0) {
          this.categoryIndex = ci;
          this.selectedIndex = idx;
          return;
        }
      }
    }
    this.categoryIndex = Math.min(this.categoryIndex, cats.length - 1);
    const visible = this.visibleItems();
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, visible.length - 1));
  }

  private sectionJumpIndex(dir: -1 | 1): number {
    const items = this.filtered;
    if (items.length === 0) return 0;
    const cur = Math.max(0, Math.min(items.length - 1, this.selectedIndex));
    const curSection = items[cur]?.section ?? '';
    if (dir > 0) {
      for (let i = cur + 1; i < items.length; i++) {
        if ((items[i]?.section ?? '') !== curSection) return i;
      }
      return items.length - 1;
    }
    let sectionStart = cur;
    while (sectionStart > 0 && (items[sectionStart - 1]?.section ?? '') === curSection) {
      sectionStart--;
    }
    if (sectionStart < cur) return sectionStart;
    if (sectionStart === 0) return 0;
    const prevSection = items[sectionStart - 1]?.section ?? '';
    let prevStart = sectionStart - 1;
    while (prevStart > 0 && (items[prevStart - 1]?.section ?? '') === prevSection) {
      prevStart--;
    }
    return prevStart;
  }

  private moveItemSelection(next: number): void {
    const count = this.visibleItems().length;
    const clamped = Math.max(0, Math.min(Math.max(0, count - 1), next));
    if (clamped !== this.selectedIndex) {
      this.selectionMovedAtMs = appearanceAnimationNow();
    }
    this.selectedIndex = clamped;
    this.invalidate();
  }

  private activate(mode: CommandHubSelectMode): void {
    const item = this.visibleItems()[this.selectedIndex];
    if (item === undefined) return;
    if (this.intro) this.dismissIntro();
    this.onSelect(item, mode);
  }

  private renderStatusStrip(
    width: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const theme = currentTheme;
    const chips: string[] = [];
    const push = (label: string, on: boolean, id: CommandHubActionId): void => {
      const chip = on ? `[${label} ON]` : `[${label}]`;
      if (this.flashId === id) {
        chips.push(renderSettleFlash(chip, `hub:chip:${label}`, this.flashAtMs, appearance));
        return;
      }
      chips.push(
        on
          ? renderPulseText(chip, `hub:chip:${label}`, 'glow', appearance)
          : theme.fg('textMuted', chip),
      );
    };
    const plan = this.items.find((i) => i.id === 'modes.plan');
    const swarm = this.items.find((i) => i.id === 'modes.swarm');
    const ultra = this.items.find((i) => i.id === 'modes.ultrawork');
    const premium = this.items.find((i) => i.id === 'modes.premium');
    const perm = this.items.find((i) => i.id === 'modes.permission');
    push('Plan', plan?.badge === 'ON', 'modes.plan');
    push('Swarm', swarm?.badge === 'ON', 'modes.swarm');
    push('Mission', ultra?.badge === 'ON', 'modes.ultrawork');
    push('Visual', premium?.badge === 'ON', 'modes.premium');
    const permLabel = formatPermissionChip(perm?.badge);
    const permChip = `[${permLabel}]`;
    chips.push(
      this.flashId === 'modes.permission'
        ? renderSettleFlash(permChip, 'hub:chip:perm', this.flashAtMs, appearance)
        : renderPulseText(permChip, 'hub:chip:perm', 'primary', appearance),
    );
    return truncateToWidth(chips.join(' '), Math.max(8, width));
  }

  private renderBadge(
    item: CommandHubItem,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    if (item.badge === undefined || item.badge.length === 0) return '';
    const display =
      item.badge === 'ON' ? 'On' : item.badge === 'off' ? 'Off' : item.badge;
    const raw = ` · ${display}`;
    if (this.flashId === item.id) {
      return renderSettleFlash(raw, `hub:flash:${item.id}`, this.flashAtMs, appearance);
    }
    if (item.badge === 'ON') {
      return ` ${renderPulseText('· On', `hub:badge:${item.id}`, 'glow', appearance)}`;
    }
    return currentTheme.fg('textMuted', raw);
  }

  private refilter(): void {
    this.filtered = filterHubItems(this.items, this.query);
    if (this.query.length > 0) {
      this.focusPane = 'items';
      this.twoPane = false;
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    } else {
      this.syncCategoryFromSelection();
    }
    this.invalidate();
  }
}

function formatPermissionChip(badge: string | undefined): string {
  if (badge === undefined || badge.length === 0) return 'Permission —';
  if (badge === 'yolo') return 'YOLO';
  if (badge === 'auto') return 'Auto';
  if (badge === 'manual') return 'Manual';
  return badge;
}
