/**
 * OAuth device-code panel rendered inside the transcript.
 *
 * Borrows the rounded-border layout from `WelcomeComponent` so the login
 * prompt matches the rest of the chrome. All colors flow through the
 * active palette so theme switches take effect on the next render.
 */

import type { Component } from '#/tui/renderer';
import { renderRendererFrameRows, truncateToWidth } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderParticleRail,
  renderPremiumHeadline,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export interface DeviceCodeBoxParams {
  readonly title: string;
  readonly url: string;
  readonly code: string;
  readonly hint?: string;
}

export class DeviceCodeBoxComponent implements Component {
  private readonly params: DeviceCodeBoxParams;

  constructor(params: DeviceCodeBoxParams) {
    this.params = params;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { title, url, code, hint } = this.params;
    const border = (s: string): string => currentTheme.fg('primary', s);
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);

    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const titleLine = truncateToWidth(
      animated
        ? renderPremiumHeadline(title, 'device-code:title', appearance)
        : currentTheme.boldFg('textStrong', title),
      innerWidth,
      '…',
    );
    const promptLine = truncateToWidth(
      currentTheme.fg('textDim', 'Visit the URL below in your browser to authorize:'),
      innerWidth,
      '…',
    );
    const urlLine = truncateToWidth(currentTheme.fg('primary', url), innerWidth, '…');

    const codeLabel = currentTheme.boldFg('textDim', 'Verification code:  ');
    const codeValue = animated
      ? renderSpectacularText(code, 'device-code:code', appearance, { intense: true })
      : currentTheme.boldFg('accent', code);
    const codeLine = truncateToWidth(`${codeLabel}${codeValue}`, innerWidth, '…');

    const contentLines: string[] = [titleLine, '', promptLine, urlLine, '', codeLine];
    if (hint !== undefined && hint.length > 0) {
      contentLines.push('');
      contentLines.push(truncateToWidth(currentTheme.fg('textDim', hint), innerWidth, '…'));
    }

    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }

    return [
      '',
      ...renderRendererFrameRows({
        content: [
          renderParticleRail(safeWidth - 2, appearance, 'device-code-top'),
          '',
          ...contentLines,
          '',
        ],
        width: safeWidth,
        height: contentLines.length + 4,
        borderKind: 'rounded',
        paddingLeft: 2,
        paddingRight: 0,
        borderStyle: border,
        ellipsis: '…',
      }),
      '',
    ];
  }
}
