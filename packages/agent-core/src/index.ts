export { Agent } from './agent';
export type { SwarmModeTrigger, ToolInfo } from './agent';

export type { SessionMeta } from './session';
export { SessionStore } from './session/store';
export * from './rpc';
export type {
  BackgroundConfig,
  LioraConfig,
  LoopControl,
  McpServerConfig,
  ModelAlias,
  MoonshotServiceConfig,
  OAuthRef,
  PersonaConfig,
  ProviderConfig,
  ProviderType,
  ServicesConfig,
  ThinkingConfig,
} from './config';
export {
  ensureConfigFile,
  loadRuntimeConfigSafe,
  parseConfigString,
  readConfigFile,
  readConfigFileForUpdate,
  resolveConfigPath,
  resolveLioraHome,
  writeConfigFile,
} from './config';
export type { MemorySourceRef } from './memory';
export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from './flags';
export { shouldKeepPlanModeForUltraworkRun } from './ultrawork';
export type { UltraworkRecoveryReport } from './ultrawork';
export { Emitter } from './base/common/event';

export {
  noopTelemetryClient,
  withTelemetryContext,
  type TelemetryClient,
  type TelemetryContextPatch,
  type TelemetryProperties,
} from './telemetry';
export {
  ErrorCodes,
  KIMI_ERROR_INFO,
  LioraError,
  fromKimiErrorPayload,
  isKimiError,
  makeErrorPayload,
  setUnexpectedErrorHandler,
  toKimiErrorPayload,
  type LioraErrorCode,
  type LioraErrorInfo,
  type LioraErrorOptions,
  type LioraErrorPayload,
} from './errors';
export type {
  PluginGithubMetadata,
  PluginGithubRef,
  PluginMcpServerInfo,
  PluginSource,
  ReloadSummary,
} from './plugin';
export {
  flushDiagnosticLogs,
  getRootLogger,
  log,
  redact,
  resolveGlobalLogPath,
} from './logging/logger';
export { resolveLoggingConfig } from './logging/resolve-config';
export { installGlobalProxyDispatcher } from './utils/proxy';
export type {
  LogContext,
  LogLevel,
  LogPayload,
  Logger,
} from './logging/types';
export type {
  AgentContextData,
  ContextComposition,
  ContextCompositionSegment,
  ContextMessage,
  PromptOrigin,
} from './agent/context';
export type {
  AgentBackgroundTaskInfo,
  BackgroundTaskInfo,
  BackgroundTaskStatus,
  ProcessBackgroundTaskInfo,
  QuestionBackgroundTaskInfo,
} from './agent/background';
export {
  buildImageCompressionCaption,
  compressImageForModel,
  compressBase64ForModel,
  formatByteSize,
} from './tools/support/image-compress';
export {
  persistOriginalImage,
  sessionMediaOriginalsDir,
} from './tools/support/image-originals';
export type {
  BearerTokenProvider,
  ModelProvider,
  OAuthTokenProviderResolver,
  ResolvedRuntimeProvider,
} from './session/provider-manager';

// ─── Wire records (for in-monorepo consumers like apps/vis) ────────────────
export type {
  AgentRecord,
  AgentRecordEvents,
  AgentRecordOf,
} from './agent/records';
export { AGENT_WIRE_PROTOCOL_VERSION } from './agent/records';
export type { AgentConfigUpdateData } from './agent/config';
export type { CompactionBeginData, CompactionResult } from './agent/compaction';
export type {
  PermissionApprovalResultRecord,
  PermissionMode,
} from './agent/permission';
export type { UsageRecordScope } from './agent/usage';
export type { ToolStoreUpdate } from './tools/store';
export type { LoopRecordedEvent } from './loop';

// ─── Dependency injection container ────────────────────────────────────────
export * from './di';

// ─── In-process services (merged from @superliora/services) ─────────────────
// Re-exports the `IXxxService` contracts, default `XxxService` implementations,
// `toProtocol*` translators and error classes. Importing this barrel triggers
// the `registerSingleton(...)` side-effects at the bottom of each `*Service.ts`,
// populating the DI registry consumed by `getSingletonServiceDescriptors()`.
//
// NOTE: `ApprovalRequest` / `ApprovalResponse` / `QuestionRequest` /
// `QuestionResult` are intentionally NOT re-exported here — they are the
// canonical protocol shapes already exported via `./rpc` (`rpc/sdk-api.ts`),
// and re-exporting them again would collide (TS2308).
export * from './services';

export type {
  ContextOSHealthSnapshot,
  ContextOSRetrievalDiagnostics,
} from './agent/context-os';
export {
  formatContextOSDiagnoseLine,
  formatContextOSHealthLine,
} from './agent/context-os';
