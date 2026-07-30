/**
 * Command Hub component — center modal with status strip, search, and action list.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
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
import { renderSelectPointer } from '#/tui/utils/select-pointer';

import {
  COMMAND_HUB_PAGE_SIZE,
  HUB_ENTRY_MIN_RATIO,
  HUB_ENTRY_MS,
  HUB_SLIDE_MS,
  hubClamp01,
  hubEaseOutCubic,
} from './command-hub-animation';
import { filterHubItems } from './command-hub-filter';
import type {
  CommandHubActionId,
  CommandHubItem,
  CommandHubOptions,
  CommandHubSelectMode,
} from './command-hub-types';

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
  }

  /** Live-refresh badges / Now section while Hub stays open. */
  setItems(items: readonly CommandHubItem[]): void {
    const selectedId = this.filtered[this.selectedIndex]?.id;
    this.items = items;
    this.filtered = filterHubItems(this.items, this.query);
    if (selectedId !== undefined) {
      const next = this.filtered.findIndex((item) => item.id === selectedId);
      this.selectedIndex = next === -1 ? 0 : next;
    } else {
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    }
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

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.intro) {
        this.dismissIntro();
        return;
      }
      // Two-stage Esc: clear filter first, then close (searchable dialog convention).
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
    if (matchesKey(data, Key.space) || printableChar(data) === ' ') {
      this.activate('space');
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
    if (matchesKey(data, Key.pageUp)) {
      this.moveSelection(this.selectedIndex - COMMAND_HUB_PAGE_SIZE);
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.moveSelection(this.selectedIndex + COMMAND_HUB_PAGE_SIZE);
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
    if (ch !== undefined && ch.length > 0 && ch !== ' ') {
      // Empty filter: 1–9 is a hotkey (activate that row). Typing starts search.
      if (this.query.length === 0 && ch >= '1' && ch <= '9') {
        const index = Number(ch) - 1;
        if (this.filtered[index] !== undefined) {
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

  override render(width: number): string[] {
    const theme = currentTheme;
    const appearance = getActiveAppearancePreferences();
    const ambient = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();
    const regionWidth = Math.max(24, width);

    // Entry: the box scales in from ~86% while rows cascade right after.
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

    const hint =
      this.query.length > 0
        ? '↑↓ navigate · Enter go · Esc clear filter'
        : '↑↓ navigate · Space flip · Enter go · 1-9 hotkeys · type search · Esc cancel';
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
          theme.fg('textMuted', ' Space stays here · Enter applies & returns · Esc dismiss'),
          inner,
        ),
      );
      body.push('');
    }

    if (this.filtered.length === 0) {
      body.push(
        truncateToWidth(
          ` ${renderPulseText('No matches — Esc clears the filter', 'hub:empty', 'accent', appearance)}`,
          inner,
        ),
      );
    } else {
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
        // Entry cascade: rows brighten in a stagger, top to bottom.
        const reveal = ambient ? hubClamp01((now - this.openedAtMs - 60 - index * 24) / 200) : 1;
        const pointer = selected ? renderSelectPointer('command-hub') : ' ';
        // Pointer slides in one cell after a move — the row "catches" the cursor.
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
        const label = flashing
          ? renderSettleFlash(item.label, `hub:flash:${item.id}`, this.flashAtMs, appearance)
          : selected
            ? theme.boldFg('primary', item.label)
            : reveal < 1
              ? theme.fg('textMuted', item.label)
              : theme.fg('text', item.label);
        const kindHint =
          item.kind === 'toggle' || item.kind === 'cycle'
            ? theme.fg('textMuted', item.kind === 'cycle' ? ' ↻' : ' ⚡')
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

    const filtering = this.query.length > 0;
    const titleStyled =
      renderPulseText('•', 'hub:orn:l', 'accent', appearance) +
      ` ${renderPremiumHeadline(this.title, 'command-hub:title', appearance)} ` +
      renderPulseText('•', 'hub:orn:r', 'accent', appearance);
    const footerLeftPlain = filtering ? `filter: ${this.query}` : undefined;
    const footerRightPlain = filtering
      ? `${String(this.filtered.length)}/${String(this.items.length)}`
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
    if (padLeft === 0) return frame.map((row) => truncateToWidth(row, regionWidth));
    return frame.map((row) => truncateToWidth(' '.repeat(padLeft) + row, regionWidth));
  }

  private moveSelection(next: number): void {
    const clamped = Math.max(0, Math.min(this.filtered.length - 1, next));
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
    // Space on open rows = open (same as Enter). Silent no-op felt broken.
    this.onSelect(item, mode);
  }

  private renderStatusStrip(
    width: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const theme = currentTheme;
    const chips: string[] = [];
    const push = (label: string, on: boolean, id: CommandHubActionId): void => {
      const text = on ? label.toUpperCase() : label;
      const chip = `[${text}]`;
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
    push('plan', plan?.badge === 'ON', 'modes.plan');
    push('swarm', swarm?.badge === 'ON', 'modes.swarm');
    push('ultra', ultra?.badge === 'ON', 'modes.ultrawork');
    push('pq', premium?.badge === 'ON', 'modes.premium');
    const permChip = `[${perm?.badge ?? '—'}]`;
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
    const raw = ` · ${item.badge}`;
    if (this.flashId === item.id) {
      return renderSettleFlash(raw, `hub:flash:${item.id}`, this.flashAtMs, appearance);
    }
    if (item.badge === 'ON') {
      return ` ${renderPulseText(raw.trimStart(), `hub:badge:${item.id}`, 'glow', appearance)}`;
    }
    return currentTheme.fg('textMuted', raw);
  }

  private refilter(): void {
    this.filtered = filterHubItems(this.items, this.query);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.invalidate();
  }
}
