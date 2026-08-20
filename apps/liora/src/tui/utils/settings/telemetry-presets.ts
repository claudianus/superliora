import type { SettingPreset } from './setting-presets';

export type TelemetryPresetId = 'off' | 'on';

export interface TelemetryPresetPatch {
  readonly telemetry: boolean;
}

export const TELEMETRY_PRESETS: readonly SettingPreset<TelemetryPresetId, TelemetryPresetPatch>[] =
  [
    {
      id: 'off',
      label: 'Off',
      badge: 'local-only',
      labelKey: 'tui.preset.telemetry.off.label',
      badgeKey: 'tui.preset.telemetry.off.badge',
      descriptionKey: 'tui.preset.telemetry.off.desc',
      description: 'No product telemetry (default for privacy).',
      patch: { telemetry: false },
    },
    {
      id: 'on',
      label: 'On',
      badge: 'analytics',
      labelKey: 'tui.preset.telemetry.on.label',
      badgeKey: 'tui.preset.telemetry.on.badge',
      descriptionKey: 'tui.preset.telemetry.on.desc',
      description: 'Enable product telemetry when the build supports it.',
      patch: { telemetry: true },
    },
  ];
