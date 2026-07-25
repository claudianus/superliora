import type { ModelCapability, ProviderConfig } from '@superliora/kosong';

/** Loop-control role → model alias assignments; unset roles are auto-inferred. */
export interface AgentRoleModels {
  compaction?: string;
  completion?: string;
  exploration?: string;
  coding?: string;
  planning?: string;
  debugging?: string;
}

export interface AgentConfigData {
  cwd: string;
  provider?: ProviderConfig;
  modelAlias?: string;
  modelCapabilities: ModelCapability;
  profileName?: string;
  thinkingLevel: string;
  systemPrompt: string;
  /** Present only when at least one loop-control role model is configured. */
  roleModels?: AgentRoleModels;
}

export type AgentConfigUpdateData = Partial<{
  cwd: string;
  modelAlias: string;
  profileName: string;
  thinkingLevel: string;
  systemPrompt: string;
}>;
