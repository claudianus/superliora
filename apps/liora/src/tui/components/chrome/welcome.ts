/**
 * Welcome panel shown at the top of the TUI.
 * Renders a round-bordered box with a figlet banner, session, model, and version.
 */

import type { Component } from '#/tui/renderer';
import { renderRendererFrameRows, truncateToWidth } from '#/tui/renderer';
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
    const primary = (s: string): string => chalk.hex(currentTheme.palette.primary)(s);
    const isLoggedOut = !this.state.model;
    const activeModel = this.state.availableModels[this.state.model];
    const layout = resolveResponsiveLayout({ width: safeWidth });
    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const loggedInPrompt = ttui('tui.welcome.prompt.loggedIn');
    const loggedOutPrompt = ttui('tui.welcome.prompt.loggedOut');
    const modelUnset = ttui('tui.welcome.modelUnset');

    if (safeWidth < 24 || layout === 'tiny') {
      const banner = renderWelcomeBanner(layout, appearance, safeWidth);
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

    const innerWidth = Math.max(1, safeWidth - 4);
    const bannerLines = renderWelcomeBanner(layout, appearance, innerWidth);
    const dim = chalk.hex(currentTheme.palette.textDim);
    const labelStyle = chalk.bold.hex(currentTheme.palette.textDim);
    const promptLine = truncateToWidth(
      dim(isLoggedOut ? loggedOutPrompt : loggedInPrompt),
      innerWidth,
      '…',
    );

    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)(modelUnset)
      : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);

    const infoLines = [
      labelStyle(ttui('tui.welcome.label.directory')) + this.state.workDir,
      labelStyle(ttui('tui.welcome.label.session')) + this.state.sessionId,
      labelStyle(ttui('tui.welcome.label.model')) + modelValue,
      labelStyle(ttui('tui.welcome.label.version')) + this.state.version,
    ];

    if (this.state.mcpServersSummary) {
      infoLines.push(labelStyle(ttui('tui.welcome.label.mcp')) + this.state.mcpServersSummary);
    }

    const contentLines: string[] = [
      ...bannerLines,
      '',
      promptLine,
      '',
      ...infoLines,
    ];

    // Idle sky under the banner: a few diagonal meteors (premium/subtle only).
    const showMeteors =
      shouldRenderAmbientEffects(appearance) &&
      resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
    const meteorRows = showMeteors
      ? Math.min(3, Math.max(2, Math.floor(innerWidth / 36)))
      : 0;
    const meteorField =
      meteorRows > 0
        ? renderMeteorField(innerWidth, meteorRows, 'welcome:meteors', appearance).map(
            (row) => `  ${row}`,
          )
        : [];

    return [
      '',
      ...renderRendererFrameRows({
        content: [
          renderParticleRail(safeWidth - 2, appearance, 'welcome-top'),
          ...contentLines.map((content) => `  ${truncateToWidth(content, innerWidth, '…')}`),
          ...(meteorField.length > 0 ? ['', ...meteorField] : []),
        ],
        width: safeWidth,
        height: contentLines.length + 4 + (meteorField.length > 0 ? meteorField.length + 1 : 0),
        borderKind: 'rounded',
        borderStyle: primary,
        ellipsis: '…',
      }),
      '',
    ];
  }
}
