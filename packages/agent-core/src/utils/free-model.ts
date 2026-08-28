/**
 * FREE mode utilities — detect free-tier models and rank them smartly.
 *
 * Detection is intentionally conservative: a model is "free" only when
 * - models.dev / config marks it as $0 input (cost.input === 0), or
 * - its id / alias contains an explicit free marker (`-free`, `:free`, `/free`).
 *
 * No heuristic like "cheap name = free" — that would misclassify paid cheap
 * SKUs (haiku, flash, mini). When FREE mode is on, every role must resolve to
 * a genuinely free model, while quality/value ranking still picks the best
 * free candidate per role via the existing benchmark-aware scorer.
 */

import type { ModelAlias } from '#/config/schema';
import type { ModelMetadata } from './model-presets';

/** Explicit free markers that curated catalogs use (OpenCode Zen, OpenRouter). */
const FREE_MARKER_RE = /(?:^|[-_/:])free(?:$|[-_/:])/i;

export function isFreeModelId(id: string | undefined): boolean {
  if (id === undefined || id.length === 0) return false;
  return FREE_MARKER_RE.test(id.trim());
}

function isZeroCost(inputCostPerM: number | undefined): boolean {
  return inputCostPerM !== undefined && Number.isFinite(inputCostPerM) && inputCostPerM === 0;
}

function isFreeModelAliasConfig(alias: string, model: ModelAlias): boolean {
  if (isZeroCost(model.cost?.input)) return true;
  if (isFreeModelId(alias)) return true;
  if (isFreeModelId(model.model)) return true;
  // Check displayName as fallback for user-added aliases where model id is generic.
  if (model.displayName !== undefined && FREE_MARKER_RE.test(model.displayName)) return true;
  return false;
}

export function isFreeModelMetadata(model: ModelMetadata): boolean {
  if (isZeroCost(model.inputCostPerM)) return true;
  if (isFreeModelId(model.id)) return true;
  if (isFreeModelId(model.alias)) return true;
  if (model.family !== undefined && FREE_MARKER_RE.test(model.family)) return true;
  return false;
}

/**
 * Whether a config alias qualifies as free under FREE mode.
 * Uses the same cost + marker rules as metadata, but reads directly from
 * LioraConfig.models so callers don't need to build metadata first.
 */
export function isFreeConfigAlias(
  alias: string,
  models: Record<string, ModelAlias> | undefined,
): boolean {
  if (models === undefined) return false;
  const entry = models[alias];
  if (entry === undefined) return false;
  return isFreeModelAliasConfig(alias, entry);
}
