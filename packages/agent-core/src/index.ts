export { Agent } from './agent';
export type { ToolInfo } from './agent';
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

export type { SessionMeta } from './session';
export {
  FileSnapshotStore,
  type FileSnapshotEntry,
  type FileSnapshotStoreOptions,
  type TurnFileSnapshot,
} from './session/file-snapshot';
export { SessionStore } from './session/store';
export {
  humanizeCollaborationEvent,
  looksLikeProtocolMessage,
  type HumanizeCollaborationEventInput,
  type HumanizeSeverity,
  type HumanizedCollaborationEvent,
} from '#/fleet';
export {
  CHECK_LIKE_EVIDENCE_TOKENS,
  applyEvidenceHardGate,
  evaluateEvidenceHardGate,
  evidenceMatchesToken,
  findEvidenceHardGateViolation,
  isCheckLikeEvidenceToken,
  normalizeEvidenceToken,
  type EvidenceGateNode,
  type EvidenceGateResult,
} from '#/fleet';
export {
  clearStaffingOutcomes,
  getOutcome,
  hydrateStaffingOutcomesFromDisk,
  listStaffingOutcomes,
  persistStaffingOutcomesToDisk,
  recordOutcome,
  recordOutcomesFromSwarmResults,
  resolveStaffingOutcomesPath,
  scoreBoost,
  type StaffingOutcomeFileV1,
  type StaffingOutcomeInput,
  type StaffingOutcomeRecord,
  type SwarmVerdictOutcomeInput,
} from './expert-agents/staffing-outcome';
export {
  STAFFING_GOLD_SEED,
  collectStaffingGoldLabels,
  dcgAtK,
  meanNdcgAtK,
  ndcgAtK,
  staffingGoldCasesForLabel,
  staffingGoldLabelCoverage,
  type StaffingGoldCase,
} from './expert-agents/staffing-gold';
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
export { VisualDiffTool, createVisualDiffTool } from './tools/visual-diff-tool';
export { createLioraReviewTool } from './tools/builtin/review/code-review';
export {
  scanAddedLine,
  scanDiffFile,
  scanDiffFiles,
  type ReviewHeuristicComment,
  type ReviewHeuristicFile,
  type ReviewHeuristicHunk,
  type ReviewHeuristicLine,
  type ReviewSeverity,
} from './tools/builtin/review/review-heuristics';
export {
  DEFAULT_MAX_PER_DIVISION,
  applyStaffingDiversity,
  containsHangul,
  expertIdPrefix,
  formatSelectionReason,
  rewriteExpertSearchQuery,
  type RewriteExpertSearchQueryOptions,
  type StaffingDiversityOptions,
} from './expert-agents/staffing-diversity';
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
  McpServerConfig,
  ModelAlias,
  MoonshotServiceConfig,
  OAuthRef,
  PersonaConfig,
  PersonaPresetSchemaId,
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
export type {
  PersonaPresetDefinition,
  PersonaPresetId,
  PersonaPresetInputId,
  PersonaPresetLegacyId,
  PersonaSkillBundle,
} from './persona';
export {
  DEFAULT_PERSONA_PRESET_ID,
  PERSONA_PRESET_CATALOG,
  PERSONA_PRESET_IDS,
  PERSONA_PRESET_SCHEMA_VALUES,
  PERSONA_PRESETS,
  atomicPersonaConfigForPreset,
  buildPersonaRoleAdditional,
  getPersonaPreset,
  isEmptyPersona,
  isPersonaPresetId,
  normalizePersonaPresetId,
} from './persona';
export type {
  AgentMemoryRuntime,
  LioraMemoryConfig,
  MemoryAuditEvent,
  MemoryCreateInput,
  MemoryEpistemic,
  MemoryEvidenceRef,
  MemoryExportResult,
  MemoryImportResult,
  MemoryInspectResult,
  MemoryLink,
  MemoryListRequest,
  MemoryRecord,
  MemoryReflectInput,
  MemoryReflectResult,
  MemoryRuntimeAgentContext,
  MemoryRuntimeSessionContext,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySourceRef,
  MemoryStats,
  MemoryStatus,
  MemoryTurnCaptureInput,
  MemoryType,
  MemoryUpdateInput,
} from './memory';
export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from './flags';
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
  PluginThemeDef,
  ReloadSummary,
} from './plugin';
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
  ROLE_PRESETS,
  applyModelScores,
  autoAssignRoleModels,
  buildFallbackChain,
  isAuthOrCreditFailure,
  isHardExcludedForRole,
  peekModelsDevData,
  previewLoopRoleModelRouting,
  rolePresetFor,
  warmModelsDevData,
  type LocalRoleCatalogModel,
  type LoopRoleModelPreview,
  type ModelRole,
  type RoleModelAssignment,
  type RolePreset,
} from './utils/model-presets';
export {
  SMART_AUTO_SESSION_ALIAS,
  assertLoopRolesMatchPresets,
  buildLocalModelMetadata,
  classifySessionRole,
  classifyTurnRouting,
  configWithoutRoleModelOverrides,
  defaultIntensityForRole,
  isConfigAliasHealthy,
  isSmartAutoSessionAlias,
  loopRoleRoutingEntries,
  mergeRouteFallbackAliases,
  planSmartLoopRoleRoutingLive,
  resetModelRouteHealthStoreForTests,
  resetRouteOutcomeStoreForTests,
  resolveSessionSmartRoute,
  resolveSessionSmartRouteAsync,
  resolveSmartRoute,
  resolveSmartRouteAsync,
  sharedModelRouteHealthStore,
  type LoopRoleModelConfigKey,
  type LoopRoleRoutingClearPath,
  type RouteIntensity,
  type SmartLoopRolePinPlan,
  type SmartLoopRoleRoutingPlan,
  type SmartLoopRoleSkipPlan,
  type SmartRoute,
  type TurnSignals,
} from './agent/routing';
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
} from './session/provider/provider-manager';
export {
  analyzeMediaPart,
  DEFAULT_NON_VISION_FALLBACK,
  formatAnalysisText,
  isVisionMediaPart,
  mediaKind,
  modelSupportsMediaKind,
  pathOnlyText,
  selectVisionModel,
  transformMediaForNonVisionModel,
} from './session/vision-analyzer';
export type {
  AnalyzeMediaResult,
  MediaKind,
  NonVisionFallbackPolicy,
  VisionAnalyzerDeps,
} from './session/vision-analyzer';

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

