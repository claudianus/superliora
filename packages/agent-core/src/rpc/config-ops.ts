/**
 * Config-mutation domain helpers — extracted from core-impl.ts.
 *
 * Pure validation and config-mutation logic for `LioraCore`'s config RPC
 * surface (`deleteConfigFields`, `removeKimiProvider`). `LioraCore` still owns
 * reading/writing `config.toml` and reloading runtime state; these helpers
 * only validate the request shape and mutate the in-memory `LioraConfig`.
 */

import { ErrorCodes, LioraError } from '#/errors/index';

import type { LioraConfig } from '../config';
import type { DeleteConfigFieldsPayload } from './core-api';

export type DeleteConfigFieldPath = DeleteConfigFieldsPayload['paths'][number];

export const DELETE_CONFIG_FIELD_PATHS = new Set<DeleteConfigFieldPath>([
  'defaultProvider',
  'defaultModel',
  'defaultThinking',
  'thinking.mode',
  'thinking.effort',
]);
const CONFIG_PATH_SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;
const MODELS_PATH_PREFIX = 'models.';
const PROVIDERS_PATH_PREFIX = 'providers.';
/** Provider-scoped leaf fields that may be deleted via deleteConfigFields. */
const PROVIDER_DELETABLE_FIELDS = new Set(['serviceTier']);

// ---------------------------------------------------------------------------
// deleteConfigFields
// ---------------------------------------------------------------------------

export function validateDeleteConfigFields(
  input: DeleteConfigFieldsPayload,
): readonly DeleteConfigFieldPath[] {
  const rawInput = input as unknown;
  if (
    typeof rawInput !== 'object' ||
    rawInput === null ||
    Array.isArray(rawInput) ||
    !Object.hasOwn(rawInput, 'paths')
  ) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, 'Invalid config field deletion request.');
  }

  const rawPaths = (rawInput as { readonly paths: unknown }).paths;
  if (!Array.isArray(rawPaths)) {
    throw new LioraError(
      ErrorCodes.CONFIG_INVALID,
      'Config field deletion paths must be a list of dot-delimited strings.',
    );
  }

  return rawPaths.map((path) => {
    if (typeof path !== 'string') {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        'Config field deletion paths must be dot-delimited strings.',
      );
    }

    // `providers.<id>.<leaf>` allows whitelisted provider fields to be cleared;
    // ids carry dashes, so only the leaf is charset-validated.
    if (path.startsWith(PROVIDERS_PATH_PREFIX)) {
      const providerPart = path.slice(PROVIDERS_PATH_PREFIX.length);
      const lastDot = providerPart.lastIndexOf('.');
      const providerId = lastDot === -1 ? providerPart : providerPart.slice(0, lastDot);
      const leaf = lastDot === -1 ? '' : providerPart.slice(lastDot + 1);
      const unquoted = providerId.replace(/^"(.*)"$/, '$1').trim();
      if (
        unquoted.length === 0 ||
        unquoted.includes('__proto__') ||
        unquoted.includes('constructor') ||
        !PROVIDER_DELETABLE_FIELDS.has(leaf)
      ) {
        throw new LioraError(ErrorCodes.CONFIG_INVALID, `Unknown config field path "${path}".`);
      }
      return path as DeleteConfigFieldPath;
    }

    // `models.*` allows arbitrary alias keys (including slashes/dashes) — validate separately.
    if (path.startsWith(MODELS_PATH_PREFIX)) {
      const aliasPart = path.slice(MODELS_PATH_PREFIX.length);
      if (aliasPart.length === 0) {
        throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid config field path "${path}".`);
      }
      // Disallow prototype pollution even inside quoted alias.
      if (aliasPart.includes('__proto__') || aliasPart.includes('constructor')) {
        throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid config field path "${path}".`);
      }
      // Basic sanity: alias must be non-empty after stripping optional quotes.
      const unquoted = aliasPart.replace(/^"(.*)"$/, '$1').trim();
      if (unquoted.length === 0) {
        throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid config field path "${path}".`);
      }
      return path as DeleteConfigFieldPath;
    }

    const segments = path.split('.');
    const segmentCountOk = segments.length === 1 || segments.length === 2;
    if (
      !segmentCountOk ||
      segments.some(
        (segment) =>
          segment === '__proto__' ||
          segment === 'constructor' ||
          !CONFIG_PATH_SEGMENT.test(segment),
      )
    ) {
      throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid config field path "${path}".`);
    }

    if (!DELETE_CONFIG_FIELD_PATHS.has(path as DeleteConfigFieldPath)) {
      throw new LioraError(ErrorCodes.CONFIG_INVALID, `Unknown config field path "${path}".`);
    }

    return path as DeleteConfigFieldPath;
  });
}

function deleteConfigField(config: LioraConfig, path: DeleteConfigFieldPath): boolean {
  if (path.startsWith(PROVIDERS_PATH_PREFIX)) {
    const providerPart = path.slice(PROVIDERS_PATH_PREFIX.length);
    const lastDot = providerPart.lastIndexOf('.');
    const providerId = providerPart.slice(0, lastDot).replace(/^"(.*)"$/, '$1');
    const leaf = providerPart.slice(lastDot + 1);
    const provider = config.providers[providerId];
    if (provider === undefined || !Object.hasOwn(provider, leaf)) return false;
    delete provider[leaf as keyof typeof provider];
    return true;
  }

  if (path.startsWith(MODELS_PATH_PREFIX)) {
    const aliasPart = path.slice(MODELS_PATH_PREFIX.length);
    const alias = aliasPart.replace(/^"(.*)"$/, '$1');
    const models = config.models;
    if (models === undefined || !Object.hasOwn(models, alias)) return false;
    delete models[alias];
    if (config.defaultModel === alias) delete config.defaultModel;
    // Clean up empty models table to keep TOML tidy.
    if (Object.keys(models).length === 0) delete config.models;
    return true;
  }

  if (path === 'defaultProvider' || path === 'defaultModel' || path === 'defaultThinking') {
    if (!Object.hasOwn(config, path)) return false;
    delete config[path];
    return true;
  }

  if (path === 'thinking.mode' || path === 'thinking.effort') {
    const thinking = config.thinking;
    if (thinking === undefined || !Object.hasOwn(thinking, path.slice('thinking.'.length))) {
      return false;
    }
    delete thinking[path.slice('thinking.'.length) as keyof typeof thinking];
    if (Object.keys(thinking).length === 0) delete config.thinking;
    return true;
  }

  return false;
}

/** Applies every validated path to `config` in place; returns whether anything changed. */
export function applyDeleteConfigFields(
  config: LioraConfig,
  paths: readonly DeleteConfigFieldPath[],
): boolean {
  let deleted = false;
  for (const path of paths) {
    deleted = deleteConfigField(config, path) || deleted;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// removeKimiProvider
// ---------------------------------------------------------------------------

/**
 * Removes `providerId` and prunes model aliases (and default provider/model)
 * that referenced it. Mutates `config` in place.
 */
export function removeProviderFromConfig(config: LioraConfig, providerId: string): void {
  delete config.providers[providerId];

  let removedDefault = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (
      typeof model === 'object' &&
      model !== null &&
      !Array.isArray(model) &&
      model['provider'] === providerId
    ) {
      delete existingModels[key];
      if (config.defaultModel === key) removedDefault = true;
    }
  }
  config.models = existingModels;

  if (removedDefault) {
    config.defaultModel = undefined;
  }

  if (config.defaultProvider === providerId) {
    config.defaultProvider = undefined;
  }
}
