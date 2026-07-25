export { LioraHarness, LioraMemoryClient } from '#/liora-harness';
export type { LioraHarnessRuntimeOptions } from '#/liora-harness';
export {
  HarnessDiagnostics,
  type DiagnosticCallbacks,
  type DiagnosticEvent,
  type DiagnosticOptions,
  type DiagnosticSeverity,
  type HealthSnapshot,
} from '#/harness-diagnostics';
export { Session } from '#/session';
export { tryAutoResumeUltrawork, ensureUltraworkResumeSetup } from '#/ultrawork-auto-resume';
export type { AutoResumeUltraworkResult } from '#/ultrawork-auto-resume';
export { LioraAuthFacade } from '#/auth';
export {
  createLioraHarness,
  SDKRpcClient,
  type SDKRpcClientOptions,
} from '#/sdk-rpc-client';
export {
  createLioraConfigRpc,
  LioraConfigRpcClient,
  type LioraConfigRpc,
  type LioraConfigValidationIssue,
  type LioraConfigValidationPathSegment,
  type ResolveLioraConfigPathInput,
  type ValidateLioraConfigTomlInput,
} from '#/config-rpc';
export { SDKRpcClientBase } from '#/rpc';
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

export {
  humanizeCollaborationEvent,
  looksLikeProtocolMessage,
  DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD,
  createSwarmBudgetState,
  evaluateSwarmBudget,
  isWastedBudgetRound,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
  DEFAULT_MAX_PER_DIVISION,
  applyStaffingDiversity,
  containsHangul,
  expertIdPrefix,
  formatSelectionReason,
  rewriteExpertSearchQuery,
  readyNodeIds,
  areDependenciesSatisfied,
  SWARM_DAG_DONE_STATUSES,
  SWARM_DAG_TERMINAL_STATUSES,
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
  preferReadyWorkNodeIds,
  partitionReadyWorkNodeIds,
  rebindPhaseWorkNodeIds,
  attachDraftToDebate,
  buildDebateContext,
  createDebate,
  buildDebateDraftHandoffPack,
  debateDraftPhasesForHandoff,
  recordOutcomesFromSwarmResults,
  shouldSkipAdaptiveRestaff,
  shouldStopPhaseLoopAtCheckpoint,
  buildRestaffSpecs,
  canAttemptRestaff,
  selectRestaffPhaseSpecs,
  hasPendingUltraSwarmRestaff,
  requestUltraSwarmRestaff,
  consumeUltraSwarmRestaffRequests,
  isRestaffSteerText,
  createUltraSwarmRunContext,
  collectRestaffGaps,
  needsRestaffing,
  restaffSlotsAvailable,
  shouldPlanRestaffWave,
} from '@superliora/agent-core';
export type {
  HumanizeCollaborationEventInput,
  HumanizeSeverity,
  HumanizedCollaborationEvent,
  CreateSwarmBudgetStateOptions,
  SwarmBudgetRoundInput,
  SwarmBudgetRoundRecord,
  SwarmBudgetState,
  SwarmBudgetSuggestion,
  RewriteExpertSearchQueryOptions,
  StaffingDiversityOptions,
  SwarmDagNode,
  SwarmDagNodeStatus,
  PhaseWorkNodeBinding,
  StaffingGoldCase,
  StaffingOutcomeInput,
  StaffingOutcomeRecord,
  VisualDiffResult,
  DebateDraftHandoffEntry,
  DebateConfig,
  DebateState,
  BuildDebateContextOptions,
  ReviewHeuristicComment,
  ReviewHeuristicFile,
  ReviewSeverity,
  RestaffGapResult,
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

export * from '#/events';
export type * from '#/types';

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
