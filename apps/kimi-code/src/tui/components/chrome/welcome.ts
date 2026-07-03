/**
 * Welcome panel shown at the top of the TUI.
 * Renders a round-bordered box with the logo, session, model, and version.
 */

import type { Component } from '#/tui/renderer';
import { renderRendererFrameRows, truncateToWidth } from '#/tui/renderer';
import chalk from 'chalk';

import { PRODUCT_NAME } from '#/constant/app';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import {
  renderAnimatedGradientText,
  renderParticleRail,
} from '#/tui/utils/appearance-effects';
import { mascotWidth, renderKimiMascotIcon } from './kimi-mascot-icon';

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
    const titleText = `Welcome to ${PRODUCT_NAME}!`;

    if (safeWidth < 24 || layout === 'tiny') {
      const title = renderAnimatedGradientText(titleText, 'welcome:title', appearance);
      const prompt = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('Run /login or /provider to get started.')
        : chalk.hex(currentTheme.palette.textDim)(LOGGED_IN_PROMPT);
      const model = isLoggedOut
        ? chalk.hex(currentTheme.palette.warning)('not set, run /login or /provider')
        : (activeModel?.displayName ?? activeModel?.model ?? this.state.model);
      return ['', title, prompt, `Model: ${model}`].map((line) =>
        truncateToWidth(line, safeWidth, '…'),
      );
    }

    const innerWidth = Math.max(1, safeWidth - 4);

    // Mascot + side-by-side text.
    const logo = renderKimiMascotIcon({ layout, appearance });
    const logoWidth = logo.length === 0 ? 0 : mascotWidth(logo);
    const gap = '  ';
    const textWidth = Math.max(4, innerWidth - logoWidth - (logoWidth > 0 ? gap.length : 0));

    const rightRow0 = truncateToWidth(
      renderAnimatedGradientText(titleText, 'welcome:title', appearance),
      textWidth,
      '…',
    );
    const dim = chalk.hex(currentTheme.palette.textDim);
    const labelStyle = chalk.bold.hex(currentTheme.palette.textDim);
    const rightRow1 = truncateToWidth(
      dim(isLoggedOut ? 'Run /login or /provider to get started.' : LOGGED_IN_PROMPT),
      textWidth,
      '…',
    );

    const textRows = [rightRow0, rightRow1];
    const headerRows = Math.max(logo.length, textRows.length);
    const renderedHeaderLines: string[] = [];
    for (let i = 0; i < headerRows; i++) {
      const logoRow = logo[i] ?? ''.padEnd(logoWidth);
      const textRow = textRows[i] ?? '';
      renderedHeaderLines.push(
        logoWidth > 0
          ? logoRow + gap + textRow
          : textRow,
      );
    }

    const modelValue = isLoggedOut
      ? chalk.hex(currentTheme.palette.warning)('not set, run /login or /provider')
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

    const contentLines: string[] = [...renderedHeaderLines, '', ...infoLines];

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
