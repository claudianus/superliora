/**
 * Short "How Conductor works" overlay (Hub → Start).
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { ttui } from '#/tui/utils/tui-i18n';

export interface ConductorHowtoPanelOptions {
  readonly onClose: () => void;
  /** Persist conductor_howto_seen and close. */
  readonly onSkipForever: () => void;
  readonly alreadySeen?: boolean;
}

const HOWTO_LINE_KEYS = [
  'tui.dialog.conductorHowto.line1',
  'tui.dialog.conductorHowto.line2',
  'tui.dialog.conductorHowto.line3',
  'tui.dialog.conductorHowto.line4',
  'tui.dialog.conductorHowto.line5',
  'tui.dialog.conductorHowto.line6',
  'tui.dialog.conductorHowto.line7',
  'tui.dialog.conductorHowto.line8',
] as const;

export class ConductorHowtoPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly onClose: () => void;
  private readonly onSkipForever: () => void;
  private readonly alreadySeen: boolean;

  constructor(opts: ConductorHowtoPanelOptions) {
    super();
    this.onClose = opts.onClose;
    this.onSkipForever = opts.onSkipForever;
    this.alreadySeen = opts.alreadySeen === true;
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.ctrl('c'))
    ) {
      this.onClose();
      return;
    }
    const ch = printableChar(data);
    if (!this.alreadySeen && (ch === 's' || ch === 'S')) {
      this.onSkipForever();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const body = HOWTO_LINE_KEYS.map((key) => theme.fg('text', `  ${ttui(key)}`));
    body.push('');
    if (this.alreadySeen) {
      body.push(theme.fg('textMuted', ttui('tui.dialog.conductorHowto.closeSeen')));
    } else {
      body.push(theme.fg('textMuted', ttui('tui.dialog.conductorHowto.closeNew')));
    }
    return renderRendererPanelChromeRows({
      width,
      title: ttui('tui.dialog.conductorHowto.title'),
      hint: this.alreadySeen
        ? ttui('tui.dialog.conductorHowto.hint.seen')
        : ttui('tui.dialog.conductorHowto.hint.new'),
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'conductor-howto:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }
}
