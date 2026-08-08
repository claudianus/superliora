import {
  previewLoopRoleModelRouting,
  rolePresetFor,
  type DeleteConfigFieldPath,
  type LocalRoleCatalogModel,
  type LoopRoleModelPreview,
  type ModelAlias,
  type ModelRole,
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
): readonly LoopModelRoutingRow[] {
  const overrides = loopControlOverrides(config);
  const previewByRole = new Map(
    previewLoopRoleModelRouting(localCatalogFromModels(availableModels), overrides).map((row) => [
      row.role,
      row,
    ]),
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
      state: formatRoleRoutingState(source, model, resolvedAlias),
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
): readonly LocalRoleCatalogModel[] {
  if (availableModels === undefined) return [];
  return Object.entries(availableModels).map(([alias, model]) => ({
    alias,
    model: model.model,
    provider: model.provider,
    available: true,
    ...(model.maxContextSize !== undefined ? { maxContextSize: model.maxContextSize } : {}),
    ...(model.capabilities !== undefined ? { capabilities: model.capabilities } : {}),
    ...(model.cost?.input !== undefined ? { inputCostPerM: model.cost.input } : {}),
  }));
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
): string {
  if (source === 'override' && override !== undefined) return `override · ${override}`;
  if (source === 'auto' && resolvedAlias !== undefined) return `auto → ${resolvedAlias}`;
  return 'auto';
}

function configuredModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  return model.length > 0 ? model : undefined;
}
