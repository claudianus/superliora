import { ErrorCodes, LioraError } from '#/errors/index';
import {
  LioraConfigPatchSchema,
  formatConfigValidationError,
  type LioraConfig,
  type LioraConfigPatch,
  validateConfig,
} from '#/config/schema';

export function mergeConfigPatch(config: LioraConfig, patch: LioraConfigPatch): LioraConfig {
  const base = validateConfig(config);
  const parsedPatch = parsePatch(patch);
  const merged = deepMerge(base, parsedPatch);
  return validateConfig(merged);
}

function parsePatch(patch: LioraConfigPatch): LioraConfigPatch {
  try {
    return stripUndefinedDeep(LioraConfigPatchSchema.parse(patch)) as LioraConfigPatch;
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid configuration patch: ${formatConfigValidationError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Keys that must never be merged: a patch carrying `{"__proto__": {...}}`
 * (JSON.parse produces it as an own property) would otherwise reassign the
 * merged object's prototype via the plain-assignment setter, letting
 * unvalidated values resolve on later property lookups. The RPC delete path
 * defends the same way.
 */
const UNSAFE_MERGE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, sourceValue] of Object.entries(source)) {
    if (sourceValue === undefined || UNSAFE_MERGE_KEYS.has(key)) continue;
    const targetValue = result[key];
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue !== undefined && !UNSAFE_MERGE_KEYS.has(key)) {
      out[key] = stripUndefinedDeep(entryValue);
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
