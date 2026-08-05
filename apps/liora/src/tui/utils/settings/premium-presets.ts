import type { SettingPreset } from './setting-presets';

export type PremiumPresetId = 'off' | 'on';

export interface PremiumPresetPatch {
  readonly premiumQuality: boolean;
}

export const PREMIUM_PRESETS: readonly SettingPreset<PremiumPresetId, PremiumPresetPatch>[] = [
  {
    id: 'off',
    label: 'Visual Quality OFF',
    badge: 'lean',
    description: 'Disable harness PQ mode for this session.',
    patch: { premiumQuality: false },
  },
  {
    id: 'on',
    label: 'Visual Quality ON',
    badge: 'premium',
    description: 'Harness art direction + denser visual feedback.',
    patch: { premiumQuality: true },
  },
];
