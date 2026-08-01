import { Container, Spacer, Text } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { PluginCommandTrigger } from '#/tui/types';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import { syncAmbientAnimatedText } from '#/tui/utils/render/render-cache';

const ARGS_PREVIEW_MAX = 200;

export class PluginCommandComponent extends Container {
  private headText: Text;
  private previewText?: Text;
  private readonly commandLabel: string;
  private readonly args?: string;
  ambientAnimationEpoch = -1;
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(
    pluginId: string,
    commandName: string,
    args: string | undefined,
    readonly trigger?: PluginCommandTrigger,
  ) {
    super();
    this.commandLabel = `${pluginId}:${commandName}`;
    this.args = args;
    this.addChild(new Spacer(1));
    this.headText = new Text(this.renderHead(), 0, 0);
    this.addChild(this.headText);

    const trimmed = args?.trim() ?? '';
    if (trimmed.length > 0) {
      this.previewText = new Text(`  ${currentTheme.fg('textDim', previewArgs(trimmed))}`, 0, 0);
      this.addChild(this.previewText);
    }
  }

  override invalidate(): void {
    this.ambientAnimationEpoch = -1;
    this.headText.setText(this.renderHead());
    if (this.previewText !== undefined && this.args !== undefined) {
      this.previewText.setText(`  ${currentTheme.fg('textDim', previewArgs(this.args.trim()))}`);
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    syncAmbientAnimatedText(this.headText, () => this.renderHead(), this);
    const lines = super.render(width);
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'notice',
      appearance: getActiveAppearancePreferences(),
    });
  }

  private renderHead(): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const prefix = animated
      ? renderPulseText('▶', 'plugin-cmd:arrow', 'primary') + ' ' + renderPremiumHeadline('Ran command:', 'plugin-cmd:prefix', appearance)
      : currentTheme.boldFg('primary', '▶ Ran command: ');
    const command = animated
      ? renderPremiumHeadline(`/${this.commandLabel}`, `plugin-cmd:${this.commandLabel}`, appearance)
      : currentTheme.boldFg('roleUser', `/${this.commandLabel}`);
    return `${prefix} ${command}`;
  }
}

function previewArgs(args: string): string {
  return args.length > ARGS_PREVIEW_MAX ? `${args.slice(0, ARGS_PREVIEW_MAX)}…` : args;
}
