/**
 * Command Hub component — single-column rich palette in a premium center modal.
 *
 * Fixed top-to-bottom layout: search row · slim mode strip · divider ·
 * windowed section list. Every row carries label + inline description +
 * right-aligned badge; the selected row gets a full-width raised island.
 * Fuzzy matches highlight inside labels while filtering.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
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
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import {
  resolveCenterListMouse,
  type CenterListMouseLayout,
} from '#/tui/utils/ui/list-dialog-mouse';
import { pageView } from '#/tui/utils/ui/paging';
import { ttui } from '#/tui/utils/tui-i18n';

import {
  COMMAND_HUB_PAGE_SIZE,
  HUB_ENTRY_MIN_RATIO,
  HUB_ENTRY_MS,
  HUB_MAX_BOX_WIDTH,
  HUB_SLIDE_MS,
  hubClamp01,
  hubEaseOutCubic,
} from './command-hub-animation';
import { filterHubItems } from './command-hub-filter';
import { hubHighlightSegments } from './command-hub-highlight';
import type {
  CommandHubActionId,
  CommandHubItem,
  CommandHubOptions,
  CommandHubSelectMode,
} from './command-hub-types';
import { resolveHubItem } from './resolve-hub-item';

/** Fixed label column; descriptions and badges align to its right edge. */
const HUB_LABEL_COL_WIDTH = 24;
/** Inner width at which every row gets an inline description. */
const HUB_WIDE_MIN_INNER = 72;
/** Never show more rows than this per page, however tall the terminal. */
const HUB_MAX_PAGE_SIZE = 18;
/** Rows reserved for chrome (search, strip, divider, frame, indicators). */
const HUB_CHROME_ROWS = 16;

export class CommandHubComponent extends Container implements Focusable {
  focused = false;

  private items: readonly CommandHubItem[];
  private readonly onSelect: (item: CommandHubItem, mode: CommandHubSelectMode) => void;
  private readonly onCancel: () => void;
  private readonly onIntroDismiss: (() => void) | undefined;
  private readonly title: string;
  private readonly terminalRows: () => number;
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
  /** Item index of the first row in the last rendered window (mouse offset). */
  private windowStart = 0;
  /** Rows per page; refreshed every render from the terminal height. */
  private pageSize = COMMAND_HUB_PAGE_SIZE;

  constructor(opts: CommandHubOptions) {
    super();
    this.items = opts.items;
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.onIntroDismiss = opts.onIntroDismiss;
    this.title = opts.title ?? ttui('tui.hub.chrome.title');
    this.query = opts.initialQuery ?? '';
    this.intro = opts.intro === true;
    this.terminalRows = opts.terminalRows ?? (() => process.stdout.rows || 24);
    this.filtered = filterHubItems(this.items, this.query);
  }

