/**
 * OAuth device-code panel rendered inside the transcript.
 *
 * Same live rounded frame as Command Hub (breath + comet + jewel corners).
 * Motion off / SSH / NO_COLOR / CI fall back to a static borderFocus box.
 */

import type { Component } from '#/tui/renderer';
import { stripAnsiControls, truncateToWidth, visibleWidth } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderParticleRail,
  renderPremiumBoxFrame,
  renderPremiumHeadline,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { ttui } from '#/tui/utils/tui-i18n';

export interface DeviceCodeBoxParams {
  readonly title: string;
  readonly url: string;
  readonly code: string;
  readonly hint?: string;
}

/** Frame minimum from renderPremiumBoxFrame; narrower terminals stay unframed. */
const PREMIUM_FRAME_MIN_WIDTH = 8;
const BODY_PAD = '  ';

export class DeviceCodeBoxComponent implements Component {
  private readonly params: DeviceCodeBoxParams;
  /** Entry bloom start — shared animation clock (PREMIUM §7.1). */
  private readonly openedAtMs = appearanceAnimationNow();

  constructor(params: DeviceCodeBoxParams) {
    this.params = params;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { title, url, code, hint } = this.params;
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const titleStyled = animated
      ? renderPremiumHeadline(title, 'device-code:title', appearance)
      : currentTheme.boldFg('textStrong', title);
    const promptLine = currentTheme.fg('textDim', ttui('tui.device.visitUrl'));
    const urlLine = currentTheme.fg('primary', url);
    const codeLabel = currentTheme.boldFg('textDim', ttui('tui.device.codeLabel'));
    const codeValue = animated
      ? renderSpectacularText(code, 'device-code:code', appearance, { intense: true })
      : currentTheme.boldFg('accent', code);
    const codeLine = `${codeLabel}${codeValue}`;
    const hintText = hint !== undefined && hint.length > 0 ? hint : '';

    if (safeWidth < PREMIUM_FRAME_MIN_WIDTH) {
      const lines = [titleStyled, '', promptLine, urlLine, '', codeLine];
      if (hintText.length > 0) {
        lines.push('');
        lines.push(currentTheme.fg('textDim', hintText));
      }
      return ['', ...lines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }

    const inner = safeWidth - 2;
    const titlePlain = stripAnsiControls(titleStyled);
    const titleFits = visibleWidth(titlePlain) + 4 <= inner;
    const pad = (line: string): string => truncateToWidth(`${BODY_PAD}${line}`, inner, '…');
    const body: string[] = [
      renderParticleRail(inner, appearance, 'device-code-top'),
      '',
    ];
    if (!titleFits) {
      body.push(pad(titleStyled), '');
    }
    body.push(pad(promptLine), pad(urlLine), '', pad(codeLine));

    const frame = renderPremiumBoxFrame(body, {
      width: safeWidth,
      title: titleFits ? titleStyled : undefined,
      titlePlain: titleFits ? titlePlain : undefined,
      footerLeft:
        hintText.length > 0 ? currentTheme.fg('textDim', hintText) : undefined,
      footerLeftPlain: hintText.length > 0 ? hintText : undefined,
      appearance,
      openedAtMs: this.openedAtMs,
    });

    return ['', ...frame, ''];
  }
}
