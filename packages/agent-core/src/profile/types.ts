import type { Environment } from '@superliora/kaos';

export interface SystemPromptContext {
  readonly osEnv: Environment;
  readonly cwd: string;
  readonly now?: string | Date;
  readonly cwdListing?: string;
  readonly agentsMd?: string;
  readonly additionalDirsInfo?: string;
}

export type SystemPromptRenderer = (context: SystemPromptContext) => string;

export interface LayeredSystemPrompt {
  readonly layer1Static: string;
  readonly layer2Session: string;
  readonly layer3Dynamic: string;
  readonly combined: string;
}

export type LayeredSystemPromptRenderer = (context: SystemPromptContext) => LayeredSystemPrompt;

export interface ResolvedAgentProfile {
  readonly name: string;
  readonly description?: string;
  readonly systemPrompt: SystemPromptRenderer;
  readonly layeredSystemPrompt?: LayeredSystemPromptRenderer;
  readonly tools: readonly string[];
}
