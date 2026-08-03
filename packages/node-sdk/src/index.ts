export { LioraHarness, LioraMemoryClient } from '#/harness/liora-harness';
export type { LioraHarnessRuntimeOptions } from '#/harness/liora-harness';
export {
  HarnessDiagnostics,
  type DiagnosticCallbacks,
  type DiagnosticEvent,
  type DiagnosticOptions,
  type DiagnosticSeverity,
  type HealthSnapshot,
} from '#/harness/harness-diagnostics';
export { Session } from '#/session/session';
export { tryAutoResumeUltrawork, ensureUltraworkResumeSetup } from '#/session/ultrawork-auto-resume';
export type { AutoResumeUltraworkResult } from '#/session/ultrawork-auto-resume';
export { LioraAuthFacade } from '#/auth';
export {
  createLioraHarness,
  SDKRpcClient,
  type SDKRpcClientOptions,
} from '#/rpc/sdk-rpc-client';
export {
  createLioraConfigRpc,
  LioraConfigRpcClient,
  type LioraConfigRpc,
  type LioraConfigValidationIssue,
  type LioraConfigValidationPathSegment,
  type ResolveLioraConfigPathInput,
  type ValidateLioraConfigTomlInput,
} from '#/rpc/config-rpc';
export { SDKRpcClientBase } from '#/rpc/rpc';
export { KimiForCodingProvider } from '#/kimi-code-model-provider';
export type { KimiForCodingProviderOptions } from '#/kimi-code-model-provider';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  loadBuiltInCatalog,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogModel,
  CatalogProviderEntry,
} from '#/catalog';

export {
  ErrorCodes,
  LioraError,
  type LioraErrorCode,
  type LioraErrorInfo,
  type LioraErrorOptions,
  type LioraErrorPayload,
  KIMI_ERROR_INFO,
  fromKimiErrorPayload,
  isKimiError,
  toKimiErrorPayload,
} from '@superliora/agent-core';

export {
  flushDiagnosticLogs,
  log,
  redact,
  resolveGlobalLogPath,
  resolveSessionLogPath,
  resolveLioraHome,
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
} from '@superliora/agent-core';
export type {
  LogContext,
  LogLevel,
  LogPayload,
  Logger,
  CreateSessionWorktreeInput,
  CreateSessionWorktreeResult,
  GcWorktreesOptions,
  ListWorktreesOptions,
  RemoveWorktreeOptions,
  SessionWorktreeMeta,
  WorktreeRecord,
} from '@superliora/agent-core';

export { loadRuntimeConfigSafe, resolveConfigPath } from '@superliora/agent-core';
export {
  formatContextOSDiagnoseLine,
  formatContextOSHealthLine,
} from '@superliora/agent-core';
export type {
  ContextOSHealthSnapshot,
  ContextOSRetrievalDiagnostics,
} from '@superliora/agent-core';

export type { RepoIndexBackend, RepoIndexEngine, RepoIndexStatus } from '@superliora/agent-core';
export {
  REPO_INDEX_ENGINE_ENV,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_FUTURE_ENABLE_TIP,
  REPO_INDEX_PREFERRED_ENGINE,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  REPO_INDEX_WARM_ENV,
  REPO_INDEX_WARM_PARALLEL_TIP,
  formatRepoIndexBackendLine,
  formatRepoIndexEngineLine,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  isRepoIndexEngineEnvUnset,
  isRepoIndexEngineWired,
  isRepoIndexWarmEnabled,
  maybeWarmCodemapAtSessionStart,
  parseRepoIndexEngineEnv,
  repoIndexPreferredEngineTipLine,
  repoIndexWarmEnableReason,
  repoIndexWarmStatusLine,
} from '@superliora/agent-core';

export type { RepoIndexRebuildResult, RebuildRepoIndexOptions } from '@superliora/agent-core';
export {
  formatRepoIndexRebuildResultLine,
  rebuildRepoIndex,
} from '@superliora/agent-core';

export {
  REDTEAM_SOFT_SUITE_REL_PATH,
  REDTEAM_SOFT_SUITE_TIP,
  formatRedteamSoftSuitePresentLine,
  isRedteamSoftSuitePresent,
  redactSecretsStatusLine,
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  VERIFICATION_SENSOR_GOAL_DONE_TIP_KO,
  createVerificationSensorLedger,
  formatGoalSoftAdvisoryOpsLine,
  goalSoftAdvisoryFromLedger,
  observeVerificationToolResult,
} from '@superliora/agent-core';
export type { VerificationSensorLedger } from '@superliora/agent-core';

export type { CodemapStatus, CodemapWarmth } from '@superliora/agent-core';
export {
  CODEMAP_SYMBOL_VIA_REPOQUERY_TIP,
  formatCodemapDbLine,
  formatCodemapStatusLine,
  getCodemapStatus,
  isCodemapGitWorkspace,
  resolveCodemapDbPath,
} from '@superliora/agent-core';

export {
  humanizeCollaborationEvent,
  looksLikeProtocolMessage,
  DEFAULT_MAX_PER_DIVISION,
  applyStaffingDiversity,
  containsHangul,
  expertIdPrefix,
  formatSelectionReason,
  rewriteExpertSearchQuery,
  recordOutcome as recordStaffingOutcome,
  scoreBoost as staffingOutcomeScoreBoost,
  ndcgAtK,
  meanNdcgAtK,
  STAFFING_GOLD_SEED,
  collectStaffingGoldLabels,
  staffingGoldCasesForLabel,
  staffingGoldLabelCoverage,
  visualDiff,
  isJpegBuffer,
  isPngBuffer,
  readImageDimensions,
  readJpegDimensions,
  readPngDimensions,
  createVisualDiffTool,
  createLioraReviewTool,
  scanAddedLine,
  scanDiffFile,
  scanDiffFiles,
  recordOutcomesFromSwarmResults,
} from '@superliora/agent-core';
export type {
  HumanizeCollaborationEventInput,
  HumanizeSeverity,
  HumanizedCollaborationEvent,
  RewriteExpertSearchQueryOptions,
  StaffingDiversityOptions,
  StaffingGoldCase,
  StaffingOutcomeInput,
  StaffingOutcomeRecord,
  VisualDiffResult,
  ReviewHeuristicComment,
  ReviewHeuristicFile,
  ReviewSeverity,
} from '@superliora/agent-core';

