/**
 * Turn-level smart model router: role scorer + fallback chain + intensity.
 *
 * Explicit `loopControl.*Model` wins when healthy; unhealthy overrides degrade
 * to fallback chain / auto. Unset roles use `buildFallbackChain` (same truth
 * as Settings preview) and return a hop chain for auth/credit failover.
 */

import {
  SUPERLIORA_PROVIDER_NAME,
  hasCachedOAuthTokenSync,
  resolveKimiTokenStorageName,
  sharedCredentialHealthStore,
} from '@superliora/oauth';

import type { ThinkingEffort } from '../config/thinking';
import { resolveThinkingEffort } from '../config/thinking';
import type { LioraConfig, ModelAlias, ProviderConfig } from '../../config';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '../../profile/main-profile';
import { hasConfiguredApiKeySource } from '../../session/provider/provider-manager-api-key';
import { providerOAuthRefs } from '../../session/provider/provider-manager-oauth';
import {
  applyModelScores,
  autoAssignRoleModels,
  buildFallbackChain,
  classifyModelTier,
  getModelsDevData,
  peekModelsDevData,
  rolePresetFor,
  type ModelMetadata,
  type ModelRole,
} from '../../utils/model-presets';
import { sharedModelRouteHealthStore } from './model-route-health';
import { routeOutcomeEma } from './route-outcome';
import {
  classifySessionRole,
  classifyTurnRouting,
  escalateIntensity,
  type RouteIntensity,
  type TurnSignals,
} from './turn-signals';

export type { RouteIntensity, TurnSignals };
export type SmartRouteSource = 'explicit' | 'auto' | 'parent';

export type SmartRoute = {
  readonly role: ModelRole;
  readonly intensity: RouteIntensity;
  readonly alias: string;
  readonly chain: readonly string[];
  readonly thinkingLevel: ThinkingEffort;
  readonly source: SmartRouteSource;
  readonly reason: string;
};

type RoleModelConfigKey =
  | 'compactionModel'
  | 'completionModel'
  | 'explorationModel'
  | 'codingModel'
  | 'planningModel'
  | 'debuggingModel';

const ROLE_CONFIG_KEYS: Record<ModelRole, RoleModelConfigKey> = {
  compaction: 'compactionModel',
  completion: 'completionModel',
  exploration: 'explorationModel',
  coding: 'codingModel',
  planning: 'planningModel',
  debugging: 'debuggingModel',
};

const AUTO_THINKING_BY_ROLE: Partial<Record<ModelRole, ThinkingEffort>> = {
  exploration: 'low',
  coding: 'high',
  planning: 'max',
  debugging: 'max',
  completion: 'medium',
  compaction: 'off',
};

const DEFAULT_INTENSITY: Record<ModelRole, RouteIntensity> = {
  compaction: 'value',
  exploration: 'value',
  completion: 'balanced',
  coding: 'balanced',
  planning: 'max',
  debugging: 'max',
};

/** Virtual session alias — opt-in main-turn smart routing (PR3). */
export const SMART_AUTO_SESSION_ALIAS = 'auto';

export function isSmartAutoSessionAlias(alias: string | undefined): boolean {
  return alias?.trim().toLowerCase() === SMART_AUTO_SESSION_ALIAS;
}

export function defaultIntensityForRole(role: ModelRole): RouteIntensity {
  return DEFAULT_INTENSITY[role];
}

export function configuredRoleAlias(
  config: LioraConfig,
  role: ModelRole,
): string | undefined {
  const raw = config.loopControl?.[ROLE_CONFIG_KEYS[role]];
  if (typeof raw !== 'string') return undefined;
  const alias = raw.trim();
  return alias.length > 0 ? alias : undefined;
}

export function isConfigAliasHealthy(config: LioraConfig, alias: string): boolean {
  const model = config.models?.[alias];
  if (model === undefined) return false;
  // Alias marks (404 / probe fail) are model-local; credential health stays provider-scoped.
  if (!sharedModelRouteHealthStore.isAvailable(alias)) return false;
  const providerName = model.provider;
  const provider = config.providers?.[providerName];
  if (provider === undefined) return false;
  if (!providerHasUsableCredential(providerName, provider)) return false;
  return sharedCredentialHealthStore.isAvailable(providerName);
}

function providerHasUsableCredential(providerName: string, provider: ProviderConfig): boolean {
  if (hasConfiguredApiKeySource(provider)) return true;
  const refs = providerOAuthRefs(provider);
  if (refs.length === 0) return false;
  return refs.some((ref) => hasCachedOAuthTokenSync(oauthStorageName(providerName, ref.key)));
}

