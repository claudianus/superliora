/**
 * Compaction aggressiveness packs — patches loopControl ratios + working-set.
 */

import {
  BALANCED_ASYNC_WORKING_SET_TOKENS,
  BALANCED_MAX_WORKING_SET_TOKENS,
  DEEP_ASYNC_WORKING_SET_TOKENS,
  DEEP_MAX_WORKING_SET_TOKENS,
  ECONOMY_ASYNC_WORKING_SET_TOKENS,
  ECONOMY_MAX_WORKING_SET_TOKENS,
} from '#/tui/utils/agent/context-working-set';

import type { SettingPreset } from './setting-presets';

export type CompactionPresetId = 'aggressive' | 'balanced' | 'patient';

export interface CompactionPresetPatch {
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
  readonly compactionTriggerRatio?: number;
  readonly compactionAsyncTriggerRatio?: number;
}

export const COMPACTION_PRESETS: readonly SettingPreset<
  CompactionPresetId,
  CompactionPresetPatch
>[] = [
  {
    id: 'aggressive',
    label: 'Aggressive',
    badge: 'lower cost',
    description: 'Compact earlier — economy working-set + lower ratios.',
    patch: {
      maxWorkingSetTokens: ECONOMY_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: ECONOMY_ASYNC_WORKING_SET_TOKENS,
      compactionTriggerRatio: 0.55,
      compactionAsyncTriggerRatio: 0.45,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    badge: 'recommended',
    description: 'Default working-set ~256k with mid ratios.',
    patch: {
      maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
      compactionTriggerRatio: 0.7,
      compactionAsyncTriggerRatio: 0.6,
    },
  },
  {
    id: 'patient',
    label: 'Patient',
    badge: 'long context',
    description: 'Deep working-set — keep more history before compacting.',
    patch: {
      maxWorkingSetTokens: DEEP_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: DEEP_ASYNC_WORKING_SET_TOKENS,
      compactionTriggerRatio: 0.85,
      compactionAsyncTriggerRatio: 0.75,
    },
  },
];
