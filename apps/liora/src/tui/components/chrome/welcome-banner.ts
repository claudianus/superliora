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

/** Trademark sparkles in figlet padding — monospace-safe only. */
const BANNER_SPARKLES = ['·', '∙', '•', '◦', '*', '˚'] as const;

export function renderWelcomeBanner(
  layout: ResponsiveLayoutProfile,
  appearance: AppearancePreferences,
  width: number,
): string[] {
  if (layout === 'tiny' || width < 24) {
    return [paintBannerLine('SUPERLIORA', appearance, 0, 1, width)];
  }
  // Prefer a calm wordmark until the hero band is truly spacious. Compact
  // figlet still fights Status/Context on medium terminals (~100 cols).
  if (width < 110) {
    return [paintBannerLine('SUPERLIORA', appearance, 0, 1, width)];
  }
  return BANNER_LARGE.map((line, index) =>
    paintBannerLine(line, appearance, index, BANNER_LARGE.length, width),
  );
}

/**
 * Trademark SUPERLIORA hero: vertical brand gradient across figlet rows,
 * plus a slow in-row brand-wave, soft crest, and sparse space sparkles.
 * Stays on gradientStart / primary / glow / gradientEnd — never roleUser gold.
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
  const primary = currentTheme.color('primary');
  const glow = currentTheme.color('glow');
  const particle = currentTheme.color('particle');
  const accent = currentTheme.color('accent');
  // Row base on vertical brand gradient.
  const rowBase = mixHexColor(start, end, s);
  // Brand-only chain for the traveling wave (no opposite-hue roles).
  const brandChain = [
    start,
    mixHexColor(start, primary, 0.55),
    primary,
    mixHexColor(primary, glow, 0.5),
    glow,
    mixHexColor(glow, end, 0.45),
    end,
    mixHexColor(end, accent, 0.25),
  ] as const;

  const premium = mode === 'premium';
  // Calm brand glide: ~1.8s (premium) / ~2.6s (subtle) per chain lap — not a strobe.
  const cycleMs = premium ? 120 : 170;
  const tickFloat = appearanceAnimationNow() / cycleMs;
  const tick = Math.floor(tickFloat);
  const seed = hashRendererEffectSeed(`welcome:banner:${String(rowIndex)}`) + rowIndex * 41;
  const waveStride = premium ? 0.55 : 0.4;
  const crestLift = premium ? 0.58 : 0.4;
  const sparkleEvery = premium ? 14 : 20;

  const runs: RendererStyledTextRun[] = [];
  let clusterIndex = 0;
  for (const cluster of splitDisplayClusters(plain)) {
    const char = cluster.text;
    if (char === ' ') {
      if (rendererPositiveModulo(seed + clusterIndex + tick * 2, sparkleEvery) === 0) {
        const glyph =
          BANNER_SPARKLES[
            rendererPositiveModulo(seed + tick + clusterIndex, BANNER_SPARKLES.length)
          ]!;
        const hot = premium && rendererPositiveModulo(seed + tick + clusterIndex, 5) === 0;
        runs.push({
          text: glyph,
          style: withBannerCanvasBackground({
            fg: mixHexColor(hot ? glow : particle, accent, hot ? 0.28 : 0.16),
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

    // Dual motion: brand-chain wave + soft crest toward glow.
    const waveFloat = clusterIndex * 0.45 + tickFloat * waveStride + rowIndex * 0.6 + seed * 0.01;
    const chainLen = brandChain.length;
    const wavePos = ((waveFloat % chainLen) + chainLen) % chainLen;
    const i0 = Math.floor(wavePos);
    const blend = wavePos - i0;
    const waveHex = mixHexColor(
      brandChain[i0]!,
      brandChain[(i0 + 1) % chainLen]!,
      blend,
    );
    const crest = (Math.sin(clusterIndex * 0.3 + tickFloat * 0.55 + rowIndex * 0.5) + 1) / 2;
    const secondary = (Math.sin(clusterIndex * 0.75 + tickFloat * 0.3) + 1) / 2;
    let fg = mixHexColor(rowBase, waveHex, premium ? 0.52 : 0.36);
    fg = mixHexColor(fg, glow, crest * crestLift);
    if (premium && crest > 0.92) {
      // Occasional soft specular — not a strobe.
      fg = mixHexColor(fg, mixHexColor(glow, '#FFFFFF', 0.35), 0.32);
    } else if (premium && secondary > 0.94) {
      fg = mixHexColor(fg, particle, 0.18);
    }

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
