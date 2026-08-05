/**
 * Editor / notifications packs (tui.toml).
 */

import type { TuiConfig } from '#/tui/config';

import type { SettingPreset } from './setting-presets';

export type EditorPresetId = 'quiet' | 'standard' | 'notify-always';

export type EditorPresetPatch = Partial<
  Pick<TuiConfig, 'disablePasteBurst' | 'notifications'>
>;

export const EDITOR_PRESETS: readonly SettingPreset<EditorPresetId, EditorPresetPatch>[] = [
  {
    id: 'quiet',
    label: 'Quiet',
    badge: 'no desktop notify',
    description: 'Notifications off · paste-burst fallback allowed.',
    patch: {
      disablePasteBurst: false,
      notifications: { enabled: false, condition: 'unfocused' },
    },
  },
  {
    id: 'standard',
    label: 'Standard',
    badge: 'recommended',
    description: 'Notify when unfocused · paste-burst on.',
    patch: {
      disablePasteBurst: false,
      notifications: { enabled: true, condition: 'unfocused' },
    },
  },
  {
    id: 'notify-always',
    label: 'Always notify',
    badge: 'loud',
    description: 'Desktop notifications always · disable paste-burst fallback.',
    patch: {
      disablePasteBurst: true,
      notifications: { enabled: true, condition: 'always' },
    },
  },
];
