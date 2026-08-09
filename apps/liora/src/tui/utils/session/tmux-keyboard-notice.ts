/**
 * Loop53a — surface tmux keyboard setup warnings as a named TUI notice.
 *
 * Startup previously only flashed the long recovery string as a status line,
 * which is easy to miss under splash/loading chrome.
 */

import { ttui } from '#/tui/utils/tui-i18n';

import {
  TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING,
  TMUX_EXTENDED_KEYS_OFF_WARNING,
} from '../terminal/tmux-keyboard';

export type TmuxKeyboardNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'tmux-keyboard';
};

export function formatTmuxKeyboardNotice(warning: string): TmuxKeyboardNotice {
  const text = warning.trim();
  let status = ttui('tui.notice.tmuxKeyboard.statusDefault');
  if (text === TMUX_EXTENDED_KEYS_OFF_WARNING || text.includes('extended-keys is off')) {
    status = ttui('tui.notice.tmuxKeyboard.statusExtendedOff');
  } else if (
    text === TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING ||
    text.includes('extended-keys-format is set to xterm')
  ) {
    status = ttui('tui.notice.tmuxKeyboard.statusCsiU');
  }
  return {
    title: ttui('tui.notice.tmuxKeyboard.title'),
    detail:
      text.length > 0
        ? text
        : ttui('tui.notice.tmuxKeyboard.detailFallback'),
    status,
    coalesceKey: 'tmux-keyboard',
  };
}
