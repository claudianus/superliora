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

export type { DevicePollResult, RefreshOptions } from './oauth';
export { pollDeviceToken, refreshAccessToken, requestDeviceAuthorization } from './oauth';

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
} from './oauth-flow-http';
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
} from './oauth-flow-openai';
export {
  exchangeXaiToken,
  refreshXaiToken,
  resolveXaiEndpoints,
  runXaiBrowserFlow,
  toTokenInfo as toXaiTokenInfo,
  type XaiTokenExchange,
} from './oauth-flow-xai';

export type { LoginOptions, OAuthManagerOptions, OAuthRefreshOutcome } from './oauth-manager';
export { OAuthManager, defaultRefreshThreshold, newInstanceId } from './oauth-manager';

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
} from './managed-kimi-code';
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
} from './managed-kimi-code';

export {
  fetchManagedUsage,
  formatDuration,
  formatResetTime,
  isManagedKimiCode,
  kimiCodeBaseUrl,
  kimiCodeUsageUrl,
  parseManagedUsagePayload,
} from './managed-usage';
export type {
  FetchManagedUsageError,
  FetchManagedUsageResult,
  ParsedManagedUsage,
  UsageRow,
} from './managed-usage';

export { fetchSubmitFeedback, kimiCodeFeedbackUrl } from './managed-feedback';
export type {
  FetchSubmitFeedbackError,
  FetchSubmitFeedbackOk,
  FetchSubmitFeedbackResult,
  SubmitFeedbackBody,
} from './managed-feedback';

export {
  fetchCompleteFeedbackUpload,
  fetchCreateFeedbackUploadUrl,
  kimiCodeFeedbackUploadCompleteUrl,
  kimiCodeFeedbackUploadUrl,
} from './managed-feedback-upload';
export type {
  CompleteFeedbackUploadBody,
  CreateFeedbackUploadUrlBody,
  CreateFeedbackUploadUrlResponse,
  FetchCompleteFeedbackUploadResult,
  FetchCreateFeedbackUploadUrlResult,
  FetchFeedbackUploadError,
} from './managed-feedback-upload';

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
} from './open-platform';
export type {
  ApplyOpenPlatformResult,
  OpenPlatformDefinition,
} from './open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  fetchCustomRegistry,
  removeCustomRegistryProvider,
} from './custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistrySource,
} from './custom-registry';

export { refreshProviderModels } from './refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshProviderScope,
  RefreshResult,
} from './refreshProviderModels';

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
  KIMI_PROFILE,
  OPENAI_PROFILE,
  PROVIDER_PROFILES,
  XAI_PROFILE,
} from './profiles';
export type {
  OAuthFlowKind,
  OAuthProviderId,
  OAuthProviderWire,
  ProviderFlowConfig,
  ProviderModelPreset,
  ProviderProfile,
} from './profiles';

export { OAuthProviderManager } from './oauth-provider-manager';
export type {
  OAuthProviderManagerOptions,
  ProviderLoginCallbacks,
  ProviderLoginOptions,
} from './oauth-provider-manager';