function oauthStorageName(providerName: string, oauthKey: string): string {
  if (providerName === SUPERLIORA_PROVIDER_NAME) {
    try {
      return resolveKimiTokenStorageName({ providerName, oauthKey });
    } catch {
      return '';
    }
  }
  const key = oauthKey.trim();
  return key.length > 0 ? key : providerName;
}

export function buildLocalModelMetadata(config: LioraConfig): readonly ModelMetadata[] {
  return Object.entries(config.models ?? {}).map(([alias, model]) =>
    localModelMetadata(alias, model, config),
  );
}

function localModelMetadata(
  alias: string,
  model: ModelAlias,
  config: LioraConfig,
): ModelMetadata {
  const capabilities = new Set(
    (model.capabilities ?? []).map((capability) => capability.trim().toLowerCase()),
  );
  const declaredCapabilities = model.capabilities !== undefined;
  const hasReasoningMetadata =
    declaredCapabilities || model.supportEfforts !== undefined || model.adaptiveThinking === true;
  const localReasoning = hasReasoningMetadata
    ? capabilities.has('thinking') ||
      capabilities.has('always_thinking') ||
      model.adaptiveThinking === true ||
      (model.supportEfforts?.length ?? 0) > 0
    : undefined;
  const localTools = declaredCapabilities ? capabilities.has('tool_use') : undefined;
  const localVision = declaredCapabilities ? capabilities.has('image_in') : undefined;

  const peek = peekModelsDevData();
  const devData =
    peek?.models.get(model.model.toLowerCase()) ?? peek?.models.get(alias.toLowerCase());

  return applyModelScores(
    {
      id: model.model,
      alias,
      provider: model.provider,
      available: isConfigAliasHealthy(config, alias),
      contextWindow: model.maxContextSize ?? devData?.contextWindow,
      inputCostPerM: model.cost?.input ?? devData?.inputCostPerM,
      outputCostPerM: model.cost?.output ?? devData?.outputCostPerM,
      supportsReasoning: localReasoning ?? devData?.supportsReasoning,
      supportsTools: localTools ?? devData?.supportsTools,
      supportsVision: localVision ?? devData?.supportsVision,
      family: devData?.family,
      knowledgeCutoff: devData?.knowledgeCutoff,
      benchmarkScore: devData?.benchmarkScore,
      benchmarkCount: devData?.benchmarkCount,
    },
    devData,
  );
}

export type ResolveSmartRouteInput = {
  readonly role: ModelRole;
  readonly config: LioraConfig;
  readonly parentAlias?: string;
  readonly intensity?: RouteIntensity;
  readonly signals?: TurnSignals;
  /** Soft session spend (USD); when over budget, intensity steps down one level. */
  readonly sessionSpendUsd?: number;
  readonly minContextTokens?: number;
  readonly isAliasHealthy?: (alias: string) => boolean;
};

/**
 * Resolve primary alias + failover chain for a role.
 * Explicit loopControl override wins; otherwise auto chain from presets.
 */
