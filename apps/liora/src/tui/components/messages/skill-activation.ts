/**
 * Skill activation card.
 *
 * When the user runs `/skill:foo bar`, the TUI renders a compact card instead
 * of expanding the SKILL.md body into the user bubble:
 *
 *   ▶ Activated skill: foo
 *     bar
 *
 * The args line is optional. Core expands the skill body into the LLM context;
 * the TUI only consumes the `skill.activated` event and user_message origin
 * metadata.
 */

import { Container, Text, Spacer } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { SkillActivationTrigger } from '#/tui/types';
import {
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { syncAmbientAnimatedText } from '#/tui/utils/render-cache';

const ARGS_PREVIEW_MAX = 200;

export class SkillActivationComponent extends Container {
  private headText: Text;
  private previewText?: Text;
  private name: string;
  private args?: string;
  ambientAnimationEpoch = -1;

  constructor(
    name: string,
    args: string | undefined,
    readonly trigger?: SkillActivationTrigger,
  ) {
    super();
    this.name = name;
    this.args = args;
    this.addChild(new Spacer(1));
    this.headText = new Text(this.renderHead(), 0, 0);
    this.addChild(this.headText);
    const trimmed = args?.trim() ?? '';
    if (trimmed.length > 0) {
      const preview =
        trimmed.length > ARGS_PREVIEW_MAX ? trimmed.slice(0, ARGS_PREVIEW_MAX) + '…' : trimmed;
      this.previewText = new Text('  ' + currentTheme.fg('textDim', preview), 0, 0);
      this.addChild(this.previewText);
    }
  }

  override invalidate(): void {
    this.ambientAnimationEpoch = -1;
    this.headText.setText(this.renderHead());
    if (this.previewText !== undefined && this.args !== undefined) {
      const trimmed = this.args.trim();
      const preview =
        trimmed.length > ARGS_PREVIEW_MAX ? trimmed.slice(0, ARGS_PREVIEW_MAX) + '…' : trimmed;
      this.previewText.setText('  ' + currentTheme.fg('textDim', preview));
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    syncAmbientAnimatedText(this.headText, () => this.renderHead(), this);
    return super.render(width);
  }

  private renderHead(): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const prefix = animated
      ? renderPulseText('▶', 'skill:arrow', 'primary') + ' ' + renderPremiumHeadline('Activated skill:', 'skill:prefix', appearance)
      : currentTheme.boldFg('primary', '▶ Activated skill: ');
    const name = animated
      ? renderPremiumHeadline(this.name, `skill:name:${this.name}`, appearance)
      : currentTheme.boldFg('roleUser', this.name);
    return `${prefix} ${name}`;
  }
}
