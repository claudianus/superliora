/**
 * War Room expert picker — select a teammate to open transcript / message.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { CURRENT_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/select-pointer';
import { printableChar } from '#/tui/utils/printable-key';
import {
  warRoomExpertLabel,
  warRoomExpertStatusBadge,
  type WarRoomExpertView,
} from '#/tui/utils/war-room-experts';

export interface WarRoomExpertPickerOptions {
  readonly experts: readonly WarRoomExpertView[];
  readonly onSelect: (expert: WarRoomExpertView) => void;
  readonly onCancel: () => void;
}

export class WarRoomExpertPickerComponent extends Container implements Focusable {
  focused = false;

  private readonly experts: readonly WarRoomExpertView[];
  private readonly onSelect: (expert: WarRoomExpertView) => void;
  private readonly onCancel: () => void;
  private readonly filtered: WarRoomExpertView[];
  private selectedIndex = 0;
  private query = '';

  constructor(opts: WarRoomExpertPickerOptions) {
    super();
    this.experts = opts.experts;
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.filtered = [...opts.experts];
    const working = this.filtered.findIndex((expert) => expert.phase === 'running');
    this.selectedIndex = Math.max(0, working);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const expert = this.filtered[this.selectedIndex];
      if (expert !== undefined) this.onSelect(expert);
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + 1);
      this.invalidate();
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
    if (ch !== undefined && ch.length > 0) {
      this.query += ch;
      this.refilter();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const hint =
      this.query.length > 0
        ? ` filter: ${this.query}`
        : '↑↓ select · Enter open · Esc cancel · type to filter';
    const body: string[] = [];
    if (this.filtered.length === 0) {
      body.push(theme.fg('textMuted', '  No matching experts.'));
    } else {
      for (let index = 0; index < this.filtered.length; index += 1) {
        const expert = this.filtered[index]!;
        const selected = index === this.selectedIndex;
        const pointer = selected ? renderSelectPointer('war-room-expert-picker') : ' ';
        const label = warRoomExpertLabel(expert);
        const badge = warRoomExpertStatusBadge(expert.phase);
        const agentHint =
          expert.agentId === undefined
            ? theme.fg('warning', 'no agent yet')
            : theme.fg('textMuted', expert.agentId.slice(0, 12));
        const workingMark =
          expert.phase === 'running' ? ` ${theme.fg('success', CURRENT_MARK)}` : '';
        const plain = `${pointer}${label}  ${badge}  `;
        const styled = selected
          ? theme.boldFg('primary', plain) + agentHint + workingMark
          : theme.fg('text', plain) + agentHint + workingMark;
        body.push(truncateToWidth(styled, width));
      }
    }
    return renderRendererPanelChromeRows({
      width,
      title: ' Talk to a War Room expert',
      hint: ` ${hint}`,
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'war-room-expert-picker:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }

  private refilter(): void {
    const needle = this.query.trim().toLowerCase();
    const next =
      needle.length === 0
        ? [...this.experts]
        : this.experts.filter(
            (expert) =>
              expert.name.toLowerCase().includes(needle) ||
              expert.expertId.toLowerCase().includes(needle),
          );
    this.filtered.length = 0;
    this.filtered.push(...next);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.invalidate();
  }
}
