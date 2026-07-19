import {
  Container,
  renderRendererDividerRow,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';

import { renderSelectPointer } from '#/tui/utils/select-pointer';
import type { QueuedMessage } from '../../types';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderSettleFlash,
  renderSpectacularText,
  SETTLE_FLASH_MS,
  shouldRenderAmbientEffects,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

export interface QueuePaneOptions {
  readonly messages: readonly QueuedMessage[];
  readonly isCompacting: boolean;
  readonly isStreaming: boolean;
  readonly canSteerImmediately: boolean;
  /** Row that settles on mount (default: last = ↑-edit target). */
  readonly selectedIndex?: number;
  readonly settleStartedAtMs?: number;
}

const ELLIPSIS = '…';

export class QueuePaneComponent extends Container {
  private readonly messages: readonly QueuedMessage[];
  private readonly hint: string | undefined;
  private readonly selectedIndex: number;
  private readonly settleStartedAtMs: number;

  constructor(options: QueuePaneOptions) {
    super();
    this.messages = options.messages;
    this.selectedIndex =
      options.selectedIndex ?? Math.max(0, options.messages.length - 1);
    this.settleStartedAtMs = options.settleStartedAtMs ?? appearanceAnimationNow();

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
    // Accent only paints plain text. Pointer glyphs are already ambient-styled;
    // wrapping them again used to leak SGR as visible `[0;1;38;2…`.
    const accent = (text: string) => currentTheme.fg('accent', text);
    const shell = (text: string) => currentTheme.fg('shellMode', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const ambientLabel = (text: string, seed: string) =>
      animated
        ? renderSpectacularText(text, seed, appearance, { intense: false })
        : dim(text);
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
      const countLine = `  ${ambientLabel(label, `queue:count:${label}`)}`;
      // Truncate plain geometry first only when not animated; animated labels
      // are already width-stable short chrome. Never dim() over ANSI.
      lines.push(
        animated
          ? truncateToWidth(countLine, width, ELLIPSIS)
          : dim(truncateToWidth(`  ${label}`, width, ELLIPSIS)),
      );
    }

    const settleMs =
      resolveQualityAdjustedAmbientEffectMode(appearance) === 'subtle'
        ? SETTLE_FLASH_MS * 1.4
        : SETTLE_FLASH_MS;
    const settling =
      animated && appearanceAnimationNow() - this.settleStartedAtMs < settleMs;

    for (const [index, item] of this.messages.entries()) {
      const displayText = item.displayText ?? item.text;
      const singleLine = displayText.replaceAll(/\s+/g, ' ').trim();
      const pointer = renderSelectPointer('queue:pointer');
      const prefixPlain = '  ';
      // pointer is already ambient-styled; do not wrap it in accent/spectacular again.
      const chromeWidth = visibleWidth(`${prefixPlain}${pointer} `);
      const isSelected = index === this.selectedIndex;
      if (item.mode === 'bash') {
        // Shell commands get a `$ ` prompt and the shell-mode hue so they read
        // as commands, not as plain text that would be sent to the model.
        const prompt = '$ ';
        const availableWidth = Math.max(1, width - chromeWidth - visibleWidth(prompt));
        const truncated = truncateToWidth(singleLine, availableWidth, ELLIPSIS);
        const body =
          isSelected && settling
            ? renderSettleFlash(
                prompt + truncated,
                `queue:settle:${String(index)}`,
                this.settleStartedAtMs,
                appearance,
              )
            : shell(prompt + truncated);
        lines.push(`${prefixPlain}${pointer} ${body}`);
      } else {
        const availableWidth = Math.max(1, width - chromeWidth);
        const truncated = truncateToWidth(singleLine, availableWidth, ELLIPSIS);
        const body =
          isSelected && settling
            ? renderSettleFlash(
                truncated,
                `queue:settle:${String(index)}`,
                this.settleStartedAtMs,
                appearance,
              )
            : accent(truncated);
        lines.push(`${prefixPlain}${pointer} ${body}`);
      }
    }

    if (this.hint !== undefined) {
      lines.push(dim(truncateToWidth(this.hint, width, ELLIPSIS)));
    }

    return lines;
  }
}
