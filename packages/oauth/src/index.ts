export {
  DeviceCodeExpiredError,
  DeviceCodeTimeoutError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from './errors';

export type {
  DeviceAuthorization,
  DeviceHeaders,
  OAuthFlowConfig,
  OAuthStorageBackend,
  TokenInfo,
  TokenInfoWire,
} from './types';
export { tokenFromWire, tokenToWire } from './types';

export type { TokenStorage } from './storage';
export { FileTokenStorage } from './storage';

export type { DevicePollResult, RefreshOptions } from './flow/oauth';
export { pollDeviceToken, refreshAccessToken, requestDeviceAuthorization } from './flow/oauth';

export {
  getJson,
  generatePkcePair,
  generateState,
  generateNonce,
  parseOAuthCallbackInput,
  postForm as postOAuthForm,
  postJson as postOAuthJson,
  startCallbackServer,
  waitForCallbackOrManual,
  type CallbackResult,
  type CallbackServer,
  type ManualCallbackPromptContext,
  type PkcePair,
  type WaitForCallbackOrManualOptions,
} from './flow/oauth-flow-http';
export {
  exchangeOpenAiToken,
  pollOpenAiDeviceToken,
  refreshOpenAiToken,
  requestOpenAiUserCode,
  runOpenAiBrowserFlow,
  runOpenAiDeviceFlow,
  toTokenInfo as toOpenAiTokenInfo,
  toDeviceAuthorization as toOpenAiDeviceAuthorization,
  type OpenAIDeviceCode,
  type OpenAITokenExchange,
} from './flow/oauth-flow-openai';
export {
  exchangeXaiToken,
  refreshXaiToken,
  resolveXaiEndpoints,
  runXaiBrowserFlow,
  toTokenInfo as toXaiTokenInfo,
  type XaiTokenExchange,
} from './flow/oauth-flow-xai';

export type { LoginOptions, OAuthManagerOptions, OAuthRefreshOutcome } from './flow/oauth-manager';
export { OAuthManager, defaultRefreshThreshold, newInstanceId } from './flow/oauth-manager';

export type {
  ProactiveRefreshOptions,
  ProactiveRefreshTimerHandle,
  StartProactiveRefreshTimerOptions,
} from './flow/proactive-refresh';
export {
  OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
  startProactiveRefreshTimer,
  tokenNeedsProactiveRefresh,
} from './flow/proactive-refresh';

export {
  assertKimiHostIdentity,
  createKimiDefaultHeaders,
  createKimiDeviceHeaders,
  createKimiDeviceId,
  createKimiUserAgent,
  SUPERLIORA_PLATFORM,
  readKimiDeviceId,
} from './identity';
export type { KimiHostIdentity, KimiIdentityOptions } from './identity';

export { SUPERLIORA_FLOW_CONFIG } from './constants';

export {
  applyManagedKimiCodeLogoutConfig,
  applyManagedKimiCodeConfig,
  clearManagedKimiCodeConfig,
  fetchManagedKimiCodeModels,
  kimiCodeEnvBaseUrl,
  kimiCodeEnvOAuthHost,
  MANAGED_KIMI_API_PROVIDER,
  SUPERLIORA_OAUTH_KEY,
  SUPERLIORA_PLATFORM_ID,
  SUPERLIORA_PROVIDER_NAME,
  ManagedKimiCodeModelsAuthError,
  provisionManagedKimiCodeConfig,
  resolveKimiCodeLoginAuth,
  resolveKimiCodeOAuthKey,
  resolveKimiCodeOAuthRef,
  resolveKimiCodeRuntimeAuth,
  allocateManagedKimiOAuthAccountKey,
  listManagedKimiOAuthRefs,
} from './kimi';
export type {
  FetchManagedKimiCodeModelsOptions,
  ManagedKimiCodeApplyResult,
  ManagedKimiCodeCleanupResult,
  ManagedKimiEnv,
  ManagedKimiLoginAuth,
  ManagedKimiCodeModelInfo,
  ManagedKimiCodeProvisionResult,
  ManagedKimiConfigAdapter,
  ManagedKimiConfigShape,
  ManagedKimiOAuthRef,
  ManagedKimiOAuthRefInput,
  ManagedKimiRuntimeAuth,
  ProvisionManagedKimiCodeConfigOptions,
} from './kimi';

export {
  allocateProviderOAuthAccountKey,
  fingerprintProviderOAuthRef,
  isValidProviderOAuthCredentialLabel,
  labelProviderOAuthRef,
  listProviderOAuthRefs,
  mergeProviderOAuthLogin,
  promoteProviderOAuthRef,
  promoteProviderOAuthSlot,
  removeProviderOAuthRef,
  rewriteProviderOAuthRefs,
} from './pool/provider-oauth-pool';
export type {
  LabelProviderOAuthResult,
  PromoteProviderOAuthResult,
  ProviderOAuthRef,
  RemoveProviderOAuthResult,
} from './pool/provider-oauth-pool';

export {
  fetchManagedUsage,
  formatDuration,
  formatResetTime,
  isManagedKimiCode,
  kimiCodeBaseUrl,
  kimiCodeUsageUrl,
  parseManagedUsagePayload,
} from './kimi/managed-usage';
export type {
  FetchManagedUsageError,
  FetchManagedUsageResult,
  ParsedManagedUsage,
  UsageRow,
} from './kimi/managed-usage';

export {
  buildAllProvidersUsageSnapshot,
  fetchProviderUsage,
  providerDisplayName,
  snapshotWorstRatio,
  usageRowRatio,
} from './provider-usage';
export type {
  AllProvidersUsageSnapshot,
  FetchProviderUsageOptions,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from './provider-usage';

export { fetchSubmitFeedback, kimiCodeFeedbackUrl } from './kimi/managed-feedback';
export type {
  FetchSubmitFeedbackError,
  FetchSubmitFeedbackOk,
  FetchSubmitFeedbackResult,
  SubmitFeedbackBody,
} from './kimi/managed-feedback';

export {
  fetchCompleteFeedbackUpload,
  fetchCreateFeedbackUploadUrl,
  kimiCodeFeedbackUploadCompleteUrl,
  kimiCodeFeedbackUploadUrl,
} from './kimi/managed-feedback-upload';
export type {
  CompleteFeedbackUploadBody,
  CreateFeedbackUploadUrlBody,
  CreateFeedbackUploadUrlResponse,
  FetchCompleteFeedbackUploadResult,
  FetchCreateFeedbackUploadUrlResult,
  FetchFeedbackUploadError,
} from './kimi/managed-feedback-upload';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
  removeOpenPlatformConfig,
} from './registry/open-platform';
export type {
  ApplyOpenPlatformResult,
  OpenPlatformDefinition,
} from './registry/open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  fetchCustomRegistry,
  removeCustomRegistryProvider,
} from './registry/custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistrySource,
} from './registry/custom-registry';

