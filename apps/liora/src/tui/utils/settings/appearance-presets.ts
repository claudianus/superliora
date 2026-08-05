/**
 * Appearance pack presets — multi-field tui.toml [appearance] patches.
 */

import type { AppearancePreferences } from '#/tui/config';

import type { SettingPreset } from './setting-presets';

export type AppearancePresetId = 'off' | 'calm' | 'subtle' | 'premium';

export type AppearancePresetPatch = Partial<AppearancePreferences>;

export const APPEARANCE_PRESETS: readonly SettingPreset<
  AppearancePresetId,
  AppearancePresetPatch
>[] = [
  {
    id: 'off',
    label: 'Off',
    badge: 'no motion',
    description: 'Motion and particles off — max clarity / SSH-friendly.',
    patch: {
      profile: 'off',
      particles: 'off',
      animationFps: 15,
      transcriptDetail: 'compact',
    },
  },
  {
    id: 'calm',
    label: 'Calm',
    badge: 'quiet',
    description: 'Subtle motion, comfortable density, standard transcript.',
    patch: {
      profile: 'subtle',
      particles: 'ambient',
      density: 'comfortable',
      animationFps: 30,
      transcriptDetail: 'standard',
    },
  },
  {
    id: 'subtle',
    label: 'Subtle',
    badge: 'balanced',
    description: 'Reduced accents with neat cards and standard detail.',
    patch: {
      profile: 'subtle',
      particles: 'events',
      density: 'comfortable',
      neat: true,
      transcriptDetail: 'standard',
    },
  },
  {
    id: 'premium',
    label: 'Premium',
    badge: 'full',
    description: 'Full ambient motion, spacious chrome, full transcript.',
    patch: {
      profile: 'premium',
      particles: 'premium',
      density: 'spacious',
      animationFps: 60,
      transcriptDetail: 'full',
      neat: true,
    },
  },
];

export function matchAppearancePresetId(
  appearance: AppearancePreferences,
): AppearancePresetId | undefined {
  for (const preset of APPEARANCE_PRESETS) {
    const p = preset.patch;
    if (
      (p.profile === undefined || p.profile === appearance.profile) &&
      (p.particles === undefined || p.particles === appearance.particles) &&
      (p.density === undefined || p.density === appearance.density) &&
      (p.transcriptDetail === undefined || p.transcriptDetail === appearance.transcriptDetail)
    ) {
      return preset.id;
    }
  }
  return undefined;
}
