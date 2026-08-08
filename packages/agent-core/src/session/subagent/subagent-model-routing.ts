/**
 * Role-aware model selection for subagent workers.
 *
 * Explicit loop-control aliases remain user-owned settings. When a role is
 * unset, select from the configured local aliases using the shared role
 * scorer, then fall back to the parent's model if no usable candidate exists.
 */

import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { Agent } from '../../agent';
import { resolveThinkingEffort, type ThinkingEffort } from '../../agent/config/thinking';
import type { LioraConfig, ModelAlias } from '../../config';
import { ProviderManager } from '../provider/provider-manager';
import { providerHasAnyCredential } from '../provider/provider-manager-capability';
import { selectVisionModel } from '../vision-analyzer';
import {
  autoAssignRoleModels,
  classifyModelTier,
  type ModelMetadata,
  type ModelRole,
} from '../../utils/model-presets';

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
};

export type SubagentModelSelectionSource = 'explicit' | 'auto' | 'parent' | 'vision';

export interface SubagentModelSelection {
  readonly alias: string | undefined;
  readonly role: ModelRole | undefined;
  readonly thinkingLevel: ThinkingEffort;
  readonly source: SubagentModelSelectionSource;
}

export interface ResolveSubagentModelOptions {
  /** When true, override a non-vision role alias with a catalog vision model. */
  readonly preferVision?: boolean;
}

/** Use the live ProviderManager config when a session has been reloaded. */
export function currentAgentConfig(agent: Agent): LioraConfig | undefined {
  return agent.modelProvider?.currentConfig?.() ?? agent.kimiConfig;
}

/**
 * Convert a worker profile into the role preset that should select its model.
 * Expert profiles carry their base profile separately, so both names matter.
 */
export function roleForSubagentProfile(
  profileName: string | undefined,
  profileBaseName?: string,
): ModelRole | undefined {
  const name = profileName?.trim().toLowerCase() ?? '';
  const base = profileBaseName?.trim().toLowerCase() ?? '';

  if (name.includes('debug') || base.includes('debug')) return 'debugging';
  if (
    base === 'explore' ||
    base === 'desk' ||
    name === 'explore' ||
    name === 'desk' ||
    name.includes('explore') ||
    name.includes('desk')
  ) {
    return 'exploration';
  }
  if (
    base === 'plan' ||
    base === 'mission' ||
    name === 'plan' ||
    name === 'mission' ||
    name.includes('plan') ||
    name.includes('mission')
  ) {
    return 'planning';
  }
  if (
    base === 'coder' ||
    base === 'implement' ||
    name === 'coder' ||
    name === 'goal-driver' ||
    name.includes('code') ||
    name.includes('implement')
  ) {
    return 'coding';
  }
  return undefined;
}

export function resolveSubagentModelSelection(
  parent: Agent,
  profileName: string | undefined,
  profileBaseName?: string,
  options?: ResolveSubagentModelOptions,
): SubagentModelSelection {
  const selection = resolveSubagentModelSelectionCore(parent, profileName, profileBaseName);
  if (options?.preferVision !== true) return selection;
  return preferVisionModelSelection(parent, selection);
}

function resolveSubagentModelSelectionCore(
  parent: Agent,
  profileName: string | undefined,
  profileBaseName?: string,
): SubagentModelSelection {
  const parentAlias = parent.config.modelAlias;
  const parentThinking = parent.config.thinkingLevel;
  const role = roleForSubagentProfile(profileName, profileBaseName);
  if (parentAlias === undefined || role === undefined) {
    return {
      alias: parentAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'parent',
    };
  }

  const config = currentAgentConfig(parent);
  if (config === undefined) {
    return {
      alias: parentAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'parent',
    };
  }

  const explicitAlias = configuredRoleAlias(config, role);
  if (explicitAlias !== undefined) {
    // Explicit loopControl.*Model always wins (same as compaction). Provider
    // health / resolve failures surface on the worker path, not by silently
    // falling through to auto routing.
    return {
      alias: explicitAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'explicit',
    };
  }

  const assignments = autoAssignRoleModels(buildLocalModelMetadata(config));
  const assignment = assignments[role];
  const autoAlias = assignment?.modelAlias;
  if (autoAlias !== undefined && isAliasAvailable(config, autoAlias)) {
    return {
      alias: autoAlias,
      role,
      thinkingLevel: autoThinkingLevel(role, config.models?.[autoAlias]),
      source: 'auto',
    };
  }

  return {
    alias: parentAlias,
    role,
    thinkingLevel: parentThinking,
    source: 'parent',
  };
}