export type { RepoIndexBackend, RepoIndexEngine, RepoIndexStatus } from './repo-index/status';
export type { RepoIndexContentQueryResult, RepoIndexEngineWireStatus, SqliteDriver } from './repo-index/engine';
export {
  REPO_INDEX_ENGINE_ENV,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_FUTURE_ENABLE_TIP,
  REPO_INDEX_PREFERRED_ENGINE,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  REPO_INDEX_WARM_PARALLEL_TIP,
  formatRepoIndexBackendLine,
  formatRepoIndexEngineLine,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  isRepoIndexEngineEnvUnset,
  isRepoIndexEngineModulePresent,
  isRepoIndexEngineWired,
  parseRepoIndexEngineEnv,
  repoIndexPreferredEngineTipLine,
} from './repo-index/status';
export {
  REPO_INDEX_CONTENT_STUB_HINT,
  REPO_INDEX_CONTENT_STUB_NEXT_STEP,
  REPO_INDEX_ZOEKT_STUB_HINT,
  REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
  getRepoIndexEngineWireStatus,
  probeSqliteDriver,
  queryRepoIndexContent,
  queryRepoIndexContentAsync,
} from './repo-index/engine';
export {
  REPO_INDEX_WARM_ENV,
  isRepoIndexWarmEnabled,
  maybeWarmCodemapAtSessionStart,
  repoIndexWarmEnableReason,
  repoIndexWarmStatusLine,
} from './repo-index/warm';
export type { RepoIndexRebuildResult, RebuildRepoIndexOptions } from './repo-index/rebuild';
export {
  formatRepoIndexRebuildResultLine,
  rebuildRepoIndex,
} from './repo-index/rebuild';

