import type { Kaos } from '@superliora/kaos';

import type { LioraConfig, SDKSessionRPC } from '#/rpc';

import type { Agent, AgentType } from '../../agent';
import type { HookDef } from '../hooks';
import type { PermissionRule } from '../../agent/permission';
import type { BackgroundConfig } from '../../config';
import type { SessionMcpConfig } from '../../mcp';
import type { EnabledPluginSessionStart, PluginAgentDef, PluginCommandDef } from '../../plugin';
import type { ResolvedAgentProfile } from '../../profile';
import type { ProviderManager } from '../provider/provider-manager';
import type { SkillRoot } from '../../skill';
import type { TelemetryClient } from '../../telemetry';
import type { ToolServices } from '../../tools/support/services';
import type { ExperimentalFlagResolver } from '../../flags';
import type { SessionMemoryRuntime } from '../../memory';
import type { LioraRecallStore } from '../../memory/store';

export interface SessionOptions {
  readonly kaos: Kaos;
  readonly persistenceKaos?: Kaos;
  readonly config?: LioraConfig;
  readonly id?: string | undefined;
  readonly homedir: string;
  readonly kimiHomeDir?: string;
  readonly rpc: SDKSessionRPC;
  readonly toolServices?: ToolServices;
  readonly initializeMainAgent?: boolean | undefined;
  readonly providerManager?: ProviderManager | undefined;
  readonly background?: BackgroundConfig | undefined;
  readonly hooks?: readonly HookDef[];
  readonly permissionRules?: readonly PermissionRule[];
  readonly skills?: SessionSkillConfig;
  readonly mcpConfig?: SessionMcpConfig;
  readonly telemetry?: TelemetryClient | undefined;
  readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
  readonly pluginCommands?: readonly PluginCommandDef[];
  readonly pluginAgents?: readonly PluginAgentDef[];
  readonly pluginBinDirs?: readonly string[];
  readonly appVersion?: string;
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly additionalDirs?: readonly string[];
  readonly memory?: SessionMemoryRuntime;
  readonly dreamStore?: LioraRecallStore;
  /**
   * Print-mode (`liora -p`) only: hold the main turn open while background
   * subagents are still running before the run exits.
   */
  readonly drainAgentTasksOnStop?: boolean;
}

export interface SessionSkillConfig {
  readonly userHomeDir?: string;
  /** Brand data dir (SUPERLIORA_HOME); user brand skills live under `<brandHomeDir>/skills`. */
  readonly brandHomeDir?: string;
  readonly explicitDirs?: readonly string[];
  readonly extraDirs?: readonly string[];
  readonly pluginSkillRoots?: readonly SkillRoot[];
  readonly mergeAllAvailableSkills?: boolean;
  readonly builtinDir?: string;
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

export interface SessionMeta {
  createdAt: string;
  updatedAt: string;
  title: string;
  isCustomTitle: boolean;
  lastPrompt?: string;
  forkedFrom?: string;
  /** Absolute working directory the session was created in. Persisted so the
   *  session directory is self-describing and the global session index does not
   *  have to be trusted for the (one-way-hashed) workDir. */
  workDir?: string;
  agents: Record<string, AgentMeta>;
  custom: Record<string, any>;
}
