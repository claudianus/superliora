import type { ExperimentalFeatureState, ExperimentalFlagMap } from '@moonshot-ai/kimi-code-sdk';

import { experimentalFeatureMap } from '#/utils/experimental-features';

// Resolved experimental features, fetched once from the core over RPC at startup and then read
// synchronously by the command palette and dispatch. App-local cache, not a source of truth.
let snapshot: ExperimentalFlagMap = {};

function envExperimentalFeatures(): Pick<ExperimentalFeatureState, 'id' | 'enabled'>[] {
  if (typeof process === 'undefined' || process.env === undefined) return [];
  return Object.keys(process.env)
    .filter((key) => key.startsWith('KIMI_CODE_EXPERIMENTAL_'))
    .map((key) => {
      const flag = key.slice('KIMI_CODE_EXPERIMENTAL_'.length)
        .toLowerCase()
        .replace(/_/g, '-');
      return { id: flag, enabled: process.env[key] === '1' || process.env[key] === 'true' };
    });
}

function mergeWithEnvFeatures(
  features: readonly Pick<ExperimentalFeatureState, 'id' | 'enabled'>[],
): Pick<ExperimentalFeatureState, 'id' | 'enabled'>[] {
  const envFeatures = envExperimentalFeatures().filter(
    (feature) => !features.some((f) => f.id === feature.id),
  );
  return [...features, ...envFeatures];
}

/** Replace the cached flag snapshot. Call after fetching via `harness.getExperimentalFeatures()`. */
export function setExperimentalFeatures(
  features: readonly Pick<ExperimentalFeatureState, 'id' | 'enabled'>[],
  includeEnv = false,
): void {
  snapshot = experimentalFeatureMap(
    includeEnv ? mergeWithEnvFeatures(features) : features,
  );
}

/** An `undefined` flag means "not gated" → always enabled, so callers can pass an optional flag id. */
export function isExperimentalFlagEnabled(flag: string | undefined): boolean {
  if (flag === undefined) return true;
  if (snapshot[flag] !== undefined) return snapshot[flag] === true;
  return envExperimentalFeatures().some((f) => f.id === flag && f.enabled);
}
