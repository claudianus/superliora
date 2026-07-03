import type { ExperimentalFlagMap } from '@moonshot-ai/kimi-code-sdk';

export function experimentalFeatureMap(
  features: ReadonlyArray<{ id: string; enabled: boolean }>,
): ExperimentalFlagMap {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.enabled]));
}
