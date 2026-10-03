import type { Kaos } from '@superliora/kaos';

import type { LioraConfig, SDKSessionRPC } from '#/rpc';

import type { Agent, AgentType } from '../../agent';
import type { PermissionRule } from '../../agent/permission';
import type { BackgroundConfig } from '../../config';
import type { ResolvedAgentProfile } from '../../profile';
import type { ProviderManager } from '../provider/provider-manager';
import type { TelemetryClient } from '../../telemetry';

export interface SessionOptions {
  readonly kaos: Kaos;
  readonly persistenceKaos?: Kaos;
  readonly config?: LioraConfig;
  readonly id?: string | undefined;
  readonly homedir: string;
  readonly kimiHomeDir?: string;
  readonly rpc: SDKSessionRPC;
  readonly initializeMainAgent?: boolean | undefined;
  readonly providerManager?: ProviderManager | undefined;
  readonly background?: BackgroundConfig | undefined;
  readonly permissionRules?: readonly PermissionRule[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly appVersion?: string;
  readonly additionalDirs?: readonly string[];
}


export interface AgentMeta {
  readonly homedir: string;
  readonly type: AgentType;
  readonly parentAgentId: string | null;
  readonly swarmItem?: string;
}

export interface ResumedAgent {
  readonly agent: Agent;
  readonly warning?: string;
}

export type AgentEntry = Agent | Promise<ResumedAgent>;

export interface CreateAgentOptions {
  readonly profile?: ResolvedAgentProfile;
  readonly parentAgentId?: string;
  readonly swarmItem?: string;
  readonly persistMetadata?: boolean;
}

/** On-disk `state.json` schema. Missing `version` is treated as 1. */
export const SESSION_STATE_VERSION = 1 as const;

/** Known `state.json` custom keys; unknown keys are kept for forward compat. */
export interface SessionCustomMetadata {
  sandboxProfile?: 'off' | 'workspace' | 'read-only';
  sandboxEnforcement?: 'lexical' | 'process';
  responseLanguage?: unknown;
  worktree?: unknown;
  imported_from_kimi_cli?: boolean;
  /** Legacy cwd before `SessionMeta.workDir`. */
  cwd?: string;
  [key: string]: unknown;
}

export interface SessionMeta {
  version?: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  isCustomTitle: boolean;
  lastPrompt?: string;
  forkedFrom?: string;
  archived?: boolean;
  /** Absolute working directory the session was created in. Persisted so the
   *  session directory is self-describing and the global session index does not
   *  have to be trusted for the (one-way-hashed) workDir. */
  workDir?: string;
  agents: Record<string, AgentMeta>;
  custom: SessionCustomMetadata;
}
