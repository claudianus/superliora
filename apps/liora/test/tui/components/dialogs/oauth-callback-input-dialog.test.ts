import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import { OAuthCallbackInputDialogComponent } from '#/tui/components/dialogs/oauth-callback-input-dialog';

describe('OAuthCallbackInputDialogComponent', () => {
  it('keeps every line within narrow widths', () => {
    const dialog = new OAuthCallbackInputDialogComponent(() => {});
    dialog.focused = true;

    for (const width of [39, 20, 10]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('strips bracketed-paste escape sequences before submitting', () => {
    const onDone = vi.fn();
    const dialog = new OAuthCallbackInputDialogComponent(onDone);
    dialog.handleInput('\u001B[200~http://127.0.0.1:56121/callback?code=abc&state=xyz\u001B[201~');
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: 'http://127.0.0.1:56121/callback?code=abc&state=xyz',
    });
  });

  it('cancels on Escape', () => {
    const onDone = vi.fn();
    const dialog = new OAuthCallbackInputDialogComponent(onDone);
    dialog.handleInput('\u001B');
    expect(onDone).toHaveBeenCalledWith({ kind: 'cancel' });
  });
});
