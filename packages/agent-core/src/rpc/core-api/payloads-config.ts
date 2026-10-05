import type { LioraConfigPatch } from '#/config';

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
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultThinking'
  | `thinking.${'mode' | 'effort'}`
  | `models.${string}`
  | `models."${string}"`
  | `providers.${string}`;

export interface DeleteConfigFieldsPayload {
  readonly paths: readonly DeleteConfigFieldPath[];
}

