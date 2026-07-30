/**
 * Jewel Tank color system — the resolved-per-frame `AquariumPalette`, the
 * jewel-kit source hues (dark/light), and the theme-tint resolver.
 *
 * Split out of `idle-scene.ts`; no behavior change.
 */

import { mixHexColor } from '#/tui/renderer';

export interface AquariumPalette {
  readonly water: string;
  readonly waterDeep: string;
  readonly waterSoft: string;
  /** Deepest water / abyss tint for volume. */
  readonly waterAbyss: string;
  readonly plant: string;
  readonly plantSoft: string;
  /** Occasional red/magenta tip plants. */
  readonly plantAccent: string;
  readonly sand: string;
  readonly coral: string;
  readonly coralSoft: string;
  readonly food: string;
  readonly fishGold: string;
  readonly fishSky: string;
  readonly fishTeal: string;
  readonly fishSoft: string;
  /** Brand Blood-Moon rose variant (#FF6B7A) — a rare coral-pink companion. */
  readonly fishRose: string;
  readonly bubble: string;
  /** Warm surface shaft / caustic light. */
  readonly shaft: string;
  readonly dim: string;
}

export type IdleSceneColors = {
  readonly glow: string;
  readonly particle: string;
  readonly primary: string;
  readonly accent: string;
  readonly textDim: string;
  readonly textMuted: string;
  readonly gradientStart?: string;
  readonly gradientEnd?: string;
  readonly roleUser?: string;
  readonly shellMode?: string;
  /** Natural plant green — aquarium uses this on purpose. */
  readonly success?: string;
  /** Dark aquasoil / gravel. */
  readonly surfaceSunken?: string;
};

/**
 * Jewel-tank paint kit — fish/plants stay vivid; water wash stays subdued so
 * the stage canvas does not read as a solid cyan slab.
 */
export const JEWEL_TANK_DARK = {
  water: '#4A7FA0',
  waterSoft: '#2A4F68',
  waterDeep: '#123044',
  waterAbyss: '#0A1420',
  plant: '#2EFF7A',
  plantSoft: '#A8FF4A',
  plantAccent: '#FF2E9A',
  sand: '#14100C',
  sandGlint: '#D4A574',
  coral: '#F0A84A',
  coralSoft: '#A86B28',
  food: '#FFD60A',
  fishGold: '#FF6A00',
  fishSky: '#3B6CFF',
  fishTeal: '#00E5A8',
  fishSoft: '#FF5EC8',
  fishRose: '#FF6B7A',
  bubble: '#8AB8C8',
  shaft: '#C4B87A',
  highlight: '#FFFFFF',
  ink: '#0A0E14',
  dim: '#5A6578',
} as const;

export const JEWEL_TANK_LIGHT = {
  water: '#4B7A8F',
  waterSoft: '#3A6478',
  waterDeep: '#2A4A5C',
  waterAbyss: '#1E3340',
  plant: '#16A34A',
  plantSoft: '#65A30D',
  plantAccent: '#DB2777',
  sand: '#292524',
  sandGlint: '#A16207',
  coral: '#D97706',
  coralSoft: '#92400E',
  food: '#CA8A04',
  fishGold: '#EA580C',
  fishSky: '#2563EB',
  fishTeal: '#0D9488',
  fishSoft: '#DB2777',
  fishRose: '#E63946',
  bubble: '#67A8B8',
  shaft: '#C4B06A',
  highlight: '#FFFFFF',
  ink: '#1C1917',
  dim: '#78716C',
} as const;

/**
 * Resolve aquarium paint roles: jewel kit as structure, current theme colors as
 * strong tint so red / blue / cyan chrome all retint the tank together.
 */
export function resolveAquariumPalette(
  colors: IdleSceneColors,
  theme: 'dark' | 'light' = 'dark',
): AquariumPalette {
  const jewel = theme === 'light' ? JEWEL_TANK_LIGHT : JEWEL_TANK_DARK;
  const gStart = colors.gradientStart ?? colors.glow;
  const gEnd = colors.gradientEnd ?? colors.primary;
  const plantTheme = colors.success ?? colors.accent;
  const sunken = colors.surfaceSunken ?? jewel.waterAbyss;
  const warm = colors.roleUser ?? colors.primary;
  const cool = colors.shellMode ?? colors.glow;

  return {
    // Water wash — theme glow/primary/gradient dominate; keeps depth quiet.
    water: mixHexColor(jewel.water, colors.glow, 0.62),
    waterSoft: mixHexColor(jewel.waterSoft, colors.primary, 0.55),
    waterDeep: mixHexColor(jewel.waterDeep, gStart, 0.52),
    waterAbyss: mixHexColor(jewel.waterAbyss, mixHexColor(sunken, gStart, 0.18), 0.62),
    // Plants follow theme success/accent while staying leafy.
    plant: mixHexColor(jewel.plant, plantTheme, 0.55),
    plantSoft: mixHexColor(jewel.plantSoft, colors.accent, 0.48),
    plantAccent: mixHexColor(jewel.plantAccent, colors.accent, 0.45),
    sand: mixHexColor(jewel.sand, sunken, 0.7),
    coral: mixHexColor(jewel.coral, warm, 0.42),
    coralSoft: mixHexColor(jewel.coralSoft, warm, 0.35),
    food: mixHexColor(jewel.food, warm, 0.3),
    fishGold: mixHexColor(jewel.fishGold, warm, 0.38),
    fishSky: mixHexColor(jewel.fishSky, colors.primary, 0.5),
    fishTeal: mixHexColor(jewel.fishTeal, cool, 0.48),
    fishSoft: mixHexColor(jewel.fishSoft, colors.accent, 0.42),
    fishRose: mixHexColor(jewel.fishRose, colors.primary, 0.45),
    bubble: mixHexColor(jewel.bubble, colors.particle, 0.55),
    shaft: mixHexColor(jewel.shaft, gEnd, 0.4),
    dim: mixHexColor(jewel.dim, colors.textDim, 0.55),
  };
}
