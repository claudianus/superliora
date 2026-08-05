import type { DeleteConfigFieldPath } from '@superliora/sdk';

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
};

export function loopModelRoutingRows(config: LoopModelRoutingConfig): readonly LoopModelRoutingRow[] {
  return LOOP_MODEL_ROUTING_ROLES.map((role) => {
    const model = configuredModel(config.loopControl?.[role.configKey]);
    return {
      ...role,
      ...(model === undefined ? {} : { model }),
      state: model === undefined ? 'auto' : `override · ${model}`,
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

function configuredModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  return model.length > 0 ? model : undefined;
}
