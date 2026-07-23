/**
 * Welcome panel shown at the top of the TUI.
 * Frameless hero content (figlet + session meta) — bento chrome owns borders.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
import chalk from 'chalk';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import {
  renderMeteorField,
  renderParticleRail,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { ttui } from '#/tui/utils/tui-i18n';
import { renderWelcomeBanner } from './welcome-banner';

export class WelcomeComponent implements Component {
  private state: AppState;

  constructor(state: AppState) {
    this.state = state;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    const isLoggedOut = !this.state.model;
    const activeModel = this.state.availableModels[this.state.model];
    const layout = resolveResponsiveLayout({ width: safeWidth });
    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const loggedInPrompt = ttui('tui.welcome.prompt.loggedIn');
    const loggedOutPrompt = ttui('tui.welcome.prompt.loggedOut');
    const modelUnset = ttui('tui.welcome.modelUnset');

    // Docked bento passes the center-band width (~50–80). Do not use
    // resolveResponsiveLayout here — it would classify as `tiny` and also
    // skew banner choice. Compact hero is a deliberate width budget.
    if (safeWidth < 64) {
      const banner = renderWelcomeBanner('compact', appearance, safeWidth);
      const prompt = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)(loggedOutPrompt)
        : chalk.hex(currentTheme.palette.textDim)(loggedInPrompt);
      const model = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)(modelUnset)
        : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);
      return ['', ...banner, prompt, `${ttui('tui.welcome.modelPrefix')}${model}`].map((line) =>
        truncateToWidth(line, safeWidth, '…'),
      );
    }

    const contentWidth = Math.max(1, safeWidth);
    const bannerLines = renderWelcomeBanner(layout, appearance, contentWidth);
    const dim = chalk.hex(currentTheme.palette.textDim);
    const labelStyle = chalk.bold.hex(currentTheme.palette.textDim);
    const promptLine = truncateToWidth(
      dim(isLoggedOut ? loggedOutPrompt : loggedInPrompt),
      contentWidth,
      '…',
    );

    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)(modelUnset)
      : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);

    const infoLines = [
      labelStyle(ttui('tui.welcome.label.directory')) + this.state.workDir,
      labelStyle(ttui('tui.welcome.label.model')) + modelValue,
    ];

    if (this.state.mcpServersSummary) {
      infoLines.push(labelStyle(ttui('tui.welcome.label.mcp')) + this.state.mcpServersSummary);
    }

    const contentLines: string[] = [
      ...bannerLines,
      promptLine,
      ...infoLines,
    ];

    // Idle sky under the banner: a few diagonal meteors (premium/subtle only).
    // Skip on docked center bands — empty meteor rows fight the Context rail.
    const showMeteors =
      contentWidth >= 100 &&
      shouldRenderAmbientEffects(appearance) &&
      resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
    const meteorRows = showMeteors
      ? Math.min(3, Math.max(1, Math.floor(contentWidth / 40)))
      : 0;
    const meteorField =
      meteorRows > 0
        ? renderMeteorField(contentWidth, meteorRows, 'welcome:meteors', appearance)
        : [];

    return [
      ...(contentWidth >= 100 && shouldRenderAmbientEffects(appearance)
        ? [renderParticleRail(contentWidth, appearance, 'welcome-top')]
        : []),
      ...contentLines.map((content) => truncateToWidth(content, contentWidth, '…')),
      ...(meteorField.length > 0 ? meteorField : []),
    ];
  }
}
