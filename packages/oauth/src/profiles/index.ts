/**
 * OAuth provider profile registry. Bundles the built-in OAuth-capable
 * profiles and exposes lookup helpers consumed by the TUI picker and the
 * OAuth flow runner.
 */

import { ANTHROPIC_PROFILE } from './anthropic';
import {
  GITHUB_COPILOT_API_BASE_URL,
  GITHUB_COPILOT_EDITOR_PLUGIN_VERSION,
  GITHUB_COPILOT_EDITOR_VERSION,
  GITHUB_COPILOT_INTEGRATION_ID,
  GITHUB_COPILOT_OAUTH_HOST,
  GITHUB_COPILOT_PROFILE,
  GITHUB_COPILOT_PROVIDER_ID,
  GITHUB_COPILOT_TOKEN_ENVS,
  GITHUB_COPILOT_TOKEN_URL,
  GITHUB_COPILOT_USER_URL,
  ensureGitHubCopilotSession,
  exchangeGitHubCopilotSession,
  fetchGitHubCopilotModels,
  githubCopilotRequestHeaders,
  githubCopilotUserTokenInfo,
  isGitHubCopilotBaseUrl,
  isGitHubCopilotProviderId,
  isGitHubCopilotSessionToken,
  isGitHubUserToken,
  parseGitHubCopilotModelsResponse,
  parseGitHubCopilotQuotaSnapshots,
  parseGitHubCopilotTokenResponse,
  peekGitHubCopilotSession,
  readGitHubCopilotEnvToken,
  readGitHubCopilotGhCliToken,
  resetGitHubCopilotSessionCache,
} from './github-copilot';
import {
  applyCursorOAuthModelAliases,
  CURSOR_FALLBACK_MODELS,
  CURSOR_OAUTH_PROVIDER_ID,
  cursorModelsToPresets,
  decodeUsableModelIds,
  fetchCursorAvailableModels,
  fetchCursorUsableModels,
  normalizeAvailableModels,
  parseGetServerConfigAgentUrl,
  rewriteCursorLegacyFastSuffix,
  stripCursorWirePrefix,
  toCursorCatalogModelId,
  unwrapConnectPayload,
} from './cursor-available-models';
import {
  CURSOR_AGENT_BASE_URL,
  CURSOR_API_BASE_URL,
  CURSOR_CLIENT_TYPE,
  CURSOR_CLIENT_VERSION_DEFAULT,
  CURSOR_PROFILE,
  cursorAuthHeaders,
  resolveCursorClientVersion,
} from './cursor';
import {
  DEVIN_API_BASE_URL,
  DEVIN_PROFILE,
  DEVIN_PROVIDER_ID,
} from './devin';
import {
  FACTORY_DROID_PROFILE,
  FACTORY_DROID_PROVIDER_ID,
} from './factory-droid';
import { KILO_PROFILE, KILO_PROVIDER_ID } from './kilo';
import { KIMI_PROFILE } from './kimi';
import {
  classifyGhAuthStatus,
  isGhBinaryMissingError,
  parseGhAuthStatusAccount,
  probeGhCliLogin,
} from './gh-cli-login';
import {
  GITLAB_DUO_ANTHROPIC_PROXY_URL,
  GITLAB_DUO_CALLBACK_PORT,
  GITLAB_DUO_CLIENT_ID,
  GITLAB_DUO_OAUTH_HOST,
  GITLAB_DUO_PROFILE,
  GITLAB_DUO_SCOPE,
} from './gitlab-duo';
import { GLM_ZCODE_PROFILE } from './glm-zcode';
import {
  GOOGLE_ANTIGRAVITY_PROFILE,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
} from './google-antigravity';
import {
  GOOGLE_GEMINI_CLI_PROFILE,
  GOOGLE_GEMINI_CLI_PROVIDER_ID,
} from './google-gemini-cli';
import { KIRO_PROFILE, KIRO_PROVIDER_ID } from './kiro';
import {
  MINIMAX_OAUTH_CN_PROFILE,
  MINIMAX_OAUTH_CN_PROVIDER_ID,
  MINIMAX_OAUTH_PROFILE,
  MINIMAX_OAUTH_PROVIDER_ID,
} from './minimax-oauth';
import { MUSE_CODE_PROFILE, MUSE_CODE_PROVIDER_ID } from './muse-code';
import { NOUS_PROFILE, NOUS_PROVIDER_ID } from './nous';
import { OPENROUTER_OAUTH_PROFILE, OPENROUTER_OAUTH_PROVIDER_ID } from './openrouter-oauth';
import {
  QWEN_OAUTH_PROFILE,
  QWEN_OAUTH_PROVIDER_ID,
  qwenResourceUrlToBaseUrl,
} from './qwen-oauth';
import { isOpenCodeZenBaseUrl, opencodeSessionHeaders } from './opencode';
import { OPENAI_PROFILE } from './openai';
import type { OAuthProviderId, ProviderProfile } from './provider-profile';
import {
  isXaiGrokApiBaseUrl,
  isXaiGrokBuildBaseUrl,
  resolveXaiGrokRoute,
  XAI_GROK_API_BASE_URL,
  XAI_GROK_BUILD_BASE_URL,
  XAI_GROK_BUILD_CLIENT_IDENTIFIER,
  XAI_GROK_BUILD_CLIENT_SURFACE,
  XAI_GROK_BUILD_CLIENT_VERSION_DEFAULT,
  XAI_GROK_BUILD_TOKEN_AUTH,
  XAI_PROFILE,
  xaiGrokBuildAuthHeaders,
  xaiGrokBuildRequestHeaders,
  xaiGrokProviderRouteFields,
  xaiGrokRouteConfig,
} from './xai';
import {
  applyPricingSafeContextTokens,
  applyPricingSafeWorkingSet,
  applyXaiPricingSafeContextTokens,
  applyXaiPricingSafeWorkingSet,
  isGrokModelId,
  isXaiGrokProviderId,
  longContextPricingThresholdTokens,
  MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
  OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
  QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
  SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  thresholdFromCatalogCost,
  XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
  xaiLongContextPricingThresholdTokens,
} from './long-context-pricing';

