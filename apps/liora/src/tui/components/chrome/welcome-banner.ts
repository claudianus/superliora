import type { AppearancePreferences } from '#/tui/config';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import { truncateToWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { gradientText } from '#/tui/theme/gradient-text';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

// figlet Slant "SUPERLIORA". Regenerate via scripts/generate-liora-mascot-art.sh banner.
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
    return [paintBannerLine('SUPERLIORA', appearance, 0, width)];
  }
  const useLarge =
    layout === 'standard' || layout === 'wide' || layout === 'ultrawide' || width >= 59;
  const lines = useLarge ? BANNER_LARGE : BANNER_COMPACT;
  return lines.map((line, index) => paintBannerLine(line, appearance, index, width));
}

function paintBannerLine(
  line: string,
  appearance: AppearancePreferences,
  rowIndex: number,
  maxWidth: number,
): string {
  const plain = truncateToWidth(line, maxWidth, '…');
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (motionEffectsAllowed() && mode !== 'off') {
    // Per-grapheme gradient keeps every figlet cell (including spaces) styled so
    // canvas-background fills do not paint a solid block behind the ASCII art.
    return gradientText(
      plain,
      currentTheme.color('gradientStart'),
      currentTheme.color('gradientEnd'),
      1.2,
      rowIndex * 2,
    );
  }
  return currentTheme.boldFg('primary', plain);
}
