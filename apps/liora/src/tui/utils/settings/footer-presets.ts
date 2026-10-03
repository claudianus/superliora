/**
 * Footer (status bar) named packs.
 */

import {
  DEFAULT_FOOTER_PREFERENCES,
  type FooterPreferences,
} from '#/tui/config';

import type { SettingPreset } from './setting-presets';

export type FooterPresetId = 'minimal' | 'standard' | 'dense';

export const FOOTER_PRESETS: readonly SettingPreset<FooterPresetId, FooterPreferences>[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    badge: 'quiet',
    description: 'Model + context + menu only; tips/pulses off.',
    patch: {
      ...DEFAULT_FOOTER_PREFERENCES,
      labels: 'plain',
      modes: 'off',
      model: 'always',
      cwd: 'off',
      git: 'off',
      context: 'auto',
      menu: 'always',
      background: 'off',
      tips: 'off',
      quota: 'off',
      cache: 'off',
      pulseFleetComplete: false,
      pulsePermission: false,
      pulseGitChurn: false,
      pulseModelRoute: false,
      showCompact: false,
    },
  },
  {
    id: 'standard',
    label: 'Standard',
    badge: 'recommended',
    description: 'Layered defaults — essentials auto, helpful pulses on.',
    patch: { ...DEFAULT_FOOTER_PREFERENCES },
  },
  {
    id: 'dense',
    label: 'Dense',
    badge: 'power',
    description: 'Compact labels · show most slots · all pulses.',
    patch: {
      ...DEFAULT_FOOTER_PREFERENCES,
      labels: 'compact',
      modes: 'always',
      model: 'always',
      cwd: 'always',
      git: 'always',
      context: 'always',
      menu: 'always',
      background: 'always',
      tips: 'auto',
      quota: 'always',
      cache: 'auto',
      pulseFleetComplete: true,
      pulsePermission: true,
      pulseGitChurn: true,
      pulseModelRoute: true,
      showCompact: true,
    },
  },
];