export type { OAuthFlowKind, OAuthProviderId, OAuthProviderWire, PkceFlowVariant, ProviderFlowConfig, ProviderModelPreset, ProviderProfile, ProviderWireAuth } from './provider-profile';

/**
 * Profiles that are always available in the provider picker.
 */
export const PROVIDER_PROFILES: readonly ProviderProfile[] = [
  KIMI_PROFILE,
  OPENAI_PROFILE,
  XAI_PROFILE,
  GITLAB_DUO_PROFILE,
];

/**
 * Profiles gated behind an experimental flag. The TUI only surfaces these when
 * the matching flag is enabled, so the implementation ships ahead of any
 * policy/availability change without exposing it to users.
 */
export interface ExperimentalProviderProfileEntry {
  readonly profile: ProviderProfile;
  readonly flag: string;
  /**
   * When true, the profile stays hidden unless the user explicitly sets the
   * flag to on. Used for providers with third-party account-risk policies
   * (GitHub Copilot manual-paste login, Google Antigravity).
   */
  readonly offByDefault?: boolean;
}

export const EXPERIMENTAL_PROVIDER_PROFILES: readonly ExperimentalProviderProfileEntry[] = [
  { profile: ANTHROPIC_PROFILE, flag: 'anthropic_oauth' },
  { profile: CURSOR_PROFILE, flag: 'cursor_oauth' },
  { profile: GITHUB_COPILOT_PROFILE, flag: 'github_copilot', offByDefault: true },
  { profile: GLM_ZCODE_PROFILE, flag: 'glm_zcode_oauth' },
  { profile: GOOGLE_GEMINI_CLI_PROFILE, flag: 'google_gemini_cli_oauth' },
  // Google has banned accounts for third-party Antigravity logins — opt-in only.
  { profile: GOOGLE_ANTIGRAVITY_PROFILE, flag: 'google_antigravity_oauth', offByDefault: true },
  { profile: KIRO_PROFILE, flag: 'kiro_oauth' },
  { profile: DEVIN_PROFILE, flag: 'devin_oauth' },
  { profile: QWEN_OAUTH_PROFILE, flag: 'qwen_oauth' },
  { profile: MINIMAX_OAUTH_PROFILE, flag: 'minimax_oauth' },
  { profile: MINIMAX_OAUTH_CN_PROFILE, flag: 'minimax_oauth' },
  { profile: NOUS_PROFILE, flag: 'nous_oauth' },
  { profile: OPENROUTER_OAUTH_PROFILE, flag: 'openrouter_oauth' },
  { profile: MUSE_CODE_PROFILE, flag: 'muse_code_oauth' },
  { profile: KILO_PROFILE, flag: 'kilo_oauth' },
  { profile: FACTORY_DROID_PROFILE, flag: 'factory_droid_oauth' },
];

