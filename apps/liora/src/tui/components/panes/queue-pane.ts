import {
  Container,
  renderRendererDividerRow,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';

import { SELECT_POINTER } from '../../constant/symbols';
import type { QueuedMessage } from '../../types';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export interface QueuePaneOptions {
  readonly messages: readonly QueuedMessage[];
  readonly isCompacting: boolean;
  readonly isStreaming: boolean;
  readonly canSteerImmediately: boolean;
}

const ELLIPSIS = '…';

export class QueuePaneComponent extends Container {
  private readonly messages: readonly QueuedMessage[];
  private readonly hint: string | undefined;

  constructor(options: QueuePaneOptions) {
    super();
    this.messages = options.messages;

    if (options.messages.length > 0) {
      // Bash commands (`! …`) are not steerable, so only advertise Ctrl-S when
      // there is at least one plain-text item that steering would actually send.
      const hasSteerable = options.messages.some((m) => m.mode !== 'bash');
      const canSteer = options.canSteerImmediately && hasSteerable;
      this.hint =
        options.isCompacting && !options.isStreaming
          ? '  ↑ to edit · will send after compaction'
          : canSteer
            ? '  ↑ to edit · ctrl-s to steer immediately'
            : '  ↑ to edit · will send after current task';
    }
  }

  override render(width: number): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const accent = (text: string) =>
      animated
        ? renderSpectacularText(text, `queue:accent:${text}`, appearance, { intense: true })
        : currentTheme.fg('accent', text);
    const shell = (text: string) => currentTheme.fg('shellMode', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const lines: string[] = [
      animated
        ? renderParticleDivider(width, 'queue:divider', appearance)
        : renderRendererDividerRow({
            width,
            style: (text) => currentTheme.fg('border', text),
          }),
    ];

    if (this.messages.length > 0) {
      const n = this.messages.length;
      const bashCount = this.messages.filter((m) => m.mode === 'bash').length;
      const promptCount = n - bashCount;
      const parts: string[] = [`queue ${String(n)}`];
      if (promptCount > 0) parts.push(`${String(promptCount)} prompt${promptCount === 1 ? '' : 's'}`);
      if (bashCount > 0) parts.push(`${String(bashCount)} shell`);
      const label = parts.join(' · ');
      const countLine = animated
        ? `  ${renderSpectacularText(label, 'queue:count:' + label, appearance, { intense: false })}`
        : `  ${label}`;
      lines.push(dim(truncateToWidth(countLine, width, ELLIPSIS)));
    }

    for (const item of this.messages) {
      const displayText = item.displayText ?? item.text;
      const singleLine = displayText.replaceAll(/\s+/g, ' ').trim();
      const prefix = `  ${SELECT_POINTER} `;
      if (item.mode === 'bash') {
        // Shell commands get a `$ ` prompt and the shell-mode hue so they read
        // as commands, not as plain text that would be sent to the model.
        const prompt = '$ ';
        const availableWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(prompt));
        const truncated = truncateToWidth(singleLine, availableWidth, ELLIPSIS);
        lines.push(accent(prefix) + shell(prompt + truncated));
      } else {
        const availableWidth = Math.max(1, width - visibleWidth(prefix));
        const truncated = truncateToWidth(singleLine, availableWidth, ELLIPSIS);
        lines.push(accent(prefix + truncated));
      }
    }

    if (this.hint !== undefined) {
      lines.push(dim(truncateToWidth(this.hint, width, ELLIPSIS)));
    }

    return lines;
  }
}
