export { Agent } from './agent';
export {
  ConversationLoopController,
  createConversationLoop,
  DEFAULT_LOOP_INTERVAL_MS,
  DEFAULT_LOOP_MAX_ITERATIONS,
  MIN_LOOP_INTERVAL_MS,
} from './agent/conversation-loop';
export type {
  ConversationLoopConfig,
  ConversationLoopState,
  ConversationLoopStatus,
  ConversationLoopTickResult,
} from './agent/conversation-loop';

export { SESSION_STATE_VERSION } from './session';
export type { SessionCustomMetadata, SessionMeta } from './session';
export { SessionStore } from './session/store';
export {
  humanizeCollaborationEvent,
  looksLikeProtocolMessage,
  type HumanizeCollaborationEventInput,
  type HumanizeSeverity,
  type HumanizedCollaborationEvent,
} from '#/fleet';
export {
  isJpegBuffer,
  isPngBuffer,
  readImageDimensions,
  readJpegDimensions,
  readPngDimensions,
  sharedPrefixLength,
  visualDiff,
  type VisualDiffImageMeta,
  type VisualDiffResult,
  type VisualDiffStatus,
} from './tools/visual-diff';
export {
  SESSION_WORKTREE_CUSTOM_KEY,
  buildWorktreeMetadata,
  createSessionWorktree,
  createSessionWorktreeAuto,
  defaultWorktreePath,
  gcSessionWorktrees,
  gcSessionWorktreesAuto,
  generateWorktreeName,
  hygieneSessionWorktrees,
  hygieneSessionWorktreesAuto,
  isSessionWorktreeMeta,
  listSessionWorktrees,
  normalizeWorktreeName,
  removeSessionWorktree,
  removeSessionWorktreeAuto,
  resolveGitRepoRoot,
  resolveGitRepoRootAuto,
  sessionWorktreeFromCustom,
  touchWorktreeAccess,
  worktreeRegistryPath,
  worktreesRoot,
} from './session/worktree';
export {
  collectStorageGarbage,
  measureStorageBytes,
  formatBytes,
  isPathLocked,
  reclaimIdleSessions,
  type StorageGcOptions,
  type StorageGcReport,
  type StorageGcItem,
  type StorageBytesReport,
  type ReclaimIdleSessionsOptions,
} from './session/storage-gc';
export {
  applyDiskPressureReclaimAnswer,
  buildDiskPressureDegradedEvent,
  buildDiskPressureReclaimQuestion,
  classifyDiskFull,
  classifyPressureLevel,
  configureDiskPressure,
  diskFullToolError,
  formatDiskFullToolOutput,
  getDiskPressureSnapshot,
  isDatabaseFullError,
  isDiskFullError,
  isStorageWriteDegraded,
  probeVolumeSpace,
  listVolumeSpaces,
  reportDiskPressure,
  resetDiskPressureForTests,
  subscribeDiskPressure,
  DISK_PRESSURE_DEGRADED_HINT,
  DISK_RECLAIM_IDLE_SESSIONS,
  DISK_RECLAIM_RECHECK,
  DISK_RECLAIM_TRUNCATE_LOGS,
  DISK_RECLAIM_WAIT,
  type DiskFullKind,
  type DiskPressureLevel,
  type DiskPressureSnapshot,
  type VolumeSpace,
} from './runtime/disk-pressure';
export {
  compressWireJsonl,
  ensurePlainWireForAppend,
  ensurePlainWireForAppendSync,
  openWireReadStream,
  resolveWirePath,
  isGzipWirePath,
  WIRE_JSONL,
  WIRE_JSONL_GZ,
} from './session/store/wire-gzip';
export type {
  CreateSessionWorktreeInput,
  CreateSessionWorktreeResult,
  GcWorktreesOptions,
  HygieneWorktreesOptions,
  HygieneWorktreesResult,
  ListWorktreesOptions,
  RemoveWorktreeOptions,
  SessionWorktreeMeta,
  WorktreeRecord,
} from './session/worktree';
export * from './rpc';
export type {
  BackgroundConfig,
  LioraConfig,
  LoopControl,
  ModelAlias,
  OAuthRef,
  ProviderConfig,
  ProviderType,
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
  LIORA_HOME_COMFORT_FREE_BYTES,
  LIORA_HOME_REDIRECT_FILE,
  defaultLioraHomePointerDir,
  writeLioraHomeRedirect,
  sameHomePath,
} from './config';
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
export {
  flushDiagnosticLogs,
  getRootLogger,
  log,
  redact,
  resolveGlobalLogPath,
  resolveSessionLogPath,
} from './logging/logger';
export { resolveLoggingConfig } from './logging/resolve-config';
export { installGlobalProxyDispatcher } from './utils/proxy';
export {
  foldPathForIdentity,
  isCaseInsensitiveFs,
  pathsIdentical,
} from './utils/path-identity';
export {
  lookupModelsDevModel,
  peekModelsDevData,
  warmModelsDevData,
} from './utils/model-metadata';
export { resolveConfiguredSessionRoute, sharedModelRouteHealthStore } from './agent/routing';
export type {
  LogContext,
  LogLevel,
  LogPayload,
  Logger,
  LoggingConfig,
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
} from './session/provider/provider-manager';

// ─── Wire records (for in-monorepo debug tooling) ───────────────────────────
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


export {
  REDTEAM_SOFT_SUITE_REL_PATH,
  REDTEAM_SOFT_SUITE_TIP,
  formatRedteamSoftSuitePresentLine,
  isRedteamSoftSuitePresent,
  redactSecretsStatusLine,
} from './security/status';


export * from './session/coordinator';

export * from './session/execution/verification';

export * from './session/execution/pipeline';
export type { WorkerAncestry } from '@superliora/protocol';
export { projectIndependentSessionActivity } from './session/independent-activity';

export { applySandboxPolicyToAgents, sandboxPolicyAtLeast } from './session/sandbox-policy-update';
export type { SandboxPolicyUpdate } from './session/sandbox-policy-update';
