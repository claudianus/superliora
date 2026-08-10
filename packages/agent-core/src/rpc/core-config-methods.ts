/**
 * Config RPC and reload helpers — extracted from core-impl.ts.
 */

import { log } from '#/logging/logger';

import type { Agent } from '../agent';
import {
  configWithoutRoleModelOverrides,
  planSmartLoopRoleRoutingLive,
} from '../agent/routing';
import {
  loadRuntimeConfigSafe,
  mergeConfigPatch,
  readConfigFileForUpdate,
  writeConfigFile,
  type LioraConfig,
} from '../config';
import type { FlagResolver } from '../flags';
import {
  ProviderManager,
  type OAuthTokenProviderResolver,
} from '../session/provider/provider-manager';
import { applyDeleteConfigFields, removeProviderFromConfig, validateDeleteConfigFields } from './config-ops';
import type {
  ConfigDiagnostics,
  DeleteConfigFieldsPayload,
  EmptyPayload,
  GetKimiConfigPayload,
  PlanSmartLoopRoleRoutingResult,
  RemoveKimiProviderPayload,
  SetKimiConfigPayload,
} from './core-api';

export interface CoreConfigMethodsContext {
  readonly configPath: string;
  config: LioraConfig;
  configWarnings: readonly string[];
  readonly experimentalFlags: FlagResolver;
}

/** Probe host for Settings Smart auto (OAuth-aware ProviderManager). */
export interface PlanSmartLoopRoleRoutingContext extends CoreConfigMethodsContext {
  readonly kimiRequestHeaders?: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
}

export function getKimiConfig(
  context: CoreConfigMethodsContext,
  input?: GetKimiConfigPayload,
): Promise<LioraConfig> {
  if (input?.reload) {
    reloadRuntimeConfig(context);
  }
  return Promise.resolve(context.config);
}

export function getConfigDiagnostics(
  context: CoreConfigMethodsContext,
  _input?: EmptyPayload,
): Promise<ConfigDiagnostics> {
  return Promise.resolve({ warnings: context.configWarnings });
}

export async function setKimiConfig(
  context: CoreConfigMethodsContext,
  input: SetKimiConfigPayload,
): Promise<LioraConfig> {
  const config = mergeConfigPatch(readConfigForWrite(context), input);
  await writeConfigFile(context.configPath, config);
  return reloadRuntimeConfig(context);
}

export async function deleteConfigFields(
  context: CoreConfigMethodsContext,
  input: DeleteConfigFieldsPayload,
): Promise<LioraConfig> {
  const paths = validateDeleteConfigFields(input);
  const config = readConfigForWrite(context);
  if (applyDeleteConfigFields(config, paths)) {
    await writeConfigFile(context.configPath, config);
  }
  return reloadRuntimeConfig(context);
}

export async function removeKimiProvider(
  context: CoreConfigMethodsContext,
  input: RemoveKimiProviderPayload,
): Promise<LioraConfig> {
  const config = readConfigForWrite(context);
  removeProviderFromConfig(config, input.providerId);
  await writeConfigFile(context.configPath, config);
  return reloadRuntimeConfig(context);
}

/**
 * Settings Smart auto routing: live-probe each role chain and return pins.
 * Does not mutate config — caller clears/writes via deleteConfigFields + setConfig.
 */
export async function planSmartLoopRoleRouting(
  context: PlanSmartLoopRoleRoutingContext,
  _input?: EmptyPayload,
): Promise<PlanSmartLoopRoleRoutingResult> {
  const rankingConfig = configWithoutRoleModelOverrides(context.config);
  const modelProvider = new ProviderManager({
    config: () => context.config,
    kimiRequestHeaders: context.kimiRequestHeaders,
    resolveOAuthTokenProvider: context.resolveOAuthTokenProvider,
  });
  const agent = {
    runtimeConfig: rankingConfig,
    kimiConfig: rankingConfig,
    modelProvider,
    log,
    config: {
      modelAlias: 'auto',
      effectiveModelAlias: undefined,
      setSmartRouteAlias: () => {},
    },
  } as unknown as Agent;
  return planSmartLoopRoleRoutingLive(agent, rankingConfig);
}

export function readConfigForWrite(context: CoreConfigMethodsContext): LioraConfig {
  return readConfigFileForUpdate(context.configPath);
}

export function reloadRuntimeConfig(context: CoreConfigMethodsContext): LioraConfig {
  const loaded = loadRuntimeConfigSafe(context.configPath);
  if (loaded.fileWarnings.length > 0) {
    // Keep the last good config: adopting a salvaged config mid-run could
    // silently drop providers or models a live session depends on.
    context.configWarnings = [
      ...loaded.fileWarnings,
      ...loaded.envWarnings,
      'config.toml has errors; keeping the previously loaded configuration.',
    ];
    log.warn('config reload degraded; keeping previous config', {
      warnings: loaded.fileWarnings,
    });
    return context.config;
  }
  context.configWarnings = loaded.envWarnings;
  return setRuntimeConfig(context, loaded.config);
}

export function setRuntimeConfig(
  context: CoreConfigMethodsContext,
  config: LioraConfig,
): LioraConfig {
  context.config = config;
  context.experimentalFlags.setConfigOverrides(config.experimental);
  return context.config;
}