  /** Live-refresh badges / Now section while Hub stays open. */
  setItems(items: readonly CommandHubItem[]): void {
    const selectedId = this.filtered[this.selectedIndex]?.id;
    this.items = items;
    this.filtered = filterHubItems(this.items, this.query);
    const idx =
      selectedId === undefined ? -1 : this.filtered.findIndex((item) => item.id === selectedId);
    this.selectedIndex =
      idx >= 0 ? idx : Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
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
    const action = resolveCenterListMouse(
      event,
      this.mouseLayout,
      this.selectedIndex - this.windowStart,
    );
    if (action.type === 'none') return false;
    if (action.type === 'move') {
      this.moveSelection(this.selectedIndex + action.delta);
      return true;
    }
    if (action.type === 'highlight') {
      this.moveSelection(action.index + this.windowStart);
      return true;
    }
    if (action.type === 'activate') {
      this.moveSelection(action.index + this.windowStart);
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
      this.activate('enter');
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.moveSelection(this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.moveSelection(this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.moveSelection(this.sectionJumpIndex(-1));
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.moveSelection(this.sectionJumpIndex(1));
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.moveSelection(this.selectedIndex - this.pageSize);
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.moveSelection(this.selectedIndex + this.pageSize);
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.moveSelection(0);
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.moveSelection(this.filtered.length - 1);
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
    if (!isPrintableChar(ch)) return;
    if (ch === ' ' && this.query.length === 0) {
      // Idle Space flips the selected toggle/cycle in place; a leading space
      // never starts a search query.
      if (isFlipTarget(this.filtered[this.selectedIndex])) this.activate('space');
      return;
    }
    if (this.intro) this.dismissIntro();
    this.query += ch;
    this.refilter();
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const appearance = getActiveAppearancePreferences();
    const ambient = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();
    const regionWidth = Math.max(24, width);

    const entryT = ambient ? hubEaseOutCubic((now - this.openedAtMs) / HUB_ENTRY_MS) : 1;
    const targetWidth = Math.min(regionWidth, HUB_MAX_BOX_WIDTH);
    const minWidth = Math.min(
      targetWidth,
      Math.max(36, Math.round(targetWidth * HUB_ENTRY_MIN_RATIO)),
    );
    const boxWidth = Math.min(
      targetWidth,
      Math.max(22, Math.round(minWidth + (targetWidth - minWidth) * entryT)),
    );
    const inner = boxWidth - 2;

    const filtering = this.query.trim().length > 0;
    this.pageSize = hubListPageSize(this.terminalRows());

    const body: string[] = [
      this.renderSearchRow(inner, filtering),
      truncateToWidth(` ${this.renderStatusStrip(inner - 1, appearance)}`, inner),
      truncateToWidth(renderParticleDivider(inner, 'hub:strip', appearance), inner),
      '',
    ];

    if (this.intro) {
      body.push(
        truncateToWidth(
          ` ${renderPulseText(ttui('tui.hub.chrome.intro'), 'hub:intro', 'accent', appearance)}`,
          inner,
        ),
      );
      body.push(
        truncateToWidth(
          theme.fg('textMuted', ttui('tui.hub.chrome.introDismiss')),
          inner,
        ),
      );
      body.push('');
    }

    const itemLineByIndex: number[] = [];
    if (this.filtered.length === 0) {
      body.push(
        truncateToWidth(
          ` ${renderPulseText(ttui('tui.hub.chrome.noMatches', { query: this.query.trim() }), 'hub:empty', 'accent', appearance)}`,
          inner,
        ),
      );
      body.push(truncateToWidth(theme.fg('textMuted', ttui('tui.hub.chrome.clearFilter')), inner));
    } else {
      this.renderWindow(body, itemLineByIndex, inner, filtering, appearance, ambient, now);
    }

    const titleStyled =
      renderPulseText('•', 'hub:orn:l', 'accent', appearance) +
      ` ${renderPremiumHeadline(this.title, 'command-hub:title', appearance)} ` +
      renderPulseText('•', 'hub:orn:r', 'accent', appearance);
    const selectedRaw = this.filtered[this.selectedIndex];
    const selected = selectedRaw === undefined ? undefined : resolveHubItem(selectedRaw);
    const flip = !filtering && isFlipTarget(selectedRaw);
    const hintPlain = filtering
      ? ttui('tui.hub.chrome.footer.filtering')
      : flip
        ? ttui('tui.hub.chrome.footer.flip')
        : ttui('tui.hub.chrome.footer.default');
    const sectionPlain = selected?.section;
    const frame = renderPremiumBoxFrame(body, {
      width: boxWidth,
      title: titleStyled,
      titlePlain: `• ${this.title} •`,
      footerLeft: theme.fg('textMuted', hintPlain),
      footerLeftPlain: hintPlain,
      footerRight:
        sectionPlain === undefined ? undefined : theme.boldFg('primary', sectionPlain),
      footerRightPlain: sectionPlain,
      appearance,
      openedAtMs: this.openedAtMs,
    });
    this.mouseLayout = {
      panelLineCount: frame.length,
      panelWidth: boxWidth,
      itemLineByIndex,
      crumbLines: this.crumbLines,
    };
    // Return the box only — center-modal hugs line width so the raised
    // overlay matches the cyan frame (no side-pad into a wider slab).
    return frame;
  }

  /** Search input row — always visible so the palette teaches itself. */
  private renderSearchRow(inner: number, filtering: boolean): string {
    const theme = currentTheme;
    const cursor = theme.fg('primary', '▌');
    const left = filtering
      ? ` ${theme.fg('primary', '❯')} ${theme.fg('text', this.query)}${cursor}`
      : ` ${theme.fg('textMuted', '❯')} ${cursor}${theme.fg('textMuted', ` ${ttui('tui.hub.chrome.searchPlaceholder')}`)}`;
    const countPlain = filtering
      ? `${String(this.filtered.length)}/${String(this.items.length)}`
      : String(this.items.length);
    const pad = Math.max(1, inner - visibleWidth(left) - visibleWidth(countPlain) - 1);
    return truncateToWidth(
      `${left}${' '.repeat(pad)}${theme.fg('textMuted', countPlain)}`,
      inner,
    );
  }

  private renderWindow(
    body: string[],
    itemLineByIndex: number[],
    inner: number,
    filtering: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    ambient: boolean,
    now: number,
  ): void {
    const theme = currentTheme;
    const page = pageView(this.filtered.length, this.selectedIndex, this.pageSize);
    this.windowStart = page.start;

    if (page.page > 0) {
      body.push(truncateToWidth(theme.fg('textMuted', `  ▲ ${String(page.start)} more`), inner));
    }
    let lastSection = '';
    for (let i = page.start; i < page.end; i += 1) {
      const item = this.filtered[i]!;
      const resolved = resolveHubItem(item);
      if (!filtering && resolved.section !== lastSection) {
        lastSection = resolved.section;
        body.push(this.renderSectionHeader(item, resolved.section, inner, appearance));
      }
      itemLineByIndex.push(body.length);
      body.push(...this.renderItemRow(item, i, inner, filtering, appearance, ambient, now));
    }
    if (page.page < page.pageCount - 1) {
      body.push(
        truncateToWidth(
          theme.fg('textMuted', `  ▼ ${String(this.filtered.length - page.end)} more`),
          inner,
        ),
      );
    }
  }

  private renderSectionHeader(
    item: CommandHubItem,
    section: string,
    inner: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const theme = currentTheme;
    const pulseSection =
      item.sectionKey === 'tui.hub.section.now' ||
      item.sectionKey === 'tui.hub.section.recent';
    const label = pulseSection
      ? renderPulseText(section, `hub:sec:${item.sectionKey ?? section}`, 'accent', appearance)
      : theme.boldFg('accent', section);
    // ` ${section}` + trailing rule space; fill the rest so the rule meets the border.
    const fill = Math.max(0, inner - visibleWidth(` ${section}`) - 1);
    const rule = fill > 0 ? ` ${theme.dimFg('textMuted', '╌'.repeat(fill))}` : '';
    return truncateToWidth(` ${label}${rule}`, inner);
  }

  private renderItemRow(
    item: CommandHubItem,
    index: number,
    inner: number,
    filtering: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    ambient: boolean,
    now: number,
  ): string[] {
    const theme = currentTheme;
    const resolved = resolveHubItem(item);
    const selected = index === this.selectedIndex;
    const flashing = this.flashId === item.id;
    const reveal = ambient ? hubClamp01((now - this.openedAtMs - 60 - index * 24) / 200) : 1;
    const pointer = selected ? renderSelectPointer('command-hub') : ' ';
    const slidePad =
      selected && ambient && this.selectionMovedAtMs > 0 && now - this.selectionMovedAtMs < HUB_SLIDE_MS
        ? ' '
        : '';

    const baseLabel = (text: string): string =>
      selected
        ? theme.boldFg('primary', text)
        : reveal < 1
          ? theme.fg('textMuted', text)
          : theme.fg('text', text);
    const labelStyled = flashing
      ? renderSettleFlash(resolved.label, `hub:flash:${item.id}`, this.flashAtMs, appearance)
      : filtering
        ? hubHighlightSegments(resolved.label, this.query)
            .map((seg) => (seg.matched ? theme.boldFg('accent', seg.text) : baseLabel(seg.text)))
            .join('')
        : baseLabel(resolved.label);

    const badge = this.renderBadge(item, appearance, selected);
    const badgeWidth = visibleWidth(badge);
    // One trailing column keeps the badge off the rounded border.
    const maxContent = inner - (badgeWidth > 0 ? badgeWidth + 2 : 1);
    const wide = inner >= HUB_WIDE_MIN_INNER;
    const description = filtering
      ? `${resolved.section} · ${resolved.description}`
      : resolved.description;

    let leftPart: string;
    let descStyled = '';
    if (wide) {
      const labelCell =
        truncateToWidth(labelStyled, HUB_LABEL_COL_WIDTH) +
        ' '.repeat(Math.max(0, HUB_LABEL_COL_WIDTH - visibleWidth(resolved.label)));
      leftPart = `${slidePad} ${pointer} ${labelCell} `;
      const descRoom = maxContent - visibleWidth(leftPart);
      if (descRoom > 6 && description.length > 0) {
        descStyled = filtering
          ? truncateToWidth(
              theme.fg('textDim', `${resolved.section} · `) +
                theme.fg('textMuted', resolved.description),
              descRoom,
            )
          : truncateToWidth(theme.fg('textMuted', description), descRoom);
      }
    } else {
      leftPart = `${slidePad} ${pointer} ${labelStyled}`;
    }

    const content = truncateToWidth(leftPart + descStyled, maxContent);
    const gap = Math.max(
      badgeWidth > 0 ? 1 : 0,
      inner - 1 - visibleWidth(content) - badgeWidth,
    );
    const line = truncateToWidth(`${content}${' '.repeat(gap)}${badge} `, inner);

    const lines: string[] = [];
    if (selected && !flashing) {
      lines.push(theme.bg('surfaceRaised', padToVisibleWidth(line, inner)));
    } else {
      lines.push(line);
    }
    if (!wide && selected && description.length > 0) {
      lines.push(
        truncateToWidth(
          `    ${renderShimmerPrefix(appearance)}${theme.fg('textMuted', description)}`,
          inner,
        ),
      );
    }
    return lines;
  }

  private renderBadge(
    item: CommandHubItem,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    selected: boolean,
  ): string {
    if (item.badge === undefined || item.badge.length === 0) return '';
    const theme = currentTheme;
    const display =
      item.badge === 'ON' ? '● On' : item.badge === 'off' ? '○ off' : item.badge;
    if (this.flashId === item.id) {
      return renderSettleFlash(display, `hub:flash:${item.id}`, this.flashAtMs, appearance);
    }
    if (item.badge === 'ON') {
      return selected
        ? theme.boldFg('success', display)
        : renderPulseText(display, `hub:badge:${item.id}`, 'glow', appearance);
    }
    if (item.badge === 'off') return theme.fg('textDim', display);
    return theme.fg('accent', display);
  }

  private renderStatusStrip(
    width: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const theme = currentTheme;
    const chips: string[] = [];
    const push = (label: string, on: boolean, id: CommandHubActionId): void => {
      const led = on ? '● on' : '○ off';
      if (this.flashId === id) {
        chips.push(renderSettleFlash(`${label} ${led}`, `hub:chip:${label}`, this.flashAtMs, appearance));
        return;
      }
      chips.push(
        theme.fg('textMuted', `${label} `) +
          (on
            ? renderPulseText(led, `hub:chip:${label}`, 'glow', appearance)
            : theme.fg('textDim', led)),
      );
    };
    const plan = this.items.find((i) => i.id === 'modes.plan');
    const premium = this.items.find((i) => i.id === 'modes.premium');
    const perm = this.items.find((i) => i.id === 'modes.permission');
    const ask = this.items.find((i) => i.id === 'modes.ask');
    push('Plan', plan?.badge === 'ON', 'modes.plan');
    push('Ask', ask?.badge === 'ON', 'modes.ask');
    push('Visual', premium?.badge === 'ON', 'modes.premium');
    const permLabel = formatPermissionChip(perm?.badge);
    chips.push(
      this.flashId === 'modes.permission'
        ? renderSettleFlash(`Perm ${permLabel}`, 'hub:chip:perm', this.flashAtMs, appearance)
        : theme.fg('textMuted', 'Perm ') +
            renderPulseText(permLabel, 'hub:chip:perm', 'primary', appearance),
    );
    return truncateToWidth(chips.join('  '), Math.max(8, width));
  }

  private hubSectionId(item: CommandHubItem | undefined): string {
    if (item === undefined) return '';
    return item.sectionKey ?? resolveHubItem(item).section;
  }

  private sectionJumpIndex(dir: -1 | 1): number {
    const items = this.filtered;
    if (items.length === 0) return 0;
    const cur = Math.max(0, Math.min(items.length - 1, this.selectedIndex));
    const curSection = this.hubSectionId(items[cur]);
    if (dir > 0) {
      for (let i = cur + 1; i < items.length; i++) {
        if (this.hubSectionId(items[i]) !== curSection) return i;
      }
      return items.length - 1;
    }
    let sectionStart = cur;
    while (sectionStart > 0 && this.hubSectionId(items[sectionStart - 1]) === curSection) {
      sectionStart--;
    }
    if (sectionStart < cur) return sectionStart;
    if (sectionStart === 0) return 0;
    const prevSection = this.hubSectionId(items[sectionStart - 1]);
    let prevStart = sectionStart - 1;
    while (prevStart > 0 && this.hubSectionId(items[prevStart - 1]) === prevSection) {
      prevStart--;
    }
    return prevStart;
  }

  private moveSelection(next: number): void {
    const clamped = Math.max(0, Math.min(Math.max(0, this.filtered.length - 1), next));
    if (clamped !== this.selectedIndex) {
      this.selectionMovedAtMs = appearanceAnimationNow();
    }
    this.selectedIndex = clamped;
    this.invalidate();
  }

  private activate(mode: CommandHubSelectMode): void {
    const item = this.filtered[this.selectedIndex];
    if (item === undefined) return;
    if (this.intro) this.dismissIntro();
    this.onSelect(item, mode);
  }

  private refilter(): void {
    this.filtered = filterHubItems(this.items, this.query);
    // Palette convention: the best fuzzy+recency match lands under the cursor.
    this.selectedIndex = 0;
    this.invalidate();
  }
}

function isFlipTarget(item: CommandHubItem | undefined): boolean {
  return item?.kind === 'toggle' || item?.kind === 'cycle';
}

function hubListPageSize(terminalRows: number): number {
  if (!Number.isFinite(terminalRows) || terminalRows <= 0) return COMMAND_HUB_PAGE_SIZE;
  return Math.max(
    COMMAND_HUB_PAGE_SIZE,
    Math.min(HUB_MAX_PAGE_SIZE, terminalRows - HUB_CHROME_ROWS),
  );
}

function padToVisibleWidth(line: string, width: number): string {
  return line + ' '.repeat(Math.max(0, width - visibleWidth(line)));
}

function formatPermissionChip(badge: string | undefined): string {
  if (badge === undefined || badge.length === 0) return '—';
  if (badge === 'yolo') return 'YOLO';
  if (badge === 'auto') return 'auto';
  if (badge === 'manual') return 'manual';
  return badge;
}
