/**
 * Mission — ultrawork implementation home (physical rename complete; wire stays ultrawork.*).
 *
 * Protocol soft path (2026-07): wire still emits canonical `ultrawork.*` events.
 * Consumers normalize `mission.*` / `fleet.*` aliases on read via
 * `normalizeMissionOrFleetUltraworkEventAlias` (protocol parse + TUI handler).
 * Optional live-only dual emit: `maybeEmitMissionUltraworkAliasLive` when
 * `SUPERLIORA_MISSION_DUAL_EMIT=1` or `SUPERLIORA_SOVEREIGN=1` — Agent wires this; journal stays canonical.
 */
export * from './state';
export * from './types';
export * from './run-store';
export * from './mode';
export {
  applyUltraworkResumeSkipInterview,
  buildUltraworkRecoveryPrompt,
  buildUltraworkResumeCursor,
  inferResumeStageFloor,
  injectUltraworkPostCompactionContinuation,
  injectUltraworkPostSwarmContinuation,
  maybeAdvanceUltraworkOnGoalComplete,
  maybeAdvanceUltraworkStage,
  maybeFinishUltraworkRun,
  promoteUltraworkRunStageForResume,
  reconcileUltraworkRunForResume,
  releaseUltraworkPlanModeIfComplete,
  shouldKeepPlanModeForUltraworkRun,
  shouldSkipInterviewOnUltraworkResume,
} from './recovery';
export {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
  gateWorkGraphNodes,
} from './completion-audit';
export type {
  AuditUltraworkCompletionInput,
  CompletionAuditCode,
  CompletionAuditPass,
  CompletionAuditRejection,
  CompletionAuditResult,
} from './completion-audit';
export { injectCompletionAuditRejectionReminder } from './finish-run';
export {
  CONTINUE_GOAL_INPUT,
  detectInterruptedWorkResumeIntentWithLlm,
  hasInterruptedWorkResumeContext,
  matchExplicitResumePhrase,
  shouldActOnResumeIntent,
} from './resume-intent-llm';
export {
  detectUltraworkAutoActivationWithLlm,
  isOpenEndedImprovementLoop,
  shouldActOnUltraworkAutoActivation,
} from './auto-activate-llm';
export type {
  UltraworkAutoActivationIntent,
  UltraworkAutoActivationLlmDeps,
} from './auto-activate-llm';
export {
  detectUltraworkObjectiveProfileWithLlm,
  fallbackUltraworkObjectiveProfile,
  resolveUltraworkObjectiveProfile,
  shouldTrustUltraworkObjectiveProfile,
} from './objective-profile-llm';
export type {
  UltraworkCoverageLaneId,
  UltraworkObjectiveProfile,
  UltraworkObjectiveProfileLlmDeps,
} from './objective-profile-llm';
export { UltraworkObjectiveProfileCache } from './objective-profile-cache';
export {
  buildResumeWithSteering,
  maybeTransformPromptForInterruptedWorkResume,
  readInterruptedWorkResumeContext,
} from './interrupted-work-resume';
export { resolveApprovedUltraworkPlanPath } from './approved-plan';
export {
  analyzeFailedNodes,
  applyWorkGraphProgressToRun,
  assessBackpressure,
  assessContextPressure,
  assessDegradationLevel,
  assessRecoveryEscalation,
  assessTurnBudget,
  BACKPRESSURE_GUIDANCE,
  BUDGET_GUIDANCE,
  categorizeNodeFailure,
  computeRunHealthScore,
  CONTEXT_PRESSURE_GUIDANCE,
  countResumeCyclesFromHistory,
  DEGRADATION_GUIDANCE,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  ESCALATION_GUIDANCE,
  OSCILLATION_WARN_THRESHOLD,
  FAILURE_RECOVERY_GUIDANCE,
  inferEffectiveUltraworkStage,
  maxUltraworkStage,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from './stage-progress';
export type { BackpressureInputs, BackpressureLevel, BudgetStatus, ContextPressureLevel, DegradationLevel, DegradationState, LongRunningStageInfo, RecoveryEscalationLevel, RunHealthGrade, RunHealthSignals, WorkGraphFailureCategory } from './stage-progress';
export {
  buildUltraworkCompactionEnvelope,
  captureUltraworkEnvelopeSnapshot,
  extractUltraworkRunLines,
  renderUltraworkRunsMemorySection,
} from './envelope';
export {
  inferUltraPlanPhaseFromPlanContent,
  reconcileUltraworkFromMirror,
} from './mirror-reconcile';
export {
  mirrorUltraworkRunToDisk,
  readUltraworkMirrorFromDisk,
  resolveUltraworkRunStatePath,
  validateCheckpointMirror,
  writeFileAtomic,
} from './run-store';
export type { CheckpointValidationResult } from './run-store';
export {
  ensureUltraworkWorkflowArtifacts,
  injectUltraworkWorkflowStageReminder,
  isUltraworkWorkflowReportWritePath,
  mirrorUltraworkWorkflowStage,
  recordUltraworkWorkflowStage,
  resolveUltraworkWorkflowReportPaths,
  seedUltraworkWorkflowReport,
  WORKFLOW_REPORT_FILENAME,
  WORKFLOW_STAGES_FILENAME,
} from './workflow-report';
export { formatEvidenceHardGateNextActions } from './recovery-prompt';
/** Work-graph store — light path; avoids ultrawork-graph tool + .md imports. */
export { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph-store-key';
export {
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../tools/builtin/state/ultrawork-graph-helpers';
export * from './event-alias';
export * from './aliases';
export {
  MISSION_RESUME_SMOKE_PAUSE_STAGE,
  gradeMissionResumeSmoke,
  simulateMissionResumeSmoke,
} from './mission-resume-grade';
export type {
  MissionResumeSmokeGradeResult,
  MissionResumeSmokeOptions,
} from './mission-resume-grade';
