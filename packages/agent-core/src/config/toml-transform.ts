import { LioraConfigSchema } from './schema';
import { snakeToCamel } from './toml-keys';
import { cloneUnknown, isPlainObject } from './toml-utils';

const OPAQUE_RECORDS: Record<string, true> = {
  env: true, customHeaders: true, source: true, weights: true, cost: true,
};
const NAMED_RECORDS: Record<string, true> = { providers: true, models: true };

const RETIRED_FIELDS: Record<string, true> = {
  planMode: true, defaultPlanMode: true, freeMode: true, mergeAllAvailableSkills: true,
  extraSkillDirs: true, skillSearchLimit: true, skillSearchMaxLimit: true, skillPromptMode: true,
  skills: true, memory: true, research: true, persona: true, agent: true,
  mcp: true, plugin: true, plugins: true, contextOs: true, experimental: true,
  goals: true, goal: true, quality: true, refine: true, dream: true, hooks: true, services: true,
  media: true, browserUse: true, computerUse: true, extras: true,
  maxRalphIterations: true, reservedContextSize: true, compactionTriggerRatio: true,
  maxRetriesPerStep: true,
  compactionAsyncTriggerRatio: true, compactionBlockRatio: true, compactionTriggerTokens: true,
  maxWorkingSetTokens: true, asyncWorkingSetTokens: true, compactionMaxRecentMessages: true,
  compactionModel: true, completionModel: true, explorationModel: true, codingModel: true,
  planningModel: true, debuggingModel: true, workerInheritParent: true, workerInheritParentRoles: true,
  conductorModelPool: true, conductorPoolMode: true, smartRouterBudgetUsd: true,
  maxStepsPerRun: true, autoContinue: true, keepAliveOnExit: true, conductorPool: true,
  workerPool: true, workerModel: true,
};

export function isRetiredConfigField(key: string): boolean {
  return Object.hasOwn(RETIRED_FIELDS, snakeToCamel(key));
}

/** Project disk settings into the strict native schema; unrelated fields remain only in raw. */
export function transformTomlData(data: Record<string, unknown>): Record<string, unknown> {
  const transformed = transformObject(data);
  const result = LioraConfigSchema.safeParse(transformed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.code !== 'unrecognized_keys') continue;
      let target: unknown = transformed;
      for (const part of issue.path) {
        if (target === null || typeof target !== 'object') break;
        target = (target as Record<PropertyKey, unknown>)[part];
      }
      if (!isPlainObject(target)) continue;
      for (const key of issue.keys) {
        // Retired keys stay visible to strict validation, never become raw-only config.
        if (!isRetiredConfigField(key)) delete target[key];
      }
    }
  }
  return transformed;
}

function transformObject(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (Object.hasOwn(OPAQUE_RECORDS, targetKey)) {
      out[targetKey] = cloneUnknown(value);
    } else if (Object.hasOwn(NAMED_RECORDS, targetKey) && isPlainObject(value)) {
      const named: Record<string, unknown> = {};
      for (const [name, config] of Object.entries(value)) named[name] = transformValue(config);
      out[targetKey] = named;
    } else {
      out[targetKey] = transformValue(value);
    }
  }
  return out;
}

function transformValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transformValue);
  return isPlainObject(value) ? transformObject(value) : value;
}