export { installGlobalProxyDispatcher } from '@superliora/agent-core';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '@superliora/agent-core';

export type {
  LioraAuthCompleteFeedbackUploadInput,
  LioraAuthCompleteFeedbackUploadPart,
  LioraAuthCreateFeedbackUploadUrlInput,
  LioraAuthCreateFeedbackUploadUrlOk,
  LioraAuthCreateFeedbackUploadUrlResult,
  LioraAuthFeedbackUploadPart,
  LioraAuthLoginResult,
  LioraAuthLogoutResult,
  LioraAuthSubmitFeedbackInput,
  ManagedAccountUsageError,
  ManagedAccountUsageOk,
  ManagedAccountUsageResult,
} from '#/auth';

export {
  buildAllProvidersUsageSnapshot,
  fetchProviderUsage,
  providerDisplayName,
  snapshotWorstRatio,
  usageRowRatio,
} from '@superliora/oauth';
export type {
  AllProvidersUsageSnapshot,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from '@superliora/oauth';

export * from '#/session/events';
export type * from '#/session/types';

export {
  formatSearchNeverEmptyTelemetryLine,
  getSearchNeverEmptyTelemetry,
  recordSearchNeverEmptyHardFail,
  recordSearchNeverEmptySoftDegrade,
  resetSearchNeverEmptyTelemetry,
  type SearchNeverEmptyTelemetry,
} from '@superliora/agent-core/tools/providers/search-never-empty-telemetry';

export {
  simulateNeverHaltChaosSequence,
  simulateNeverHaltDegradedChaos,
  simulateNeverHaltOAuthChaosSequence,
  type NeverHaltChaosSequencePhase,
  type NeverHaltChaosSequenceResult,
  type NeverHaltChaosTickResult,
  type NeverHaltOAuthChaosSequencePhase,
  type NeverHaltOAuthChaosSequenceResult,
} from '@superliora/agent-core/runtime/never-halt-chaos';

export {
  MissionRunStateMachine,
  buildMissionRecoveryPrompt,
  maybeAdvanceMissionStage,
  maybeFinishMissionRun,
  MISSION_STAGE_ORDER,
  dualEmitMissionUltraworkAlias,
  isMissionDualEmitEnabled,
  maybeEmitMissionUltraworkAliasLive,
  missionDualEmitStatusLine,
  MISSION_DUAL_EMIT_ENV,
} from '#/mission';
export type { CreateMissionStateMachineInput } from '#/mission';

export {
  FLEET_DUAL_EMIT_ENV,
  FLEET_EVENT_PREFIX,
  FLEET_WORKTREE_ENV,
  FLEET_WORKTREE_FALLBACK_TIP,
  applyFleetWorktreeToSpawnTasks,
  dualEmitFleetUltraworkAlias,
  fleetDualEmitStatusLine,
  fleetUltraworkEventAlias,
  isFleetDualEmitEnabled,
  isFleetUltraworkEventType,
  isFleetWorktreeEnvEnabled,
  isUltraworkOrFleetEventType,
  maybeEmitFleetUltraworkAliasLive,
  normalizeFleetUltraworkEventAlias,
  normalizeMissionOrFleetUltraworkEventAlias,
  resolveFleetWorkerWorktreeDir,
  ultraworkFleetEventAlias,
  SWARM_MAKER_CHECKER_AGENT_SWARM_TIP,
  SWARM_MAKER_CHECKER_SOFT_TIP,
  classifyExpertRoleString,
  classifySwarmLaneRole,
  classifySwarmPhaseRole,
  detectAgentSwarmItemRoleCollision,
  detectMakerCheckerCollisions,
  detectMakerCheckerCollisionsFromAssignments,
  detectMakerCheckerCollisionsFromSwarmOutput,
  formatMakerCheckerSoftWarn,
  makerCheckerSoftWarnFromAgentSwarmItems,
  makerCheckerSoftWarnFromSwarmOutput,
  FLEET_BUDGET_USD_ENV,
  SWARM_COST_GUARD_SOFT_TIP,
  evaluateFleetCostGuardSoft,
  estimateSessionCostUsd,
  fleetCostGuardSoftTipFromAgent,
  fleetCostGuardSoftTipFromSwarmOutput,
  fleetCostGuardSoftTipFromUsage,
  formatFleetCostGuardSoftTip,
  loadFleetBudgetGlance,
} from '#/fleet';
export type { FleetUltraworkEventSuffix, MakerCheckerCollision, SwarmMakerCheckerRole, SwarmRoleAssignment } from '#/fleet';

// Browser-use runtime for in-app browser
export {
  createBrowserUseRuntime,
  type BrowserUseProvider,
  type BrowserUseRuntimeOptions,
} from '@superliora/gui-use';
export type {
  BrowserUseRuntime,
  BrowserObservation,
  BrowserScreenshotInput,
  BrowserActInput,
  BrowserActResult,
  BrowserAction,
  BrowserStatus,
  RuntimeImage,
} from '@superliora/gui-use';
