/**
 * Loop53a — surface tmux keyboard setup warnings as a named TUI notice.
 *
 * Startup previously only flashed the long recovery string as a status line,
 * which is easy to miss under splash/loading chrome.
 */

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
  let status = 'tmux keyboard setup needs attention';
  if (text === TMUX_EXTENDED_KEYS_OFF_WARNING || text.includes('extended-keys is off')) {
    status = 'tmux: enable extended-keys for Shift-Enter';
  } else if (
    text === TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING ||
    text.includes('extended-keys-format is set to xterm')
  ) {
    status = 'tmux: set extended-keys-format to csi-u';
  }
  return {
    title: 'tmux keyboard setup',
    detail:
      text.length > 0
        ? text
        : 'tmux keyboard options may block Shift-Enter / modified keys. Check extended-keys and extended-keys-format.',
    status,
    coalesceKey: 'tmux-keyboard',
  };
}