export function resolveSmartRoute(input: ResolveSmartRouteInput): SmartRoute | undefined {
  const config = input.config;
  const healthy =
    input.isAliasHealthy ?? ((alias: string) => isConfigAliasHealthy(config, alias));

  let role = input.role;
  let intensity = input.intensity ?? defaultIntensityForRole(role);
  if (input.signals !== undefined) {
    const classified = classifyTurnRouting({
      roleHint: role,
      signals: input.signals,
      defaultIntensity: intensity,
    });
    role = classified.role;
    intensity = classified.intensity;
  }
  intensity = applyBudgetIntensity(config, intensity, input.sessionSpendUsd);

  const explicit = configuredRoleAlias(config, role);
  if (explicit !== undefined) {
    const chain = buildExplicitChain(config, explicit, healthy);
    if (healthy(explicit)) {
      return {
        role,
        intensity,
        alias: explicit,
        chain,
        thinkingLevel: thinkingForRole(role, config.models?.[explicit]),
        source: 'explicit',
        reason: `User override · ${role}/${intensity}`,
      };
    }
    const degraded = chain[0];
    if (degraded !== undefined) {
      return {
        role,
        intensity,
        alias: degraded,
        chain,
        thinkingLevel: thinkingForRole(role, config.models?.[degraded]),
        source: 'explicit',
        reason: `User override degraded · ${explicit} → ${degraded} · ${role}/${intensity}`,
      };
    }
    // Unhealthy override with empty healthy chain → fall through to auto.
  }

  let metadata = [...buildLocalModelMetadata(config)];
  if (input.minContextTokens !== undefined && input.minContextTokens > 0) {
    metadata = metadata.map((m) => {
      if (
        m.contextWindow !== undefined &&
        m.contextWindow > 0 &&
        m.contextWindow < input.minContextTokens!
      ) {
        return { ...m, available: false, failureReason: 'context too small for compaction' };
      }
      return m;
    });
  }

  const fullChain = buildFallbackChain(role, metadata);
  const sliced = sliceChainByIntensity(role, fullChain, intensity);
  const chainAliases = uniqueHealthyAliases(sliced, healthy);

  const assignments = autoAssignRoleModels(metadata);
  const assignment = assignments[role];
  const catalogPick =
    assignment?.modelAlias !== undefined && healthy(assignment.modelAlias)
      ? assignment.modelAlias
      : chainAliases[0];
  const preferred = pickPrimaryWithOutcomeTieBreak(role, catalogPick, chainAliases);

  if (preferred !== undefined) {
    const chain =
      chainAliases[0] === preferred
        ? chainAliases
        : uniqueStrings([preferred, ...chainAliases]);
    return {
      role,
      intensity,
      alias: preferred,
      chain,
      thinkingLevel: thinkingForRole(role, config.models?.[preferred]),
      source: 'auto',
      reason:
        assignment?.reason !== undefined
          ? `${assignment.reason} · ${role}/${intensity}`
          : `Smart auto · ${role}/${intensity}`,
    };
  }

  const parent = input.parentAlias?.trim();
  if (parent !== undefined && parent.length > 0 && healthy(parent)) {
    return {
      role,
      intensity,
      alias: parent,
      chain: [parent],
      thinkingLevel: thinkingForRole(role, config.models?.[parent]),
      source: 'parent',
      reason: `Parent model · ${role}/${intensity}`,
    };
  }

  return undefined;
}

/** Next hop after `fromAlias` in the route chain. */
export function advanceSmartRoute(
  route: SmartRoute,
  fromAlias: string | undefined,
): string | undefined {
  if (route.chain.length === 0) return undefined;
  if (fromAlias === undefined || fromAlias.length === 0) return route.chain[0];
  const index = route.chain.indexOf(fromAlias);
  if (index < 0) return route.chain.find((alias) => alias !== fromAlias);
  return route.chain[index + 1];
}

/**
 * Soft-escalate intensity and re-resolve (explicit overrides do not escalate).
 */
export function escalateSmartRoute(
  input: ResolveSmartRouteInput,
  current: SmartRoute,
): SmartRoute | undefined {
  if (current.source === 'explicit') return undefined;
  const nextIntensity = escalateIntensity(current.intensity);
  if (nextIntensity === current.intensity) return undefined;
  return resolveSmartRoute({ ...input, intensity: nextIntensity, signals: undefined });
}

function applyBudgetIntensity(
  config: LioraConfig,
  intensity: RouteIntensity,
  sessionSpendUsd: number | undefined,
): RouteIntensity {
  const budget = config.loopControl?.smartRouterBudgetUsd;
  if (
    budget === undefined ||
    sessionSpendUsd === undefined ||
    !Number.isFinite(budget) ||
    budget <= 0 ||
    !Number.isFinite(sessionSpendUsd) ||
    sessionSpendUsd < budget
  ) {
    return intensity;
  }
  if (intensity === 'max') return 'balanced';
  if (intensity === 'balanced') return 'value';
  return intensity;
}

function buildExplicitChain(
  config: LioraConfig,
  explicit: string,
  healthy: (alias: string) => boolean,
): readonly string[] {
  const fallbacks = config.models?.[explicit]?.fallbackModels ?? [];
  return uniqueHealthyAliases(
    [{ alias: explicit }, ...fallbacks.map((alias) => ({ alias }))],
    healthy,
  );
}

function sliceChainByIntensity(
  role: ModelRole,
  chain: readonly ModelMetadata[],
  intensity: RouteIntensity,
): readonly ModelMetadata[] {
  const preset = rolePresetFor(role);
  if (preset === undefined) return chain;

  if (intensity === 'max') return chain;

  const preferred = chain.filter(
    (m) => (m.tier || classifyModelTier(m.id)) === preset.preferredTier,
  );
  const fallback = chain.filter(
    (m) => (m.tier || classifyModelTier(m.id)) === preset.fallbackTier,
  );

  if (intensity === 'value') {
    const head = preferred.length > 0 ? preferred : fallback;
    return head.slice(0, 3);
  }

  // balanced
  const merged = [...preferred, ...fallback];
  return (merged.length > 0 ? merged : chain).slice(0, 4);
}

