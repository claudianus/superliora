export const ULTRAWORK_SUMMARY_REQUIRED_VALIDATIONS = Object.freeze([
  'tmuxPreflight',
  'lioraHomeReady',
  'tuiReady',
  'promptSubmitted',
  'planModeReset',
  'targetWorktreeToolingLinked',
  'ultraworkActivated',
  'linkedUltraworkStages',
  'ultraPlanInterviewReached',
  'questionHandled',
  'postQuestionProgressObserved',
  'noQuestionToolContractError',
  'noAutoQuestionPolicyConflict',
  'noInvalidPhaseTransition',
  'workspaceChanged',
  'multiFileWorkspaceChanged',
  'verifierUnchanged',
  'repositorySourceTestChanged',
  'statusLimitedToWorkflowFiles',
  'repositoryTargetedTest',
  'diffContainsSentinel',
  'verificationCommand',
  'agentVerificationObserved',
  'screenEvidence',
  'lioraModelReady',
  'resultScreenLinkedUltraworkStages',
  'usageTelemetryVisible',
  'adaptiveOperatorLoop',
  'ultraworkScorecard',
  'operatorTrajectory',
]);

export const ULTRAWORK_SUMMARY_REQUIRED_USAGE_METRICS = Object.freeze([
  'inputTokensApprox',
  'outputTokensApprox',
  'totalTokensApprox',
  'cacheReadTokensApprox',
  'cacheWriteTokensApprox',
  'cacheSharePercent',
  'contextUsagePercent',
  'contextTokensApprox',
  'maxContextTokensApprox',
  'remainingContextTokensApprox',
]);

export function isCompleteUltraworkEvidenceSummary(summary) {
  if (summary?.phase !== 'tui-ultrawork-workflow' || summary.status !== 'PASS') return false;
  if (summary.lioraHomeMode !== 'real-user-opt-in') return false;
  if (
    ULTRAWORK_SUMMARY_REQUIRED_VALIDATIONS.some(
      (name) => ultraworkValidationStatus(summary, name) !== 'PASS',
    )
  ) {
    return false;
  }
  if (missingUltraworkUsageMetricNames(summary.validations?.usageTelemetryVisible?.metrics).length > 0) {
    return false;
  }
  if (!Array.isArray(summary.workflow?.wait?.activationEvidence)) return false;
  if (summary.workflow.wait.activationEvidence.length === 0) return false;
  if (!Array.isArray(summary.workflow?.wait?.interviewEvidence)) return false;
  if (summary.workflow.wait.interviewEvidence.length === 0) return false;
  const questionValidation = ultraworkQuestionValidation(summary);
  const questionBypassed = questionValidation?.optional === true;
  if (
    !questionBypassed &&
    (!Array.isArray(summary.workflow?.wait?.questionAnswerEvidence) ||
      summary.workflow.wait.questionAnswerEvidence.length === 0)
  ) {
    return false;
  }
  if (!Array.isArray(summary.workflow?.wait?.postQuestionProgressEvidence)) return false;
  if (summary.workflow.wait.postQuestionProgressEvidence.length === 0) return false;
  if (!Array.isArray(summary.workflow?.wait?.agentVerificationEvidence)) return false;
  if (summary.workflow.wait.agentVerificationEvidence.length === 0) return false;
  if (
    Array.isArray(summary.workflow?.wait?.questionToolErrorEvidence) &&
    summary.workflow.wait.questionToolErrorEvidence.length > 0
  ) {
    return false;
  }
  if (!Array.isArray(summary.captures) || !Array.isArray(summary.inputTraces)) return false;
  if (!Array.isArray(summary.workspace?.editFiles) || summary.workspace.editFiles.length < 2) return false;
  if (summary.workspace?.editedFileCount < 2) return false;
  if (summary.workspace?.diffExitCode !== 0) return false;
  if (summary.workspace?.verificationExitCode !== 0) return false;
  return summary.workspace?.targetedTestExitCode === 0;
}

export function ultraworkQuestionValidation(summary) {
  return summary?.validations?.questionHandled;
}

function ultraworkValidationStatus(summary, name) {
  if (name === 'questionHandled') return ultraworkQuestionValidation(summary)?.status;
  return summary?.validations?.[name]?.status;
}

export function missingUltraworkUsageMetricNames(metrics) {
  if (metrics === undefined || metrics === null || typeof metrics !== 'object') {
    return [...ULTRAWORK_SUMMARY_REQUIRED_USAGE_METRICS];
  }
  return ULTRAWORK_SUMMARY_REQUIRED_USAGE_METRICS.filter((name) => {
    const value = metrics[name];
    return typeof value !== 'number' || !Number.isFinite(value);
  });
}

export function evidenceSummaryCompletedAtMs(summary, fallback) {
  const completedAtMs = Date.parse(String(summary?.completedAt ?? ''));
  if (Number.isFinite(completedAtMs)) return completedAtMs;
  const startedAtMs = Date.parse(String(summary?.startedAt ?? ''));
  if (Number.isFinite(startedAtMs)) return startedAtMs;
  return fallback;
}
