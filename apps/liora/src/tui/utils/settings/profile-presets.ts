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
    labelKey: 'tui.preset.profile.core.label',
    badgeKey: 'tui.preset.profile.core.badge',
    descriptionKey: 'tui.preset.profile.core.desc',
    description: 'Minimal tool waist — safest default for everyday chat.',
    patch: { profile: 'core' },
  },
  {
    id: 'agent',
    label: 'Agent',
    badge: 'standard',
    labelKey: 'tui.preset.profile.agent.label',
    badgeKey: 'tui.preset.profile.agent.badge',
    descriptionKey: 'tui.preset.profile.agent.desc',
    description: 'Balanced coding tools for normal agent work.',
    patch: { profile: 'agent' },
  },
  {
    id: 'conductor',
    label: 'Conductor',
    badge: 'orchestrate',
    labelKey: 'tui.preset.profile.conductor.label',
    badgeKey: 'tui.preset.profile.conductor.badge',
    descriptionKey: 'tui.preset.profile.conductor.desc',
    description: 'Orchestration-oriented profile for multi-agent runs.',
    patch: { profile: 'conductor' },
  },
  {
    id: 'superliora-full',
    label: 'Full',
    badge: 'everything',
    labelKey: 'tui.preset.profile.superliora-full.label',
    badgeKey: 'tui.preset.profile.superliora-full.badge',
    descriptionKey: 'tui.preset.profile.superliora-full.desc',
    description: 'Widest tool waist — power users / swarm staffing.',
    patch: { profile: 'superliora-full' },
  },
];
