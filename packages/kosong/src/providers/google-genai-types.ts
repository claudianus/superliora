import type { ProviderRequestAuth } from '#/provider';
import type { Tool } from '#/tool';
import type { GoogleGenAI as GenAIClient } from '@google/genai';

export interface GoogleGenAIOptions {
  apiKey?: string | undefined;
  model: string;
  vertexai?: boolean | undefined;
  project?: string | undefined;
  location?: string | undefined;
  stream?: boolean | undefined;
  clientFactory?: (auth: ProviderRequestAuth) => GenAIClient;
}

export interface GoogleGenAIGenerationKwargs {
  maxOutputTokens?: number | undefined;
  temperature?: number | undefined;
  topK?: number | undefined;
  topP?: number | undefined;
  thinkingConfig?: ThinkingConfig | undefined;
  [key: string]: unknown;
}

export interface ThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
}

export interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface GoogleTool {
  functionDeclarations: GoogleFunctionDeclaration[];
}

export interface GoogleContent {
  role: string;
  parts: GooglePart[];
}

export interface GooglePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: {
    name: string;
    response: Record<string, string>;
    parts: unknown[];
  };
  thoughtSignature?: string;
  [key: string]: unknown;
}

export function toolToGoogleGenAI(tool: Tool): GoogleTool {
  return {
    functionDeclarations: [
      {
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      },
    ],
  };
}
