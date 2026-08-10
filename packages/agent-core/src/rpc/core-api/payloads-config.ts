import type { LioraConfigPatch } from '#/config';
import type { SmartLoopRoleRoutingPlan } from '../../agent/routing';

export interface GetKimiConfigPayload {
  readonly reload?: boolean;
}

export interface ConfigDiagnostics {
  /** Warnings from the most recent config.toml load attempt; empty when the config is fully valid. */
  readonly warnings: readonly string[];
}

export type SetKimiConfigPayload = LioraConfigPatch;

export interface RemoveKimiProviderPayload {
  readonly providerId: string;
}

export type DeleteConfigFieldPath =
  | `loopControl.${'compaction' | 'completion' | 'exploration' | 'coding' | 'planning' | 'debugging'}Model`
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultThinking'
  | `thinking.${'mode' | 'effort'}`
  | 'persona';

export interface DeleteConfigFieldsPayload {
  readonly paths: readonly DeleteConfigFieldPath[];
}

/** Settings Smart auto routing — live-probed role pins. */
export type PlanSmartLoopRoleRoutingResult = SmartLoopRoleRoutingPlan;
