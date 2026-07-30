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
} from './evidence';
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
} from './node-actions';
export {
  formatEmptyWorkGraphSeedNextActions,
  formatHighResumeOscillationNextActions,
  formatLongRunningStageNextActions,
} from './stage-actions';
export { suggestNextActions } from './suggest';
export {
  buildUltraworkRecoveryPrompt,
  buildUltraworkRecoveryReport,
} from './build';
