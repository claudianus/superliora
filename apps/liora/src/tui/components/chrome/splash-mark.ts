import {
  type AppearancePreferences,
} from '#/tui/config';
import { motionEffectsAllowed } from '#/tui/features/appearance/appearance-effects';
import { resolveQualityAdjustedAmbientEffectMode } from '#/tui/features/appearance/appearance-effects';
import { hashRendererEffectSeed } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  LIORA_MARK_COMPACT,
  LIORA_MARK_LARGE,
} from '#/tui/features/stage/night-sky';

/** Texture skin for the rising Liora mark — monospace-safe block family only. */
export type MarkTextureSkin = 'solid' | 'halfBlock' | 'braille' | 'line';

const MARK_TEXTURE_SKINS: readonly MarkTextureSkin[] = [
  'solid',
  'halfBlock',
  'braille',
  'line',
];

const MARK_TEXTURE_BRUSHES: Readonly<
  Record<Exclude<MarkTextureSkin, 'solid'>, readonly string[]>
> = {
  halfBlock: ['▀', '▄'],
  braille: ['⣿', '⣶', '⣤', '⣀'],
  line: ['─', '│'],
};

export function selectMarkTextureSkin(seed: number): MarkTextureSkin {
  const index =
    ((seed % MARK_TEXTURE_SKINS.length) + MARK_TEXTURE_SKINS.length) %
    MARK_TEXTURE_SKINS.length;
  return MARK_TEXTURE_SKINS[index] ?? 'solid';
}

/**
 * Theme-seeded mark texture pick. Reduced-motion / low-color profiles
 * (effect mode `'off'`) keep the solid mark — the static fallback.
 *
 * The live splash render passes no explicit seed and paints the canonical
 * solid brand mark, so the rising mark is stable and deterministic across
 * launches. Texture variants stay addressable through an explicit seed
 * (captures, golden output, demos) via `selectMarkTextureSkin`.
 */
export function resolveMarkTextureSkin(
  appearance: AppearancePreferences,
  seed?: number,
): MarkTextureSkin {
  if (!motionEffectsAllowed() || resolveQualityAdjustedAmbientEffectMode(appearance) === 'off') {
    return 'solid';
  }
  if (seed === undefined) {
    return 'solid';
  }
  const palette = currentTheme.palette;
  const themeSeed = hashRendererEffectSeed(
    `splash:mark-texture:${palette.gradientStart}:${palette.gradientMid}:${palette.gradientEnd}`,
  );
  return selectMarkTextureSkin(themeSeed + seed);
}

/**
 * Re-skin solid '█' cells of the mark with a texture brush. Only '█' is
 * replaced and every brush glyph is one cell wide, so row widths and the
 * downstream centering / blit math stay untouched.
 */
export function applyMarkTexture(
  rows: readonly string[],
  skin: MarkTextureSkin,
): readonly string[] {
  if (skin === 'solid') return rows;
  const brush = MARK_TEXTURE_BRUSHES[skin];
  return rows.map((row, rowIndex) => {
    let out = '';
    let col = 0;
    for (const char of row) {
      out += char === '█' ? brush[(rowIndex + col) % brush.length]! : char;
      col += 1;
    }
    return out;
  });
}

/** Deterministic capture of the textured splash mark (tests / golden output). */
export function captureSplashMarkRows(
  appearance: AppearancePreferences,
  width: number,
  seed?: number,
): readonly string[] {
  const base = width >= 40 ? LIORA_MARK_LARGE : LIORA_MARK_COMPACT;
  return applyMarkTexture(base, resolveMarkTextureSkin(appearance, seed));
}
