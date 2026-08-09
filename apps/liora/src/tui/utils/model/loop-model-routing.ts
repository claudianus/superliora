import {
  buildLocalModelMetadata,
  defaultIntensityForRole,
  previewLoopRoleModelRouting,
  rolePresetFor,
  type DeleteConfigFieldPath,
  type LioraConfig,
  type LocalRoleCatalogModel,
  type LoopRoleModelPreview,
  type ModelAlias,
  type ModelRole,
  type ProviderConfig,
} from '@superliora/sdk';

export const LOOP_MODEL_ROUTING_ROLES = [
  { key: 'compaction', configKey: 'compactionModel', label: 'Compaction' },
  { key: 'completion', configKey: 'completionModel', label: 'Completion' },
  { key: 'exploration', configKey: 'explorationModel', label: 'Exploration' },
  { key: 'coding', configKey: 'codingModel', label: 'Coding' },
  { key: 'planning', configKey: 'planningModel', label: 'Planning' },
  { key: 'debugging', configKey: 'debuggingModel', label: 'Debugging' },
] as const;

export type LoopModelRoutingRole = (typeof LOOP_MODEL_ROUTING_ROLES)[number];
export type LoopModelRoutingRoleKey = LoopModelRoutingRole['key'];
export type LoopModelRoutingConfigKey = LoopModelRoutingRole['configKey'];

export interface LoopModelRoutingConfig {
  readonly loopControl?: Partial<Record<LoopModelRoutingConfigKey, unknown>>;
  readonly providers?: Readonly<Record<string, ProviderConfig>>;
}

export type LoopModelRoutingRow = LoopModelRoutingRole & {
  readonly model?: string;
  readonly state: string;
  readonly description: string;
  readonly resolvedAlias?: string;
  readonly source: LoopRoleModelPreview['source'];
};

export function loopModelRoutingRows(
  config: LoopModelRoutingConfig,
  availableModels?: Readonly<Record<string, ModelAlias>>,
  availableProviders?: Readonly<Record<string, ProviderConfig>>,
): readonly LoopModelRoutingRow[] {
  const overrides = loopControlOverrides(config);
  const providers = availableProviders ?? config.providers;
  const previewByRole = new Map(
    previewLoopRoleModelRouting(
      localCatalogFromModels(availableModels, providers),
      overrides,
    ).map((row) => [row.role, row]),
  );

  return LOOP_MODEL_ROUTING_ROLES.map((role) => {
    const preview = previewByRole.get(role.key);
    const model = configuredModel(config.loopControl?.[role.configKey]);
    const description = preview?.description ?? rolePresetFor(role.key)?.description ?? role.label;
    const resolvedAlias = preview?.resolvedAlias;
    const source = preview?.source ?? (model === undefined ? 'none' : 'override');
    return {
      ...role,
      ...(model === undefined ? {} : { model }),
      ...(resolvedAlias !== undefined ? { resolvedAlias } : {}),
      description,
      source,
      state: formatRoleRoutingState(source, model, resolvedAlias, role.key),
    };
  });
}

export function loopModelRoutingRole(key: LoopModelRoutingRoleKey): LoopModelRoutingRole {
  const role = LOOP_MODEL_ROUTING_ROLES.find((candidate) => candidate.key === key);
  if (role === undefined) throw new Error(`Unknown loop model routing role: ${key}`);
  return role;
}

export function loopModelRoutingPatch(
  role: LoopModelRoutingRole,
  model: string,
): { readonly loopControl: Partial<Record<LoopModelRoutingConfigKey, string>> } {
  return { loopControl: { [role.configKey]: model } };
}

export function loopModelRoutingDeletePath(role: LoopModelRoutingRole): DeleteConfigFieldPath {
  return `loopControl.${role.configKey}`;
}

export function localCatalogFromModels(
  availableModels: Readonly<Record<string, ModelAlias>> | undefined,
  availableProviders?: Readonly<Record<string, ProviderConfig>>,
): readonly LocalRoleCatalogModel[] {
  if (availableModels === undefined) return [];
  const config = {
    models: availableModels,
    providers: availableProviders ?? {},
  } as LioraConfig;
  return buildLocalModelMetadata(config).map((meta) => {
    const alias = meta.alias ?? meta.id;
    const model = availableModels[alias];
    return {
      alias,
      model: meta.id,
      provider: meta.provider,
      available: meta.available,
      ...(model?.maxContextSize !== undefined ? { maxContextSize: model.maxContextSize } : {}),
      ...(model?.capabilities !== undefined ? { capabilities: model.capabilities } : {}),
      ...(model?.cost?.input !== undefined ? { inputCostPerM: model.cost.input } : {}),
    };
  });
}

