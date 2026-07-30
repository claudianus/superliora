import {
  hashRendererEffectSeed,
  mixHexColor,
  rendererPositiveModulo,
  renderRendererStyledTextRunsAnsi,
  splitDisplayClusters,
  stripAnsiControls,
  type RendererCellStyle,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-state';
import { PARTICLE_TOKENS, PREMIUM_PARTICLES } from '#/tui/features/appearance/appearance-particles';
import { renderShimmerPrefix } from '#/tui/features/appearance/appearance-shimmer';

/** Smooth brand-family chain for headlines / figlet — no opposite-hue role jumps. */
export const SPECTACULAR_TOKENS: readonly ColorToken[] = [
  'gradientStart',
  'primary',
  'glow',
  'accent',
  'particle',
  'gradientEnd',
];

export interface SpectacularTextOptions {
  readonly rowIndex?: number;
  /** Faster color cycling and space sparkles. */
  readonly intense?: boolean;
  /** Slower wave for secondary copy. */
  readonly pace?: 'fast' | 'slow';
}

export function renderAnimatedGradientText(
  text: string,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') return currentTheme.boldFg('primary', plainText);
  return renderSpectacularText(plainText, seed, appearance, {
    intense: mode === 'premium',
    pace: mode === 'premium' ? 'fast' : 'slow',
  });
}

export function renderSpectacularText(
  text: string,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  options: SpectacularTextOptions = {},
): string {
  // Callers sometimes pass already-styled chalk/ANSI fragments (queue pointer,
  // thinking density, etc.). Strip controls first so per-cluster restyling
  // never re-escapes SGR bodies into visible `[0;1;38;2…` garbage.
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('primary', plainText);
  }

  const rowIndex = options.rowIndex ?? 0;
  const intense = options.intense !== false && mode === 'premium';
  const pace = options.pace ?? (intense ? 'fast' : 'slow');
  const cycleMs = resolveSpectacularTextCycleMs(appearance, pace, intense);
  const nowMs = appearanceAnimationNow();
  const tickFloat = nowMs / cycleMs;
  const tick = Math.floor(tickFloat);
  const base = hashRendererEffectSeed(seed) + rowIndex * 37;
  const waveStride = resolveSpectacularWaveStride(intense, pace);
  const waveSpan = SPECTACULAR_TOKENS.length * 4;
  const runs: RendererStyledTextRun[] = [];
  let clusterIndex = 0;

  for (const cluster of splitDisplayClusters(plainText)) {
    const char = cluster.text;
    if (char === ' ') {
      if (
        intense &&
        rendererPositiveModulo(base + clusterIndex + tick * 3, 23) === 0
      ) {
        const glyph =
          PREMIUM_PARTICLES[
            rendererPositiveModulo(base + tick + clusterIndex, PREMIUM_PARTICLES.length)
          ]!;
        runs.push({
          text: glyph,
          style: withSpectacularCanvasBackground({
            fg: currentTheme.color(
              PARTICLE_TOKENS[
                rendererPositiveModulo(base + tick + clusterIndex, PARTICLE_TOKENS.length)
              ]!,
            ),
            bold: true,
          }),
        });
        clusterIndex += cluster.width;
        continue;
      }
      runs.push({ text: char, style: withSpectacularCanvasBackground(undefined) });
      clusterIndex += cluster.width;
      continue;
    }

    const waveFloat = clusterIndex + tickFloat * waveStride + base;
    const wave = ((waveFloat % waveSpan) + waveSpan) % waveSpan;
    const tokenIndex = Math.floor(wave);
    const tokenA = SPECTACULAR_TOKENS[tokenIndex % SPECTACULAR_TOKENS.length]!;
    const tokenB = SPECTACULAR_TOKENS[(tokenIndex + 1) % SPECTACULAR_TOKENS.length]!;
    const blend = wave - tokenIndex;
    runs.push({
      text: char,
      style: withSpectacularCanvasBackground({
        fg: mixHexColor(currentTheme.color(tokenA), currentTheme.color(tokenB), blend),
        bold: intense || char !== char.toLowerCase() || /[\\/|_\-=+#@*]/.test(char),
      }),
    });
    clusterIndex += cluster.width;
  }

  return renderRendererStyledTextRunsAnsi(runs, { resetStyle: true });
}

export function renderPremiumHeadline(
  text: string,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plainText = stripAnsiControls(text);
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.boldFg('textStrong', plainText);
  }
  return `${renderShimmerPrefix(appearance)}${renderSpectacularText(plainText, seed, appearance, { intense: true })}`;
}

export function renderPremiumAccentLine(
  text: string,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plainText = stripAnsiControls(text);
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.fg('primary', plainText);
  }
  return renderSpectacularText(plainText, seed, appearance, { intense: true, pace: 'slow' });
}

function resolveSpectacularTextCycleMs(
  appearance: AppearancePreferences,
  pace: 'fast' | 'slow',
  intense: boolean,
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (mode === 'subtle') return pace === 'fast' ? 380 : 480;
  if (pace === 'slow') return intense ? 320 : 400;
  return intense ? 220 : 280;
}

function resolveSpectacularWaveStride(intense: boolean, pace: 'fast' | 'slow'): number {
  if (!intense) return 0.45;
  return pace === 'fast' ? 1 : 0.65;
}

function withSpectacularCanvasBackground(
  style: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  if (!currentTheme.canvasBackgroundEnabled) return style;
  const bg = currentTheme.color('background');
  if (style === undefined) return { bg };
  if (style.bg !== undefined) return style;
  return { ...style, bg };
}
