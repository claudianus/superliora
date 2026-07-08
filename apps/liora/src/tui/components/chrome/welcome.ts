/**
 * Welcome panel shown at the top of the TUI.
 * Renders a round-bordered box with a figlet banner, session, model, and version.
 */

import type { Component } from '#/tui/renderer';
import { renderRendererFrameRows, truncateToWidth, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import { resolveResponsiveLayout, type ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import { renderParticleRail } from '#/tui/utils/appearance-effects';
import { renderLioraMascotIcon } from './liora-mascot-icon';
import { renderWelcomeBanner } from './welcome-banner';

const LOGGED_IN_PROMPT = 'Type normally, or press Shift-Tab to toggle Ultrawork/off.';

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

    if (safeWidth < 24 || layout === 'tiny') {
      const banner = renderWelcomeBanner(layout, appearance, safeWidth);
      const prompt = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('Run /login to connect a provider.')
        : chalk.hex(currentTheme.palette.textDim)(LOGGED_IN_PROMPT);
      const model = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('not set, run /login')
        : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);
      return ['', ...banner, prompt, `Model: ${model}`].map((line) =>
        truncateToWidth(line, safeWidth, '…'),
      );
    }

    const innerWidth = Math.max(1, safeWidth - 4);
    const bannerLines = renderWelcomeBanner(layout, appearance, innerWidth);
    const dim = chalk.hex(currentTheme.palette.textDim);
    const labelStyle = chalk.bold.hex(currentTheme.palette.textDim);
    const promptLine = truncateToWidth(
      dim(isLoggedOut ? 'Run /login to connect a provider.' : LOGGED_IN_PROMPT),
      innerWidth,
      '…',
    );

    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)('not set, run /login')
      : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);

    const infoLines = [
      labelStyle('Directory: ') + this.state.workDir,
      labelStyle('Session:   ') + this.state.sessionId,
      labelStyle('Model:     ') + modelValue,
      labelStyle('Version:   ') + this.state.version,
    ];

    if (this.state.mcpServersSummary) {
      infoLines.push(labelStyle('MCP:       ') + this.state.mcpServersSummary);
    }

    const contentLines: string[] = [
      ...bannerLines,
      ...mascotLines(bannerLines, layout, appearance, innerWidth),
      '',
      promptLine,
      '',
      ...infoLines,
    ];

    return [
      '',
      ...renderRendererFrameRows({
        content: [
          renderParticleRail(safeWidth - 2, appearance, 'welcome-top'),
          ...contentLines.map((content) => `  ${truncateToWidth(content, innerWidth, '…')}`),
          renderParticleRail(safeWidth - 2, appearance, 'welcome-bottom'),
        ],
        width: safeWidth,
        height: contentLines.length + 4,
        borderKind: 'rounded',
        borderStyle: primary,
        ellipsis: '…',
      }),
      '',
    ];
  }
}

/**
 * Center the mascot art under the banner. The mascot is intentionally compact
 * (3-line art) and only appears on wide terminals so it does not crowd the
 * transcript on standard widths. We force the compact layout variant so the
 * welcome stays short regardless of the appearance mascot preference.
 */
function mascotLines(
  bannerLines: readonly string[],
  layout: ResponsiveLayoutProfile,
  appearance: AppearancePreferences,
  innerWidth: number,
): string[] {
  if (layout !== 'wide' && layout !== 'ultrawide') return [];
  // Render with a forced compact layout so we always get the small art.
  const mascot = renderLioraMascotIcon({ layout: 'compact', appearance });
  if (mascot.length === 0) return [''];
  const mascotWidth = mascot.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  return ['', ...mascot.map((line) => centerLine(line, mascotWidth, innerWidth))];
}

function centerLine(line: string, contentWidth: number, targetWidth: number): string {
  if (contentWidth >= targetWidth) return truncateToWidth(line, targetWidth, '…');
  const pad = Math.floor((targetWidth - contentWidth) / 2);
  return `${' '.repeat(pad)}${line}`;
}