export function loopControlOverrides(
  config: LoopModelRoutingConfig,
): Partial<Record<ModelRole, string>> {
  const overrides: Partial<Record<ModelRole, string>> = {};
  for (const role of LOOP_MODEL_ROUTING_ROLES) {
    const model = configuredModel(config.loopControl?.[role.configKey]);
    if (model !== undefined) overrides[role.key] = model;
  }
  return overrides;
}

function formatRoleRoutingState(
  source: LoopRoleModelPreview['source'],
  override: string | undefined,
  resolvedAlias: string | undefined,
  role: ModelRole,
): string {
  const intensity = defaultIntensityForRole(role);
  if (source === 'override' && override !== undefined) {
    if (resolvedAlias !== undefined && resolvedAlias !== override) {
      return `override · ${override} → ${resolvedAlias}`;
    }
    return `override · ${override}`;
  }
  if (source === 'auto' && resolvedAlias !== undefined) {
    return `auto → ${resolvedAlias} (${role}/${intensity})`;
  }
  return `auto (${role}/${intensity})`;
}

export type SmartLoopRolePin = {
  readonly role: LoopModelRoutingRoleKey;
  readonly configKey: LoopModelRoutingConfigKey;
  readonly label: string;
  readonly alias: string;
};

export type SmartLoopRoleSkip = {
  readonly role: LoopModelRoutingRoleKey;
  readonly configKey: LoopModelRoutingConfigKey;
  readonly label: string;
  readonly reason: string;
};

export type ApplySmartLoopRoleRoutingResult = {
  /** Healthy auto picks to pin into loopControl.*Model. */
  readonly pins: readonly SmartLoopRolePin[];
  /** Roles with no healthy candidate (toast these; do not pin exhausted aliases). */
  readonly skipped: readonly SmartLoopRoleSkip[];
  /** setConfig patch containing only healthy pins. */
  readonly patch: {
    readonly loopControl: Partial<Record<LoopModelRoutingConfigKey, string>>;
  };
  /** Delete paths for every role key so stale/unhealthy overrides are cleared first. */
  readonly clearPaths: readonly DeleteConfigFieldPath[];
};

/**
 * Compute Smart auto role pins from the local catalog + credential health.
 *
 * - Uses {@link localCatalogFromModels} (buildLocalModelMetadata / isConfigAliasHealthy)
 *   so quota-exhausted and credential-unhealthy providers are `available: false`.
 * - Ignores existing loopControl overrides and re-ranks pure auto picks.
 * - Never includes an alias whose catalog row is missing or available===false.
 */
export function applySmartLoopRoleRouting(
  config: LoopModelRoutingConfig,
  availableModels?: Readonly<Record<string, ModelAlias>>,
  availableProviders?: Readonly<Record<string, ProviderConfig>>,
): ApplySmartLoopRoleRoutingResult {
  const providers = availableProviders ?? config.providers;
  const catalog = localCatalogFromModels(availableModels, providers);
  const healthyByAlias = new Map(
    catalog
      .filter((entry) => entry.available !== false)
      .map((entry) => [entry.alias, entry] as const),
  );
  // Empty overrides → pure auto ranking over the catalog (already health-gated).
  const previews = previewLoopRoleModelRouting(catalog, {});

  const pins: SmartLoopRolePin[] = [];
  const skipped: SmartLoopRoleSkip[] = [];
  const loopControl: Partial<Record<LoopModelRoutingConfigKey, string>> = {};

  for (const role of LOOP_MODEL_ROUTING_ROLES) {
    const preview = previews.find((row) => row.role === role.key);
    const alias = preview?.resolvedAlias?.trim();
    if (alias !== undefined && alias.length > 0 && healthyByAlias.has(alias)) {
      pins.push({
        role: role.key,
        configKey: role.configKey,
        label: role.label,
        alias,
      });
      loopControl[role.configKey] = alias;
      continue;
    }
    skipped.push({
      role: role.key,
      configKey: role.configKey,
      label: role.label,
      reason:
        alias !== undefined && alias.length > 0
          ? `unhealthy candidate: ${alias}`
          : 'no healthy candidate',
    });
  }

  return {
    pins,
    skipped,
    patch: { loopControl },
    clearPaths: LOOP_MODEL_ROUTING_ROLES.map((role) => loopModelRoutingDeletePath(role)),
  };
}

function configuredModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  return model.length > 0 ? model : undefined;
}