/**
 * When the role-selected alias cannot consume images, switch to a credentialed
 * vision model from the catalog (same-provider preference). No candidate → keep
 * the original selection; VerifySurface then falls back to analyzer text/path.
 */
export function preferVisionModelSelection(
  parent: Agent,
  selection: SubagentModelSelection,
): SubagentModelSelection {
  if (selectionSupportsVision(parent, selection)) return selection;
  const providerManager = parent.modelProvider;
  if (!(providerManager instanceof ProviderManager)) return selection;
  const vision = selectVisionModel(providerManager, {
    kind: 'image',
    currentModelAlias: selection.alias ?? parent.config.modelAlias,
  });
  if (vision === undefined) return selection;
  return {
    ...selection,
    alias: vision.modelAlias,
    source: 'vision',
  };
}

function selectionSupportsVision(
  parent: Agent,
  selection: SubagentModelSelection,
): boolean {
  const providerManager = parent.modelProvider;
  const alias = selection.alias ?? parent.config.modelAlias;
  if (alias !== undefined && providerManager instanceof ProviderManager) {
    try {
      return providerManager.resolveProviderConfig(alias).modelCapabilities.image_in === true;
    } catch {
      /* fall through */
    }
  }
  const capabilities = parent.config.modelCapabilities;
  return capabilities?.image_in === true;
}

function configuredRoleAlias(config: LioraConfig, role: ModelRole): string | undefined {
  const raw = config.loopControl?.[ROLE_CONFIG_KEYS[role]];
  if (typeof raw !== 'string') return undefined;
  const alias = raw.trim();
  return alias.length > 0 ? alias : undefined;
}

function isAliasAvailable(config: LioraConfig, alias: string): boolean {
  const model = config.models?.[alias];
  if (model === undefined) return false;
  const provider = config.providers[model.provider];
  if (provider !== undefined && !providerHasAnyCredential(provider)) return false;
  return sharedCredentialHealthStore.isAvailable(model.provider);
}

function buildLocalModelMetadata(config: LioraConfig): readonly ModelMetadata[] {
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
  const supportsReasoning = hasReasoningMetadata
    ? capabilities.has('thinking') ||
      capabilities.has('always_thinking') ||
      model.adaptiveThinking === true ||
      (model.supportEfforts?.length ?? 0) > 0
    : undefined;
  const supportsTools = declaredCapabilities ? capabilities.has('tool_use') : undefined;
  const supportsVision = declaredCapabilities ? capabilities.has('image_in') : undefined;
  const pricingData = {
    inputCostPerM: model.cost?.input,
    outputCostPerM: model.cost?.output,
    contextWindow: model.maxContextSize,
    supportsReasoning,
    supportsTools,
    supportsVision,
  };

  return {
    id: model.model,
    alias,
    provider: model.provider,
    tier: classifyModelTier(model.model, pricingData),
    contextWindow: model.maxContextSize,
    available: isAliasAvailable(config, alias),
    inputCostPerM: model.cost?.input,
    outputCostPerM: model.cost?.output,
    supportsReasoning: pricingData.supportsReasoning,
    supportsTools: pricingData.supportsTools,
    supportsVision: pricingData.supportsVision,
  };
}

function autoThinkingLevel(role: ModelRole, model: ModelAlias | undefined): ThinkingEffort {
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