/** All profiles (always-on + experimental), for id-based lookup. */
const ALL_PROFILES: readonly ProviderProfile[] = [
  ...PROVIDER_PROFILES,
  ...EXPERIMENTAL_PROVIDER_PROFILES.map((entry) => entry.profile),
];

const PROFILE_BY_ID: ReadonlyMap<string, ProviderProfile> = new Map(
  ALL_PROFILES.map((profile) => [profile.id, profile]),
);

/** Returns the profile for an OAuth provider id, or `undefined`. */
export function getProviderProfile(id: string): ProviderProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

/** Whether the given id maps to a built-in OAuth-capable provider. */
export function isOAuthProviderId(id: string): boolean {
  return PROFILE_BY_ID.has(id);
}

export {
  ANTHROPIC_PROFILE,
  GITHUB_COPILOT_API_BASE_URL,
  GITHUB_COPILOT_EDITOR_PLUGIN_VERSION,
  GITHUB_COPILOT_EDITOR_VERSION,
  GITHUB_COPILOT_INTEGRATION_ID,
  GITHUB_COPILOT_OAUTH_HOST,
  GITHUB_COPILOT_PROFILE,
  GITHUB_COPILOT_PROVIDER_ID,
  GITHUB_COPILOT_TOKEN_ENVS,
  GITHUB_COPILOT_TOKEN_URL,
  GITHUB_COPILOT_USER_URL,
  ensureGitHubCopilotSession,
  exchangeGitHubCopilotSession,
  fetchGitHubCopilotModels,
  githubCopilotRequestHeaders,
  githubCopilotUserTokenInfo,
  isGitHubCopilotBaseUrl,
  isGitHubCopilotProviderId,
  isGitHubCopilotSessionToken,
  isGitHubUserToken,
  parseGitHubCopilotModelsResponse,
  parseGitHubCopilotQuotaSnapshots,
  parseGitHubCopilotTokenResponse,
  peekGitHubCopilotSession,
  readGitHubCopilotEnvToken,
  readGitHubCopilotGhCliToken,
  resetGitHubCopilotSessionCache,
  applyCursorOAuthModelAliases,
  CURSOR_AGENT_BASE_URL,
  CURSOR_API_BASE_URL,
  CURSOR_CLIENT_TYPE,
  CURSOR_CLIENT_VERSION_DEFAULT,
  CURSOR_FALLBACK_MODELS,
  CURSOR_OAUTH_PROVIDER_ID,
  CURSOR_PROFILE,
  cursorAuthHeaders,
  cursorModelsToPresets,
  decodeUsableModelIds,
  fetchCursorAvailableModels,
  fetchCursorUsableModels,
  KIMI_PROFILE,
  normalizeAvailableModels,
  OPENAI_PROFILE,
  opencodeSessionHeaders,
  parseGetServerConfigAgentUrl,
  resolveCursorClientVersion,
  rewriteCursorLegacyFastSuffix,
  stripCursorWirePrefix,
  toCursorCatalogModelId,
  unwrapConnectPayload,
  XAI_PROFILE,
  XAI_GROK_API_BASE_URL,
  XAI_GROK_BUILD_BASE_URL,
  XAI_GROK_BUILD_CLIENT_IDENTIFIER,
  XAI_GROK_BUILD_CLIENT_SURFACE,
  XAI_GROK_BUILD_CLIENT_VERSION_DEFAULT,
  XAI_GROK_BUILD_TOKEN_AUTH,
  GITLAB_DUO_ANTHROPIC_PROXY_URL,
  GITLAB_DUO_CALLBACK_PORT,
  GITLAB_DUO_CLIENT_ID,
  GITLAB_DUO_OAUTH_HOST,
  GITLAB_DUO_PROFILE,
  GITLAB_DUO_SCOPE,
  DEVIN_API_BASE_URL,
  DEVIN_PROFILE,
  DEVIN_PROVIDER_ID,
  FACTORY_DROID_PROFILE,
  FACTORY_DROID_PROVIDER_ID,
  KILO_PROFILE,
  KILO_PROVIDER_ID,
  MUSE_CODE_PROFILE,
  MUSE_CODE_PROVIDER_ID,
  GLM_ZCODE_PROFILE,
  GOOGLE_ANTIGRAVITY_PROFILE,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  GOOGLE_GEMINI_CLI_PROFILE,
  GOOGLE_GEMINI_CLI_PROVIDER_ID,
  KIRO_PROFILE,
  KIRO_PROVIDER_ID,
  MINIMAX_OAUTH_CN_PROFILE,
  MINIMAX_OAUTH_CN_PROVIDER_ID,
  MINIMAX_OAUTH_PROFILE,
  MINIMAX_OAUTH_PROVIDER_ID,
  NOUS_PROFILE,
  NOUS_PROVIDER_ID,
  OPENROUTER_OAUTH_PROFILE,
  OPENROUTER_OAUTH_PROVIDER_ID,
  QWEN_OAUTH_PROFILE,
  QWEN_OAUTH_PROVIDER_ID,
  qwenResourceUrlToBaseUrl,
  isOpenCodeZenBaseUrl,
  isXaiGrokApiBaseUrl,
  isXaiGrokBuildBaseUrl,
  resolveXaiGrokRoute,
  xaiGrokBuildAuthHeaders,
  xaiGrokBuildRequestHeaders,
  xaiGrokProviderRouteFields,
  xaiGrokRouteConfig,
  applyPricingSafeContextTokens,
  applyPricingSafeWorkingSet,
  applyXaiPricingSafeContextTokens,
  applyXaiPricingSafeWorkingSet,
  isGrokModelId,
  isXaiGrokProviderId,
  longContextPricingThresholdTokens,
  MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
  OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
  QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
  SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  thresholdFromCatalogCost,
  XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
  xaiLongContextPricingThresholdTokens,
};
export type { CursorDiscoveredModel, FetchCursorAvailableModelsOptions } from './cursor-available-models';
export type {
  CopilotQuotaRow,
  EnsureGitHubCopilotSessionOptions,
  GitHubCopilotSession,
} from './github-copilot';
export {
  classifyGhAuthStatus,
  isGhBinaryMissingError,
  parseGhAuthStatusAccount,
  probeGhCliLogin,
} from './gh-cli-login';
export type { GhCliLoginState, GhCliLoginStatus } from './gh-cli-login';
export type { XaiGrokRoute, XaiGrokRouteConfig } from './xai';
export type {
  PricingCatalogCost,
  PricingCatalogCostTier,
  PricingModelIdentity,
  PricingSafeWorkingSet,
  XaiGrokModelIdentity,
  XaiPricingSafeWorkingSet,
} from './long-context-pricing';