export {
  REDTEAM_SOFT_SUITE_REL_PATH,
  REDTEAM_SOFT_SUITE_TIP,
  formatRedteamSoftSuitePresentLine,
  isRedteamSoftSuitePresent,
  redactSecretsStatusLine,
} from './security/status';

export {
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  VERIFICATION_SENSOR_GOAL_DONE_TIP_KO,
  VERIFICATION_SENSOR_MAX_FAILURES,
  VERIFICATION_SENSOR_RECENCY_MS,
  buildTestFailureSoftTips,
  createVerificationSensorLedger,
  filterRecentVerificationFailures,
  formatGoalSoftAdvisoryOpsLine,
  goalSoftAdvisoryFromLedger,
  isCheckLikeBashCommand,
  isVerificationCheckTool,
  observeVerificationToolResult,
  recordVerificationFailure,
  recordVerificationPass,
} from './sensors/verification-sensor-ledger';
export type {
  VerificationFailureRecord,
  VerificationSensorLedger,
} from './sensors/verification-sensor-ledger';

export {
  FILE_MUTATION_TOOL_NAMES,
  MUTATION_SENSOR_GOAL_DONE_TIP,
  MUTATION_SENSOR_MAX_PENDING,
  MUTATION_SENSOR_RECENCY_MS,
  MUTATION_VERIFY_NUDGE,
  appendMutationNudge,
  buildPendingMutationSoftTips,
  clearPendingMutations,
  createMutationVerificationLedger,
  deriveMutationPackageDir,
  extractMutationPathsFromToolArgs,
  extractPathsFromOpenCodePatch,
  filterRecentMutations,
  formatMutationVerifyNudge,
  isFileMutationTool,
  observeFileMutationToolResult,
  recordFileMutation,
} from './sensors/mutation-verification-sensor';
export {
  AUTO_CHECK_ENV,
  AUTO_CHECK_ENV_ALIAS,
  AUTO_CHECK_PREFIX,
  AUTO_CHECK_SPAWN_DEFAULT_CHECKS,
  AUTO_CHECK_SPAWN_ENV,
  AUTO_CHECK_SPAWN_MAX_PER_SESSION,
  AUTO_CHECK_SPAWN_MIN_INTERVAL_MS,
  AUTO_CHECK_SPAWN_PREFIX,
  appendAutoCheckSpawnBlock,
  createAutoCheckSpawnState,
  decideAutoCheckSpawn,
  formatAutoCheckDirective,
  formatAutoCheckSpawnResult,
  isAutoCheckEnabled,
  isAutoCheckSpawnEnabled,
  recordAutoCheckSpawn,
  resolveAutoCheckPackageDir,
  wasRecentAutoCheckSpawnOk,
  withAutoCheckDirective,
} from './sensors/auto-check-sensor';
export {
  STEP_BUDGET_PREFIX,
  STEP_BUDGET_SENSOR_ORIGIN,
  STEP_BUDGET_WARN_REMAINING,
  decideStepBudgetWarn,
  formatStepBudgetWarnTip,
} from './sensors/step-budget-sensor';
export type {
  DecideStepBudgetWarnInput,
  StepBudgetWarnDecision,
} from './sensors/step-budget-sensor';
export type {
  AutoCheckSpawnDecision,
  AutoCheckSpawnState,
} from './sensors/auto-check-sensor';
export type {
  MutationRecord,
  MutationVerificationLedger,
} from './sensors/mutation-verification-sensor';

export type { CodemapStatus, CodemapWarmth } from './codemap/status';
export {
  CODEMAP_SYMBOL_VIA_REPOQUERY_TIP,
  formatCodemapDbLine,
  formatCodemapStatusLine,
  getCodemapStatus,
  isCodemapGitWorkspace,
} from './codemap/status';
export { resolveCodemapDbPath } from './codemap/code-map';
