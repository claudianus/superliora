export { Agent } from './agent';
export type { SwarmModeTrigger, ToolInfo } from './agent';
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
} from './collaboration/swarm-humanize';
export {
  DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD,
  createSwarmBudgetState,
  evaluateSwarmBudget,
  isWastedBudgetRound,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
  type CreateSwarmBudgetStateOptions,
  type SwarmBudgetRoundInput,
  type SwarmBudgetRoundRecord,
  type SwarmBudgetState,
  type SwarmBudgetSuggestion,
} from './collaboration/swarm-budget';
export {
  SWARM_DAG_DONE_STATUSES,
  SWARM_DAG_TERMINAL_STATUSES,
  areDependenciesSatisfied,
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  readyNodeIds,
  rebindPhaseWorkNodeIds,
  type PhaseWorkNodeBinding,
  type SwarmDagNode,
  type SwarmDagNodeStatus,
} from './collaboration/swarm-dag-scheduler';
export {
  buildRestaffSpecs,
  canAttemptRestaff,
  selectRestaffPhaseSpecs,
  shouldSkipAdaptiveRestaff,
  shouldStopPhaseLoopAtCheckpoint,
} from './tools/builtin/collaboration/ultra-swarm-phase';
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
} from './collaboration/swarm-evidence-gate';
export {
  attachDraftToDebate,
  buildDebateContext,
  createDebate,
  type BuildDebateContextOptions,
  type DebateConfig,
  type DebateState,
} from './session/ultra-swarm-debate';
export {
  buildDebateDraftHandoffPack,
  debateDraftPhasesForHandoff,
  extractEvidenceIds,
  extractFileChangePaths,
  type DebateDraftHandoffEntry,
} from './tools/builtin/collaboration/ultra-swarm-helpers';
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
  consumeUltraSwarmRestaffRequests,
  consumeUltraSwarmSteerRequests,
  createUltraSwarmRunContext,
  hasPendingUltraSwarmRestaff,
  isRestaffSteerText,
  requestUltraSwarmRestaff,
  requestUltraSwarmSteer,
  type UltraSwarmRestaffRequest,
  type UltraSwarmRunContext,
  type UltraSwarmSteerRequest,
} from './agent/ultra-swarm-run';
export {
  buildRestaffReflectionPrompt,
  collectRestaffGaps,
  filterRestaffPlan,
  needsRestaffing,
  restaffPhaseForGaps,
  restaffSlotsAvailable,
  shouldPlanRestaffWave,
  type RestaffGapResult,
} from './session/ultra-swarm-restaff';
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
  PluginThemeDef,
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
