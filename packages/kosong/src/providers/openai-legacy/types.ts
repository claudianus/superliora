import type OpenAI from 'openai';

import type { ProviderRequestAuth } from '#/provider';
import type { ToolMessageConversion } from '../openai/openai-common';
import type { OpenAIContentPart } from '../openai/openai-common';
import type { ToolCallIdPolicy } from '../tool-call-id';
import { sanitizeToolCallId } from '../tool-call-id';

// Inbound: scan in priority order; first string value wins. Outbound: the first
// entry doubles as the default field we serialize ThinkPart back into. Both
// arms can be overridden by an explicit `reasoningKey` on the provider config.
export const KNOWN_REASONING_KEYS = ['reasoning_content', 'reasoning_details', 'reasoning'] as const;
export const DEFAULT_OUTBOUND_REASONING_KEY = KNOWN_REASONING_KEYS[0];

/**
 * Hard upper bound on `max_tokens` for OpenAI-compatible chat-completions
 * endpoints. Many third-party providers reject `max_tokens` above this limit
 * (the documented range is `[1, 131072]`).
 */
export const CHAT_COMPLETIONS_MAX_OUTPUT_TOKENS_CEILING = 128 * 1024;

export const OPENAI_CHAT_TOOL_CALL_ID_POLICY: ToolCallIdPolicy = {
  normalize: (id) => sanitizeToolCallId(id, 64),
  maxLength: 64,
};

export interface OpenAILegacyOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model: string;
  stream?: boolean | undefined;
  maxTokens?: number | undefined;
  reasoningKey?: string | undefined;
  httpClient?: unknown;
  defaultHeaders?: Record<string, string>;
  toolMessageConversion?: ToolMessageConversion | undefined;
  clientFactory?: (auth: ProviderRequestAuth) => OpenAI;
}

export interface OpenAILegacyGenerationKwargs {
  max_tokens?: number | undefined;
  max_completion_tokens?: number | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  n?: number | undefined;
  presence_penalty?: number | undefined;
  frequency_penalty?: number | undefined;
  stop?: string | string[] | undefined;
  [key: string]: unknown;
}

export interface OpenAIMessage {
  role: string;
  content?: string | OpenAIContentPart[] | undefined;
  tool_calls?: OpenAIToolCallOut[] | undefined;
  tool_call_id?: string | undefined;
  name?: string | undefined;
  [key: string]: unknown;
}

export interface OpenAIToolCallOut {
  type: string;
  id: string;
  function: { name: string; arguments: string | null };
}
