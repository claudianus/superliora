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
import { renderParticleRail } from '#/tui/utils/appearance-effects';
import { renderWelcomeBanner } from './welcome-banner';

const LOGGED_IN_PROMPT =
  'Type a task · /status web·office·media·ZDR · /bench · Shift-Tab Ultrawork';
const LOGGED_OUT_PROMPT = 'Run /login or paste an API key — media/web/office ready after that, no MCP.';

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
        ? chalk.hex(currentTheme.palette.warning)(LOGGED_OUT_PROMPT)
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
      dim(isLoggedOut ? LOGGED_OUT_PROMPT : LOGGED_IN_PROMPT),
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
      '',
      promptLine,
      '',
      ...infoLines,
    ];

    return [
      '',
      ...renderRendererFrameRows({
        content: [
          ...contentLines.map((content) => `  ${truncateToWidth(content, innerWidth, '…')}`),
          renderParticleRail(safeWidth - 2, appearance, 'welcome-rail'),
        ],
        width: safeWidth,
        height: contentLines.length + 3,
        borderKind: 'rounded',
        borderStyle: primary,
        ellipsis: '…',
      }),
      '',
    ];
  }
}
