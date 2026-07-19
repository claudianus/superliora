import chalk from 'chalk';

import type { AppearancePreferences } from '#/tui/config';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import { mixHexColor, truncateToWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  renderSpectacularText,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

// figlet Slant "SUPERLIORA".
const BANNER_LARGE = [
  '   _____ __  ______  __________  __    ________  ____  ___ ',
  '  / ___// / / / __ \\/ ____/ __ \\/ /   /  _/ __ \\/ __ \\/   |',
  '  \\__ \\/ / / / /_/ / __/ / /_/ / /    / // / / / /_/ / /| |',
  ' ___/ / /_/ / ____/ /___/ _, _/ /____/ // /_/ / _, _/ ___ |',
  '/____/\\____/_/   /_____/_/ |_/_____/___/\\____/_/ |_/_/  |_|',
] as const;

// figlet Small "SUPERLIORA"
const BANNER_COMPACT = [
  ' ___ _   _ ___ ___ ___ _    ___ ___  ___    _   ',
  '/ __| | | | _ \\ __| _ \\ |  |_ _/ _ \\| _ \\  /_\\  ',
  '\\__ \\ |_| |  _/ _||   / |__ | | (_) |   / / _ \\ ',
  '|___/\\___/|_| |___|_|_\\____|___\\___/|_|_\\/_/ \\_\\',
] as const;

export function renderWelcomeBanner(
  layout: ResponsiveLayoutProfile,
  appearance: AppearancePreferences,
  width: number,
): string[] {
  if (layout === 'tiny' || width < 24) {
    return [paintBannerLine('SUPERLIORA', appearance, 0, 1, width)];
  }
  const useLarge =
    layout === 'standard' || layout === 'wide' || layout === 'ultrawide' || width >= 59;
  const lines = useLarge ? BANNER_LARGE : BANNER_COMPACT;
  return lines.map((line, index) => paintBannerLine(line, appearance, index, lines.length, width));
}

/**
 * Vertical brand gradient across figlet rows (smoothstep), not a multi-hue
 * spectacular wave — that read as yellow→pink→violet bands after hue-span.
 */
function paintBannerLine(
  line: string,
  appearance: AppearancePreferences,
  rowIndex: number,
  rowCount: number,
  maxWidth: number,
): string {
  const plain = truncateToWidth(line, maxWidth, '…');
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('primary', plain);
  }
  const t = rowCount <= 1 ? 0.5 : rowIndex / (rowCount - 1);
  const s = t * t * (3 - 2 * t);
  const hex = mixHexColor(
    currentTheme.color('gradientStart'),
    currentTheme.color('gradientEnd'),
    s,
  );
  // Short single-line titles can keep a soft spectacular shimmer.
  if (rowCount <= 1 && mode === 'premium') {
    return renderSpectacularText(plain, `welcome:banner:${String(rowIndex)}`, appearance, {
      rowIndex,
      intense: false,
      pace: 'slow',
    });
  }
  if (currentTheme.canvasBackgroundEnabled) {
    return chalk.bgHex(currentTheme.color('background')).hex(hex).bold(plain);
  }
  return chalk.hex(hex).bold(plain);
}
