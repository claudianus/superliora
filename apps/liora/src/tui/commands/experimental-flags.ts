import type { ExperimentalFlagMap } from '@superliora/sdk';

import { experimentalFeatureMap } from '#/utils/experimental-features';

// Resolved experimental features, fetched once from the core over RPC at startup and then read
// synchronously by the command palette and dispatch. App-local cache, not a source of truth.
let snapshot: ExperimentalFlagMap = {};

/**
 * Defaults that match packages/agent-core/src/flags/registry.ts for flags the TUI
 * must evaluate before (or without) a harness snapshot. Keep in sync with registry.
 */
const KNOWN_FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  prompt_intelligence: true,
};

function parseEnvFlagValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

function envExperimentalFeatures(): ReadonlyArray<{ id: string; enabled: boolean }> {
  if (typeof process === 'undefined' || process.env === undefined) return [];
  const out: Array<{ id: string; enabled: boolean }> = [];
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('SUPERLIORA_EXPERIMENTAL_')) continue;
    const flag = key.slice('SUPERLIORA_EXPERIMENTAL_'.length).toLowerCase();
    const parsed = parseEnvFlagValue(process.env[key]);
    if (parsed === undefined) continue;
    out.push({ id: flag, enabled: parsed });
  }
  return out;
}

function mergeWithEnvFeatures(
  features: ReadonlyArray<{ id: string; enabled: boolean }>,
): ReadonlyArray<{ id: string; enabled: boolean }> {
  const envFeatures = envExperimentalFeatures().filter(
    (feature) => !features.some((f) => f.id === feature.id),
  );
  return [...features, ...envFeatures];
}

/** Replace the cached flag snapshot. Call after fetching via `harness.getExperimentalFeatures()`. */
export function setExperimentalFeatures(
  features: ReadonlyArray<{ id: string; enabled: boolean }>,
  includeEnv = false,
): void {
  snapshot = experimentalFeatureMap(
    includeEnv ? mergeWithEnvFeatures(features) : features,
  );
}

/** An `undefined` flag means "not gated" → always enabled, so callers can pass an optional flag id. */
export function isExperimentalFlagEnabled(flag: string | undefined): boolean {
  if (flag === undefined) return true;
  if (snapshot[flag] !== undefined) return snapshot[flag];
  const envHit = envExperimentalFeatures().find((f) => f.id === flag);
  if (envHit !== undefined) return envHit.enabled;
  // Match agent-core registry defaults so ghost/autocomplete is not silently dark
  // between process start and init()'s setExperimentalFeatures.
  const knownDefault = KNOWN_FLAG_DEFAULTS[flag];
  if (knownDefault !== undefined) return knownDefault;
  return false;
}
