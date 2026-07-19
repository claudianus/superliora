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
  const useLarge =
    layout === 'standard' || layout === 'wide' || layout === 'ultrawide' || width >= 59;
  const lines = useLarge ? BANNER_LARGE : BANNER_COMPACT;
  return lines.map((line, index) => paintBannerLine(line, appearance, index, lines.length, width));
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
  // Slow clock: ~3–4s to walk the brand chain once (was sub-second / frantic).
  const cycleMs = premium ? 180 : 260;
  const tickFloat = appearanceAnimationNow() / cycleMs;
  const tick = Math.floor(tickFloat);
  const seed = hashRendererEffectSeed(`welcome:banner:${String(rowIndex)}`) + rowIndex * 41;
  const waveStride = premium ? 0.42 : 0.3;
  const crestLift = premium ? 0.48 : 0.32;
  const sparkleEvery = premium ? 16 : 24;

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
    const waveFloat = clusterIndex * 0.42 + tickFloat * waveStride + rowIndex * 0.55 + seed * 0.01;
    const chainLen = brandChain.length;
    const wavePos = ((waveFloat % chainLen) + chainLen) % chainLen;
    const i0 = Math.floor(wavePos);
    const blend = wavePos - i0;
    const waveHex = mixHexColor(
      brandChain[i0]!,
      brandChain[(i0 + 1) % chainLen]!,
      blend,
    );
    const crest = (Math.sin(clusterIndex * 0.28 + tickFloat * 0.38 + rowIndex * 0.45) + 1) / 2;
    const secondary = (Math.sin(clusterIndex * 0.7 + tickFloat * 0.22) + 1) / 2;
    let fg = mixHexColor(rowBase, waveHex, premium ? 0.48 : 0.34);
    fg = mixHexColor(fg, glow, crest * crestLift);
    if (premium && crest > 0.93) {
      // Rare soft specular — not a strobe.
      fg = mixHexColor(fg, mixHexColor(glow, '#FFFFFF', 0.35), 0.28);
    } else if (premium && secondary > 0.95) {
      fg = mixHexColor(fg, particle, 0.16);
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
