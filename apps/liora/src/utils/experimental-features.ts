import type { ExperimentalFlagMap } from '@superliora/sdk';

export function experimentalFeatureMap(
  features: ReadonlyArray<{ id: string; enabled: boolean }>,
): ExperimentalFlagMap {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.enabled]));
}
