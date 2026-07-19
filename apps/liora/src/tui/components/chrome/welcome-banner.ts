import type { AppearancePreferences } from '#/tui/config';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import {
  hashRendererEffectSeed,
  mixHexColor,
  rendererPositiveModulo,
  renderRendererStyledTextRunsAnsi,
  splitDisplayClusters,
  truncateToWidth,
  type RendererCellStyle,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  motionEffectsAllowed,
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

/** Soft sparkles in figlet padding — monospace-safe only. */
const BANNER_SPARKLES = ['·', '∙', '•', '◦'] as const;

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
 * Vertical brand gradient (smoothstep across figlet rows) plus a soft
 * traveling shimmer and sparse space sparkles. Stays on gradientStart→End /
 * glow — never opposite-hue role tokens.
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
  const start = currentTheme.color('gradientStart');
  const end = currentTheme.color('gradientEnd');
  const glow = currentTheme.color('glow');
  const particle = currentTheme.color('particle');
  const baseHex = mixHexColor(start, end, s);

  const premium = mode === 'premium';
  const cycleMs = premium ? 88 : 140;
  const tickFloat = appearanceAnimationNow() / cycleMs;
  const tick = Math.floor(tickFloat);
  const seed = hashRendererEffectSeed(`welcome:banner:${String(rowIndex)}`) + rowIndex * 37;
  const crestLift = premium ? 0.58 : 0.36;

  const runs: RendererStyledTextRun[] = [];
  let clusterIndex = 0;
  for (const cluster of splitDisplayClusters(plain)) {
    const char = cluster.text;
    if (char === ' ') {
      if (
        premium &&
        rendererPositiveModulo(seed + clusterIndex + tick * 3, 21) === 0
      ) {
        const glyph =
          BANNER_SPARKLES[
            rendererPositiveModulo(seed + tick + clusterIndex, BANNER_SPARKLES.length)
          ]!;
        runs.push({
          text: glyph,
          style: withBannerCanvasBackground({
            fg: mixHexColor(particle, glow, 0.35),
            bold: true,
          }),
        });
        clusterIndex += cluster.width;
        continue;
      }
      runs.push({ text: char, style: withBannerCanvasBackground(undefined) });
      clusterIndex += cluster.width;
      continue;
    }

    // Traveling crest along the row; stays blended with the row's gradient base.
    const wave = Math.sin(clusterIndex * 0.42 + tickFloat * 0.9 + rowIndex * 0.55);
    const crest = (wave + 1) / 2;
    const fg = mixHexColor(baseHex, glow, crest * crestLift);
    runs.push({
      text: char,
      style: withBannerCanvasBackground({ fg, bold: true }),
    });
    clusterIndex += cluster.width;
  }

  return renderRendererStyledTextRunsAnsi(runs, { resetStyle: true });
}

function withBannerCanvasBackground(
  style: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  if (!currentTheme.canvasBackgroundEnabled) return style;
  const bg = currentTheme.color('background');
  if (style === undefined) return { bg };
  if (style.bg !== undefined) return style;
  return { ...style, bg };
}