function uniqueHealthyAliases(
  entries: readonly { readonly alias?: string; readonly id?: string }[],
  healthy: (alias: string) => boolean,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const alias = entry.alias ?? entry.id;
    if (alias === undefined || alias.length === 0 || seen.has(alias)) continue;
    if (!healthy(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function thinkingForRole(role: ModelRole, model: ModelAlias | undefined): ThinkingEffort {
  const requested = AUTO_THINKING_BY_ROLE[role];
  if (requested === undefined) return 'off';

  const capabilities = new Set(
    (model?.capabilities ?? []).map((capability) => capability.trim().toLowerCase()),
  );
  if (
    model !== undefined &&
    model.capabilities !== undefined &&
    !capabilities.has('thinking') &&
    !capabilities.has('always_thinking') &&
    (model.supportEfforts?.length ?? 0) === 0 &&
    model.adaptiveThinking !== true
  ) {
    return 'off';
  }

  return resolveThinkingEffort(requested, undefined, model);
}

/** Prefer catalog pick unless another head candidate has a clearly better EMA. */
function pickPrimaryWithOutcomeTieBreak(
  role: ModelRole,
  catalogPick: string | undefined,
  chainAliases: readonly string[],
): string | undefined {
  if (catalogPick === undefined) return chainAliases[0];
  const head = chainAliases.slice(0, 3);
  if (head.length === 0) return catalogPick;
  const catalogEma = routeOutcomeEma(role, catalogPick);
  let best = catalogPick;
  let bestEma = catalogEma;
  for (const alias of head) {
    const ema = routeOutcomeEma(role, alias);
    if (ema >= bestEma + 0.15) {
      best = alias;
      bestEma = ema;
    }
  }
  return best;
}

/** Merge role smart chain ahead of config `fallbackModels` (dedup, skip current). */
export function mergeRouteFallbackAliases(
  route: SmartRoute | undefined,
  configFallbacks: readonly string[],
  currentAlias: string | undefined,
  healthy: (alias: string) => boolean,
): readonly string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  if (currentAlias !== undefined) seen.add(currentAlias);

  const push = (alias: string | undefined): void => {
    if (alias === undefined || alias.length === 0 || seen.has(alias)) return;
    if (!healthy(alias)) return;
    seen.add(alias);
    merged.push(alias);
  };

  if (route !== undefined) {
    for (const alias of route.chain) push(alias);
  }
  for (const alias of configFallbacks) push(alias);
  return merged;
}

/**
 * Resolve the real alias for a main session pinned to virtual `auto`.
 * Returns undefined when the pin is not smart-auto or no candidate exists.
 *
 * Conductor main lane is an orchestrator picker: models.dev coding-class
 * ranking + live health only. User-prompt role regex must not demote the
 * control plane to completion/exploration models.
 */
export function resolveSessionSmartRoute(input: {
  readonly config: LioraConfig;
  readonly prompt?: string;
  readonly sessionSpendUsd?: number;
  /** When `conductor`, skip prompt-role classification (orchestrator picker). */
  readonly profileName?: string;
}): SmartRoute | undefined {
  if (input.profileName === SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
    const route = resolveSmartRoute({
      role: 'coding',
      config: input.config,
      intensity: 'balanced',
      sessionSpendUsd: input.sessionSpendUsd,
      // Omit signals.prompt — classifyTurnRouting must not re-bucket the orch lane.
    });
    if (route === undefined) return undefined;
    return {
      ...route,
      reason: `${route.reason} · conductor-orch`,
    };
  }
  const role = classifySessionRole(input.prompt);
  return resolveSmartRoute({
    role,
    config: input.config,
    intensity: defaultIntensityForRole(role),
    signals: { prompt: input.prompt },
    sessionSpendUsd: input.sessionSpendUsd,
  });
}

/**
 * Await models.dev enrichment then resolve (main auto + subagent spawn).
 * Sync {@link resolveSmartRoute} still works from a warm peek cache.
 */
export async function resolveSmartRouteAsync(
  input: ResolveSmartRouteInput,
): Promise<SmartRoute | undefined> {
  await getModelsDevData();
  return resolveSmartRoute(input);
}

export async function resolveSessionSmartRouteAsync(input: {
  readonly config: LioraConfig;
  readonly prompt?: string;
  readonly sessionSpendUsd?: number;
  readonly profileName?: string;
}): Promise<SmartRoute | undefined> {
  await getModelsDevData();
  return resolveSessionSmartRoute(input);
}
