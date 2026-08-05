import { Container, Key, matchesKey, renderRendererPanelChromeRows, truncateToWidth, type Focusable } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';

export interface ModelFallbackItem {
  readonly alias: string;
  readonly displayName: string;
  readonly provider: string;
}

export interface ModelFallbackSelectorOptions {
  readonly primaryModel: string;
  readonly primaryDisplayName: string;
  readonly fallbacks: readonly ModelFallbackItem[];
  readonly onSelect: (action: ModelFallbackAction) => void;
  readonly onCancel: () => void;
}

export type ModelFallbackAction =
  | { readonly type: 'edit'; readonly index: number }
  | { readonly type: 'add' }
  | { readonly type: 'remove'; readonly index: number }
  | { readonly type: 'moveUp'; readonly index: number }
  | { readonly type: 'moveDown'; readonly index: number }
  | { readonly type: 'clear' };

/**
 * Model fallback list editor.
 *
 * Shows the current fallback chain for the active model and lets the user
 * reorder, add, remove, or clear entries. The primary model is shown at the
 * top as context but is not part of the editable list.
 *
 * Keybindings:
 *   ↑/↓       Move selection
 *   Enter     Edit selected fallback (pick a different model)
 *   a         Add a new fallback
 *   d         Remove selected fallback
 *   Ctrl+↑/↓  Reorder selected fallback
 *   r         Clear all fallbacks
 *   Esc       Cancel / go back
 */
export class ModelFallbackSelectorComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ModelFallbackSelectorOptions;
  private selectedIndex = 0;

  constructor(opts: ModelFallbackSelectorOptions) {
    super();
    this.opts = opts;
  }

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  handleInput(data: string): void {
    const count = this.opts.fallbacks.length;
    // Kitty-mode terminals send letters as CSI-u; decode before comparing.
    const ch = printableChar(data).toLowerCase();

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }

    if (matchesKey(data, Key.up) && data !== '\x1B[1;5A') {
      if (count > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      }
      return;
    }

    if (matchesKey(data, Key.down) && data !== '\x1B[1;5B') {
      if (count > 0) {
        this.selectedIndex = Math.min(count - 1, this.selectedIndex + 1);
      }
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (count > 0) {
        this.opts.onSelect({ type: 'edit', index: this.selectedIndex });
      }
      return;
    }

    if (ch === 'a') {
      this.opts.onSelect({ type: 'add' });
      return;
    }

    if (ch === 'd') {
      if (count > 0) {
        this.opts.onSelect({ type: 'remove', index: this.selectedIndex });
      }
      return;
    }

    // Ctrl+Up (move up)
    if (data === '\x1B[1;5A') {
      if (this.selectedIndex > 0) {
        this.opts.onSelect({ type: 'moveUp', index: this.selectedIndex });
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      }
      return;
    }

    // Ctrl+Down (move down)
    if (data === '\x1B[1;5B') {
      if (this.selectedIndex < count - 1) {
        this.opts.onSelect({ type: 'moveDown', index: this.selectedIndex });
        this.selectedIndex = Math.min(count - 1, this.selectedIndex + 1);
      }
      return;
    }

    if (ch === 'r') {
      if (count > 0) {
        this.opts.onSelect({ type: 'clear' });
        this.selectedIndex = 0;
      }
      return;
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const lines: string[] = [];

    // Title
    const title = renderPremiumHeadline('Model Fallback', 'fallback:title');
    lines.push(title);

    // Primary model (context)
    const primaryLine = `  Primary: ${theme.fg('text', this.opts.primaryDisplayName)}`;
    lines.push(truncateToWidth(primaryLine, width, '…'));
    lines.push('');

    const fallbacks = this.opts.fallbacks;
    if (fallbacks.length === 0) {
      lines.push(theme.fg('textMuted', '  No fallback models configured.'));
      lines.push(theme.fg('textMuted', '  Press "a" to add one.'));
    } else {
      for (let i = 0; i < fallbacks.length; i++) {
        const item = fallbacks[i];
        if (!item) continue;
        const isSelected = this.focused && i === this.selectedIndex;
        const pointer = isSelected ? renderSelectPointer('selected') : '  ';
        const num = `${i + 1}.`;
        const label = `${item.displayName} (${item.provider})`;
        const line = `${pointer}${num} ${label}`;
        lines.push(truncateToWidth(line, width, '…'));
      }
    }

    // Hint line
    lines.push('');
    const hint = this.buildHint(fallbacks.length);
    lines.push(theme.fg('textMuted', truncateToWidth(hint, width, '…')));

    return renderRendererPanelChromeRows({
      width,
      title: 'Model Fallback',
      body: lines,
    });
  }

  private buildHint(count: number): string {
    const parts: string[] = ['↑↓ select'];
    if (count > 0) {
      parts.push('Enter edit', 'd remove', 'Ctrl+↑↓ reorder', 'r clear');
    }
    parts.push('a add', 'Esc back');
    return parts.join(' · ');
  }
}
