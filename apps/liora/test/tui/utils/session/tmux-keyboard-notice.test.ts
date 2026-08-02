import { describe, expect, it } from 'vitest';

import {
  TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING,
  TMUX_EXTENDED_KEYS_OFF_WARNING,
} from '../../../../src/tui/utils/terminal/tmux-keyboard';
import { formatTmuxKeyboardNotice } from '../../../../src/tui/utils/session/tmux-keyboard-notice';

describe('formatTmuxKeyboardNotice', () => {
  it('maps extended-keys off', () => {
    const notice = formatTmuxKeyboardNotice(TMUX_EXTENDED_KEYS_OFF_WARNING);
    expect(notice.title).toBe('tmux keyboard setup');
    expect(notice.detail).toContain('extended-keys is off');
    expect(notice.status).toMatch(/extended-keys/);
    expect(notice.coalesceKey).toBe('tmux-keyboard');
  });

  it('maps xterm format', () => {
    const notice = formatTmuxKeyboardNotice(TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING);
    expect(notice.status).toMatch(/csi-u/);
    expect(notice.detail).toContain('xterm');
  });
});
