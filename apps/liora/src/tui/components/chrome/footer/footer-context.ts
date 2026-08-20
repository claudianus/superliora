import type { AppearancePreferences, FooterLabels } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme/theme';
import { formatTokenCount, safeUsageRatio } from '#/utils/usage/usage-format';
import {
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { renderLiveRatioBar } from '#/tui/components/chrome/chrome-band-motion';
import { labelContextPrefix } from '#/tui/components/chrome/footer/footer-labels';

export function safeContextUsage(usage: number): number {
  return safeUsageRatio(usage);
}

export function formatContextStatus(
  usage: number,
  tokens?: number,
  maxTokens?: number,
  labels: FooterLabels = 'plain',
  options: {
    readonly appearance?: AppearancePreferences;
    readonly filledToken?: ColorToken;
  } = {},
): string {
  const ratio = safeContextUsage(usage);
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const filledToken = options.filledToken ?? 'textMuted';
  const bar = renderLiveRatioBar(ratio, 10, {
    seed: 'footer:ctx',
    filledToken,
    eighths: true,
    appearance: options.appearance,
  });
  const suffix =
    maxTokens && maxTokens > 0 && tokens !== undefined
      ? `${pct} (${formatTokenCount(tokens)}/${formatTokenCount(maxTokens)})`
      : pct;
  const prefix = styleContextCopy(labelContextPrefix(labels), filledToken, options.appearance);
  const rest = styleContextCopy(suffix, filledToken, options.appearance);
  return `${prefix} ${bar} ${rest}`;
}

function styleContextCopy(
  text: string,
  token: ColorToken,
  appearance: AppearancePreferences | undefined,
): string {
  if (token === 'error' && appearance !== undefined && shouldRenderAmbientEffects(appearance)) {
    return renderPulseText(text, `footer:ctx:${text}`, 'error', appearance);
  }
  return currentTheme.boldFg(token, text);
}
