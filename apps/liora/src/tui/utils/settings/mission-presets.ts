import type { SettingPreset } from './setting-presets';

export type MissionPresetId = 'manual' | 'auto-start';

export interface MissionPresetPatch {
  readonly autoStart: boolean;
}

export const MISSION_PRESETS: readonly SettingPreset<MissionPresetId, MissionPresetPatch>[] = [
  {
    id: 'manual',
    label: 'Manual',
    badge: 'default',
    description: 'Start Mission only via /mission — no auto invent on open.',
    patch: { autoStart: false },
  },
  {
    id: 'auto-start',
    label: 'Auto-start opt-in',
    badge: 'queue',
    description: 'mission.autoStart = true (still start with /mission).',
    patch: { autoStart: true },
  },
];
