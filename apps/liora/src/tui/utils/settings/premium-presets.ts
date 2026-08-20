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
    labelKey: 'tui.preset.premium.off.label',
    badgeKey: 'tui.preset.premium.off.badge',
    descriptionKey: 'tui.preset.premium.off.desc',
    description: 'Disable harness PQ mode for this session.',
    patch: { premiumQuality: false },
  },
  {
    id: 'on',
    label: 'Visual Quality ON',
    badge: 'premium',
    labelKey: 'tui.preset.premium.on.label',
    badgeKey: 'tui.preset.premium.on.badge',
    descriptionKey: 'tui.preset.premium.on.desc',
    description: 'Harness art direction + denser visual feedback.',
    patch: { premiumQuality: true },
  },
];
