import { UNKNOWN_CAPABILITY, type ModelCapability } from '../capability';
import type { ChatProvider } from '../provider';
import { AnthropicChatProvider, type AnthropicOptions } from './anthropic';
import { BedrockChatProvider, type BedrockOptions } from './bedrock';
import {
  getAnthropicModelCapability,
  getGoogleGenAIModelCapability,
  getOpenAILegacyModelCapability,
  getOpenAIResponsesModelCapability,
} from './capability-registry';
import { CodeAssistChatProvider, type CodeAssistOptions } from './google/code-assist';
import { GoogleGenAIChatProvider, type GoogleGenAIOptions } from './google-genai';
import { KimiChatProvider, type LioraOptions } from './kimi';
import { KiroCodeWhispererChatProvider, type KiroCodeWhispererOptions } from './kiro/codewhisperer';
import { CursorChatProvider, type CursorOptions } from '#/providers/cursor/index';
import { DevinChatProvider, type DevinOptions } from './devin';
import { FactoryDroidChatProvider, type FactoryDroidOptions } from './factory-droid';
import { OpenAILegacyChatProvider, type OpenAILegacyOptions } from '#/providers/openai-legacy/index';
import { OpenAIResponsesChatProvider, type OpenAIResponsesOptions } from './openai-responses';
import { VertexClaudeChatProvider, type VertexClaudeOptions } from './vertex-claude';

export type ProviderConfig =
  | ({ type: 'anthropic' } & AnthropicOptions)
  | ({ type: 'openai' } & OpenAILegacyOptions)
  | ({ type: 'kimi' } & LioraOptions)
  | ({ type: 'google-genai' } & GoogleGenAIOptions)
  | ({ type: 'code-assist' } & CodeAssistOptions)
  | ({ type: 'openai_responses' } & OpenAIResponsesOptions)
  | ({ type: 'vertexai' } & GoogleGenAIOptions)
  | ({ type: 'codewhisperer' } & KiroCodeWhispererOptions)
  | ({ type: 'bedrock' } & BedrockOptions)
  | ({ type: 'vertex_claude' } & VertexClaudeOptions)
  | ({ type: 'cursor' } & CursorOptions)
  | ({ type: 'devin' } & DevinOptions)
  | ({ type: 'factory-droid' } & FactoryDroidOptions);

export type ProviderType = ProviderConfig['type'];

export function createProvider(config: ProviderConfig): ChatProvider {
  switch (config.type) {
    case 'anthropic':
      return new AnthropicChatProvider(config);
    case 'openai':
      return new OpenAILegacyChatProvider(config);
    case 'kimi':
      return new KimiChatProvider(config);
    case 'google-genai':
      return new GoogleGenAIChatProvider(config);
    case 'code-assist':
      return new CodeAssistChatProvider(config);
    case 'openai_responses':
      return new OpenAIResponsesChatProvider(config);
    case 'vertexai':
      return new GoogleGenAIChatProvider(config);
    case 'codewhisperer':
      return new KiroCodeWhispererChatProvider(config);
    case 'bedrock':
      return new BedrockChatProvider(config);
    case 'vertex_claude':
      return new VertexClaudeChatProvider(config);
    case 'cursor':
      return new CursorChatProvider(config);
    case 'devin':
      return new DevinChatProvider(config);
    case 'factory-droid':
      return new FactoryDroidChatProvider(config);
    default: {
      const exhaustive: never = config;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Look up the declared {@link ModelCapability} for a `(wire, model)` pair.
 *
 * This is a pure static table lookup — it does not instantiate a provider.
 * Unknown / uncatalogued models (and the Kimi wire, whose capabilities come
 * from the host's catalog/config rather than the model name) return
 * {@link UNKNOWN_CAPABILITY} so capability checks stay non-fatal.
 */
export function getModelCapability(wire: ProviderType, modelName: string): ModelCapability {
  switch (wire) {
    case 'anthropic':
    case 'bedrock':
    case 'vertex_claude':
      return getAnthropicModelCapability(modelName);
    case 'openai':
      return getOpenAILegacyModelCapability(modelName);
    case 'openai_responses':
      return getOpenAIResponsesModelCapability(modelName);
    case 'google-genai':
    case 'vertexai':
    case 'code-assist':
      return getGoogleGenAIModelCapability(modelName);
    case 'kimi':
    case 'cursor':
    case 'codewhisperer':
    case 'devin':
    case 'factory-droid':
      // Host catalogs (models.dev / Cursor AvailableModels / Devin CLI model
      // configs / Factory's shipped roster) own these wires.
      return UNKNOWN_CAPABILITY;
    default: {
      const exhaustive: never = wire;
      void exhaustive;
      return UNKNOWN_CAPABILITY;
    }
  }
}
