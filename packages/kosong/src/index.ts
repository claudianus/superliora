// Message types
export {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  extractText,
  isContentPart,
  isToolCall,
  isToolCallPart,
  mergeInPlace,
} from './message';
export type {
  AudioURLPart,
  ContentPart,
  ImageURLPart,
  Message,
  Role,
  StreamedMessagePart,
  TextPart,
  ThinkPart,
  ToolCall,
  ToolCallPart,
  VideoURLPart,
} from './message';

// Provider interfaces
export * from './provider';
export { createProvider, getModelCapability } from './providers';
export type { ProviderConfig, ProviderType } from './providers';
// Kimi provider: exported so callers can narrow a `ChatProvider` to the Kimi
// backend (instanceof) and apply Kimi-specific request params (generation
// kwargs, `thinking.keep` extra body).
export { KimiChatProvider } from './providers/kimi';
export type { ExtraBody, GenerationKwargs, LioraOptions, ThinkingConfig } from './providers/kimi';

// Model capability matrix
export { UNKNOWN_CAPABILITY, isUnknownCapability } from './capability';
export type { ModelCapability } from './capability';

// Model catalog (models.dev-style) metadata
export {
  catalogBaseUrl,
  catalogModelToCapability,
  catalogProviderModels,
  inferWireType,
} from './catalog';
export type {
  Catalog,
  CatalogModel,
  CatalogModelEntry,
  CatalogProviderEntry,
  CatalogReasoningOption,
} from './catalog';

// Core functions
export {
  generate,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_STREAM_OPEN_TIMEOUT_MS,
  isSubstantiveStreamPart,
} from './generate';
export type { GenerateCallbacks, GenerateResult } from './generate';

// Stream idle / open timeout guards
export {
  createGenerateAbortScope,
  DEFAULT_LLM_IDLE_TIMEOUT_MS,
  DEFAULT_LLM_OPEN_TIMEOUT_MS,
  LLM_IDLE_TIMEOUT_ENV,
  LLM_OPEN_TIMEOUT_ENV,
  openTimeoutError,
  resolveIdleTimeoutMs,
  resolveOpenTimeoutMs,
  withIdleTimeout,
} from './idle-timeout';
export type { GenerateAbortScope, GenerateAbortScopeOptions, IdleTimeoutOptions } from './idle-timeout';

// Tool wire schema
export type { Tool } from './tool';

// Token usage
export { addUsage, cacheHitRate, emptyUsage, grandTotal, inputTotal } from './usage';
export type { TokenUsage } from './usage';

// Errors
export {
  APIConnectionError,
  APIContextOverflowError,
  APIEmptyResponseError,
  APIProviderRateLimitError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
  isContextOverflowStatusError,
  isProviderCapacityError,
  isProviderRateLimitError,
  isRecoverableRequestStructureError,
  isPermanentAuthError,
  isPermanentQuotaOrBillingError,
  isRetryableGenerateError,
  isToolExchangeAdjacencyError,
  isTransientNoBodyStatusError,
  isTransientProviderError,
  isAbortTimeoutError,
  isTransientTryAgainError,
  parseStatedContextLimitTokens,
} from './errors';

/**
 * Concrete provider adapters stay off the root barrel because their SDK type
 * graphs pollute downstream declaration bundles. Import them from subpaths:
 * `@superliora/kosong/providers/kimi`,
 * `@superliora/kosong/providers/openai-legacy`, etc.
 */
