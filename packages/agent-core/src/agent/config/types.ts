import type { LayeredSystemPrompt, ModelCapability, ProviderConfig } from '@superliora/kosong';


export interface AgentConfigData {
  cwd: string;
  provider?: ProviderConfig;
  modelAlias?: string;
  modelCapabilities: ModelCapability;
  profileName?: string;
  thinkingLevel: string;
  systemPrompt: string;
  /** Layered system prompt for cache-optimized providers (Anthropic). */
  layeredSystemPrompt?: LayeredSystemPrompt;
}

export type AgentConfigUpdateData = Partial<{
  cwd: string;
  modelAlias: string;
  profileName: string;
  thinkingLevel: string;
  systemPrompt: string;
  layeredSystemPrompt: LayeredSystemPrompt;
}>;
