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
    description: 'Prefer fallback strategy · free fallback on · no browser escalate.',
    patch: { strategy: 'fallback', freeFallback: true, browserEscalate: false },
  },
  {
    id: 'deep',
    label: 'Deep',
    badge: 'thorough',
    description: 'Parallel channels · browser escalate when stuck.',
    patch: { strategy: 'parallel', freeFallback: true, browserEscalate: true },
  },
  {
    id: 'free-fallback',
    label: 'Free fallback',
    badge: 'DDG',
    description: 'Auto routing with free web fallback enabled.',
    patch: { strategy: 'auto', freeFallback: true, browserEscalate: false },
  },
];
