import type { SettingPreset } from './setting-presets';

export type SearchPresetId = 'local' | 'deep' | 'free-fallback';

export interface SearchPresetPatch {
  readonly strategy?: string;
  readonly freeFallback?: boolean;
  readonly browserEscalate?: boolean;
}

export const SEARCH_PRESETS: readonly SettingPreset<SearchPresetId, SearchPresetPatch>[] = [
  {
    id: 'local',
    label: 'Local-first',
    badge: 'cheap',
    labelKey: 'tui.preset.search.local.label',
    badgeKey: 'tui.preset.search.local.badge',
    descriptionKey: 'tui.preset.search.local.desc',
    description: 'Prefer fallback strategy · free fallback on · no browser escalate.',
    patch: { strategy: 'fallback', freeFallback: true, browserEscalate: false },
  },
  {
    id: 'deep',
    label: 'Deep',
    badge: 'thorough',
    labelKey: 'tui.preset.search.deep.label',
    badgeKey: 'tui.preset.search.deep.badge',
    descriptionKey: 'tui.preset.search.deep.desc',
    description: 'Parallel channels · browser escalate when stuck.',
    patch: { strategy: 'parallel', freeFallback: true, browserEscalate: true },
  },
  {
    id: 'free-fallback',
    label: 'Free fallback',
    badge: 'DDG',
    labelKey: 'tui.preset.search.free-fallback.label',
    badgeKey: 'tui.preset.search.free-fallback.badge',
    descriptionKey: 'tui.preset.search.free-fallback.desc',
    description: 'Auto routing with free web fallback enabled.',
    patch: { strategy: 'auto', freeFallback: true, browserEscalate: false },
  },
];
