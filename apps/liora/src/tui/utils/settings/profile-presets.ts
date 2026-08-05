import type { SettingPreset } from './setting-presets';

export type AgentProfilePresetId = 'core' | 'agent' | 'conductor' | 'superliora-full';

export interface AgentProfilePresetPatch {
  readonly profile: AgentProfilePresetId;
}

export const AGENT_PROFILE_PRESETS: readonly SettingPreset<
  AgentProfilePresetId,
  AgentProfilePresetPatch
>[] = [
  {
    id: 'core',
    label: 'Core',
    badge: 'slim tools',
    description: 'Minimal tool waist — safest default for everyday chat.',
    patch: { profile: 'core' },
  },
  {
    id: 'agent',
    label: 'Agent',
    badge: 'standard',
    description: 'Balanced coding tools for normal agent work.',
    patch: { profile: 'agent' },
  },
  {
    id: 'conductor',
    label: 'Conductor',
    badge: 'orchestrate',
    description: 'Orchestration-oriented profile for multi-agent runs.',
    patch: { profile: 'conductor' },
  },
  {
    id: 'superliora-full',
    label: 'Full',
    badge: 'everything',
    description: 'Widest tool waist — power users / swarm staffing.',
    patch: { profile: 'superliora-full' },
  },
];
