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
      description: 'No product telemetry (default for privacy).',
      patch: { telemetry: false },
    },
    {
      id: 'on',
      label: 'On',
      badge: 'analytics',
      description: 'Enable product telemetry when the build supports it.',
      patch: { telemetry: true },
    },
  ];
