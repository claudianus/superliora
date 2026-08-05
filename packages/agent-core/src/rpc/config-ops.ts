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
  'loopControl.compactionModel',
  'loopControl.completionModel',
  'loopControl.explorationModel',
  'loopControl.codingModel',
  'loopControl.planningModel',
  'loopControl.debuggingModel',
  'persona',
]);
const CONFIG_PATH_SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;

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
  if (path === 'persona') {
    if (!Object.hasOwn(config, 'persona')) return false;
    delete config.persona;
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

  const loopControl = config.loopControl;
  if (loopControl === undefined) return false;

  const field = path.slice('loopControl.'.length) as keyof typeof loopControl;
  if (!Object.hasOwn(loopControl, field)) return false;
  delete loopControl[field];
  return true;
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
