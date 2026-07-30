/**
 * Pure Ultrawork recovery report/prompt builders (no Agent mutation).
 */

export {
  collectVerificationGapNodes,
  formatEvidenceHardGateCompleteBan,
  formatEvidenceHardGateNextActions,
  formatEvidenceHardGateSummary,
  formatVerificationGapNextActions,
  formatVerificationGapSummary,
} from './recovery-prompt-evidence';
export {
  formatBlockedNodeNextActions,
  formatBlockedNodeStallBan,
  formatFailedNodeCompleteBan,
  formatFailedNodeNextActions,
  formatIncompleteNodeCompleteBan,
  formatIncompleteNodeNextActions,
  formatNeedsIntegrationCompleteBan,
  formatNeedsIntegrationNextActions,
  formatOwnerlessRunningNextActions,
  formatQueuedDependsOnWaitNextActions,
  formatStuckNodeNextActions,
} from './recovery-prompt-node-actions';
export {
  formatEmptyWorkGraphSeedNextActions,
  formatHighResumeOscillationNextActions,
  formatLongRunningStageNextActions,
} from './recovery-prompt-stage-actions';
export { suggestNextActions } from './recovery-prompt-suggest';
export {
  buildUltraworkRecoveryPrompt,
  buildUltraworkRecoveryReport,
} from './recovery-prompt-build';
