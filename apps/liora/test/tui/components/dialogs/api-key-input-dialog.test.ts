import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyInputDialogComponent } from '#/tui/components/dialogs/api-key-input-dialog';

describe('ApiKeyInputDialogComponent', () => {
  it('keeps every line within narrow widths', () => {
    const dialog = new ApiKeyInputDialogComponent(
      'SuperLiora',
      ['Paste your API key below.', 'It will be stored locally.'],
      () => {},
    );
    dialog.focused = true;

    for (const width of [39, 20, 10]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('strips bracketed-paste escape sequences before submitting', () => {
    const onDone = vi.fn();
    const dialog = new ApiKeyInputDialogComponent('Context7', [], onDone);
    dialog.handleInput('\u001B[200~ctx7sk_test\u001B[201~');
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({ kind: 'ok', value: 'ctx7sk_test' });
  });

  it('pre-fills the input when a prefill value is provided', () => {
    const onDone = vi.fn();
    const dialog = new ApiKeyInputDialogComponent(
      'Anthropic',
      ['Detected $ANTHROPIC_API_KEY — press Enter to use it.'],
      onDone,
      { prefill: 'sk-detected' },
    );
    // Submitting immediately (without typing) should yield the pre-filled value.
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({ kind: 'ok', value: 'sk-detected' });
  });
});
