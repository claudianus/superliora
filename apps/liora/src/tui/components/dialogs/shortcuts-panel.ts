/**
 * Keyboard shortcuts cheatsheet (center modal, Hub → Shortcuts).
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { KEYMAP_ALL, type KeymapBinding } from '#/tui/keymap';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';

export interface ShortcutsPanelOptions {
  readonly bindings?: readonly KeymapBinding[];
  readonly onClose: () => void;
}

export class ShortcutsPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly bindings: readonly KeymapBinding[];
  private readonly onClose: () => void;
  private scrollOffset = 0;

  constructor(opts: ShortcutsPanelOptions) {
    super();
    this.bindings = opts.bindings ?? KEYMAP_ALL;
    this.onClose = opts.onClose;
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
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.scrollOffset = Math.min(Math.max(0, this.bindings.length - 1), this.scrollOffset + 1);
      this.invalidate();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const visible = this.bindings.slice(this.scrollOffset, this.scrollOffset + 14);
    const body: string[] = [];
    let lastCategory = '';
    for (const binding of visible) {
      if (binding.category !== lastCategory) {
        lastCategory = binding.category;
        body.push(theme.boldFg('accent', `  ${binding.category}`));
      }
      const key = theme.boldFg('primary', binding.key.padEnd(18));
      body.push(truncateToWidth(`  ${key}${theme.fg('text', binding.description)}`, width));
    }
    return renderRendererPanelChromeRows({
      width,
      title: ' Shortcuts',
      hint: ' Esc / Enter close · ↑↓ scroll',
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'shortcuts-panel:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }
}
