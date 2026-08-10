/**
 * Role-aware model selection for subagent workers.
 *
 * Explicit loop-control aliases remain user-owned settings. When a role is
 * unset, the shared smart router picks from local aliases (+ failover chain).
 */

import type { Agent } from '../../agent';
import type { ThinkingEffort } from '../../agent/config/thinking';
import {
  isConfigAliasHealthy,
  resolveSmartRoute,
  type SmartRoute,
  type TurnSignals,
} from '../../agent/routing';
import type { LioraConfig } from '../../config';
import { ProviderManager } from '../provider/provider-manager';
import { selectVisionModel } from '../vision-analyzer';
import type { ModelRole } from '../../utils/model-presets';

export type SubagentModelSelectionSource =
  | 'explicit'
  | 'auto'
  | 'parent'
  | 'vision'
  | 'conductor';

export interface SubagentModelSelection {
  readonly alias: string | undefined;
  readonly role: ModelRole | undefined;
  readonly thinkingLevel: ThinkingEffort;
  readonly source: SubagentModelSelectionSource;
  readonly route?: SmartRoute;
}

export interface ResolveSubagentModelOptions {
  /** When true, override a non-vision role alias with a catalog vision model. */
  readonly preferVision?: boolean;
  readonly signals?: TurnSignals;
  readonly sessionSpendUsd?: number;
  /** Conductor JobCreate.model_alias — wins when healthy. */
  readonly forcedAlias?: string;
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
  const selection = resolveSubagentModelSelectionCore(
    parent,
    profileName,
    profileBaseName,
    options,
  );
  if (options?.preferVision !== true) return selection;
  return preferVisionModelSelection(parent, selection);
}

function resolveSubagentModelSelectionCore(
  parent: Agent,
  profileName: string | undefined,
  profileBaseName?: string,
  options?: ResolveSubagentModelOptions,
): SubagentModelSelection {
  const parentConfig = parent.config;
  if (parentConfig === undefined) {
    return {
      alias: undefined,
      role: roleForSubagentProfile(profileName, profileBaseName),
      thinkingLevel: 'off',
      source: 'parent',
    };
  }
  const pinnedAlias = parentConfig.modelAlias;
  const parentAlias =
    pinnedAlias?.trim().toLowerCase() === 'auto'
      ? parentConfig.effectiveModelAlias
      : pinnedAlias;
  const parentThinking = parentConfig.thinkingLevel;
  const role = roleForSubagentProfile(profileName, profileBaseName);
  const config = currentAgentConfig(parent);

  const forced = options?.forcedAlias?.trim();
  if (forced !== undefined && forced.length > 0) {
    if (config !== undefined && isConfigAliasHealthy(config, forced)) {
      const route = role !== undefined
        ? resolveSmartRoute({
            role,
            config,
            intensity: 'balanced',
          })
        : undefined;
      return {
        alias: forced,
        role,
        thinkingLevel:
          route !== undefined && route.source !== 'explicit'
            ? route.thinkingLevel
            : parentThinking,
        source: 'conductor',
        ...(route !== undefined ? { route } : {}),
      };
    }
    // Unhealthy / unknown forced alias — fall through to role auto.
  }

  if (role === undefined) {
    return {
      alias: parentAlias ?? pinnedAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'parent',
    };
  }

  if (config === undefined) {
    return {
      alias: parentAlias ?? pinnedAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'parent',
    };
  }

  const route = resolveSmartRoute({
    role,
    config,
    ...(parentAlias !== undefined && parentAlias.trim().toLowerCase() !== 'auto'
      ? { parentAlias }
      : {}),
    signals: {
      profileName,
      profileBaseName,
      ...options?.signals,
      prompt: options?.signals?.prompt,
    },
    sessionSpendUsd: options?.sessionSpendUsd,
  });

  if (route === undefined) {
    return {
      alias: parentAlias ?? pinnedAlias,
      role,
      thinkingLevel: parentThinking,
      source: 'parent',
    };
  }

  return {
    alias: route.alias,
    role: route.role,
    thinkingLevel: route.source === 'explicit' ? parentThinking : route.thinkingLevel,
    source: route.source,
    route,
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