export { refreshProviderModels } from './registry/refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshProviderScope,
  RefreshResult,
} from './registry/refreshProviderModels';

export { KimiOAuthToolkit, resolveKimiTokenStorageName } from './toolkit';
export type {
  AuthManagedUsageResult,
  AuthProviderStatus,
  AuthStatus,
  BearerTokenProvider,
  KimiOAuthLoginOptions,
  KimiOAuthLoginResult,
  KimiOAuthLogoutResult,
  KimiOAuthTokenRef,
  KimiOAuthToolkitOptions,
} from './toolkit';

export {
  ANTHROPIC_PROFILE,
  EXPERIMENTAL_PROVIDER_PROFILES,
  getProviderProfile,
  isOAuthProviderId,
  isXaiGrokApiBaseUrl,
  isXaiGrokBuildBaseUrl,
  KIMI_PROFILE,
  OPENAI_PROFILE,
  PROVIDER_PROFILES,
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
  xaiGrokRouteConfig,
} from './profiles';
export type {
  OAuthFlowKind,
  OAuthProviderId,
  OAuthProviderWire,
  ProviderFlowConfig,
  ProviderModelPreset,
  ProviderProfile,
  XaiGrokRoute,
  XaiGrokRouteConfig,
} from './profiles';

export { OAuthProviderManager } from './flow/oauth-provider-manager';
export type {
  OAuthProviderManagerOptions,
  ProviderLoginCallbacks,
  ProviderLoginOptions,
} from './flow/oauth-provider-manager';

export {
  CredentialHealthStore,
  annotateModelsWithCredentialHealth,
  credentialHealthCacheKey,
  sharedCredentialHealthStore,
} from './credential-health';
export type {
  CredentialHealthKey,
  CredentialHealthRecord,
  CredentialHealthStatus,
} from './credential-health';
