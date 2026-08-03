import type { UltraworkRun } from '@superliora/protocol';

import {
  countResumeCyclesFromHistory,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  inferEffectiveUltraworkStage,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from '../stage-progress';
import {
  collectVerificationGapNodes,
  formatEvidenceHardGateNextActions,
  formatVerificationGapNextActions,
} from './evidence';
import {
  formatBlockedNodeNextActions,
  formatFailedNodeNextActions,
  formatNeedsIntegrationNextActions,
  formatOwnerlessRunningNextActions,
  formatQueuedDependsOnWaitNextActions,
  formatStuckNodeNextActions,
} from './node-actions';
import {
  formatEmptyWorkGraphSeedNextActions,
  formatHighResumeOscillationNextActions,
  formatLongRunningStageNextActions,
} from './stage-actions';
import type { UltraworkPlanRecoveryContext, UltraworkResumeCursor } from '../types';

export function suggestNextActions(
  run: UltraworkRun,
  interruptReason?: string,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
  skippedInterview = false,
): string[] {
  const actions: string[] = [];
  if (interruptReason !== undefined) {
    actions.push(`Acknowledge interruption (${interruptReason}); restate objective.`);
  }
  // Empty/missing WorkGraph is a hard false-complete gate — seed before more product work.
  const graphNodes = run.workGraph?.nodes;
  if (graphNodes === undefined || graphNodes.length === 0) {
    actions.push(...formatEmptyWorkGraphSeedNextActions());
  }

  const progress = summarizeWorkGraphProgress(run.workGraph);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const failedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'failed') ?? [];
  if (failedNodes.length > 0) {
    actions.push(...formatFailedNodeNextActions(failedNodes, run.workGraph));
  }
  const needsIntegration =
    run.workGraph?.nodes.filter((node) => node.status === 'needs_integration') ?? [];
  if (needsIntegration.length > 0) {
    actions.push(...formatNeedsIntegrationNextActions(needsIntegration));
  }
  const blockedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'blocked') ?? [];
  if (blockedNodes.length > 0) {
    actions.push(...formatBlockedNodeNextActions(blockedNodes));
  }
  const ownerlessRunning =
    run.workGraph?.nodes.filter(
      (node) =>
        node.status === 'running' &&
        (node.ownerExpertId === undefined || node.ownerExpertId.length === 0) &&
        (node.ownerAgentId === undefined || node.ownerAgentId.length === 0),
    ) ?? [];
  if (ownerlessRunning.length > 0) {
    actions.push(...formatOwnerlessRunningNextActions(ownerlessRunning));
  }
  // Queued nodes with explicit dependsOn that are not yet terminal — surface the wait graph.
  const waitingQueued =
    run.workGraph?.nodes.filter((node) => {
      if (node.status !== 'queued') return false;
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    }) ?? [];
  if (waitingQueued.length > 0 && blockedNodes.length === 0) {
    // Skip when blocked guidance already covers dependency stalls to avoid duplicate noise.
    actions.push(...formatQueuedDependsOnWaitNextActions(waitingQueued));
  }
  const verificationGaps = collectVerificationGapNodes(run.workGraph?.nodes);
  if (verificationGaps.length > 0) {
    actions.push(...formatVerificationGapNextActions(verificationGaps));
  }
  // Match completion-audit evidence hard-gate next_actions for recovery surfaces.
  actions.push(...formatEvidenceHardGateNextActions(run.workGraph?.nodes));
  // Promote circuit-break signals into next_actions (not body-only) so injectors
  // and envelopes do not keep recommending "Resume node" during oscillation.
  // Skip blocked/ownerless already handled above — only owned running stuck remain.
  const stuckNodes = detectStuckWorkGraphNodes(run.workGraph).filter((node) => {
    if (node.status === 'blocked') return false;
    if (node.status !== 'running') return false;
    const hasOwner =
      (node.ownerExpertId !== undefined && node.ownerExpertId.length > 0) ||
      (node.ownerAgentId !== undefined && node.ownerAgentId.length > 0);
    return hasOwner;
  });
  if (stuckNodes.length > 0) {
    actions.push(...formatStuckNodeNextActions(stuckNodes));
  }
  const resumeCycles = countResumeCyclesFromHistory(run);
  actions.push(...formatHighResumeOscillationNextActions(resumeCycles));
  const longStage = detectLongRunningStage(run);
  actions.push(...formatLongRunningStageNextActions(longStage));
  if (
    progress.doneCount > 0 &&
    ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('research') &&
    run.stage === 'research'
  ) {
    actions.push(
      'WorkGraph ahead of checkpoint — continue in-progress node; do not restart research.',
    );
  }
  const planPhase = planContext?.phase ?? resumeCursor?.planPhase;
  if (progress.nextPendingNode !== undefined) {
    // Single WorkGraph resume action — avoid duplicate "resume node" lines when interview is skipped.
    actions.push(
      skippedInterview
        ? `Continue WorkGraph node ${progress.nextPendingNode.id}: ${progress.nextPendingNode.title}; do not reopen UltraPlan interview.`
        : `Resume WorkGraph node ${progress.nextPendingNode.id}: ${progress.nextPendingNode.title}.`,
    );
  }

  if (skippedInterview) {
    if (progress.nextPendingNode === undefined) {
      if (planPhase === 'design' || planPhase === 'review' || planPhase === 'write' || planPhase === 'exit') {
        actions.push(
          `Resume UltraPlan ${planPhase} from checkpoint; advance toward ExitPlanMode without new interview rounds.`,
        );
      } else if (effectiveStage === 'goal' || effectiveStage === 'staff' || effectiveStage === 'swarm') {
        actions.push('Verify UltraGoal; resume autonomous pursuit without interview questions.');
      } else if (
        effectiveStage === 'integrate' ||
        effectiveStage === 'verify' ||
        effectiveStage === 'learn'
      ) {
        actions.push(`Continue ${effectiveStage} from checkpoint; do not reopen UltraPlan interview.`);
      } else {
        actions.push('Continue from saved checkpoint; do not reopen UltraPlan interview.');
      }
    }
  } else if (effectiveStage === 'plan' || effectiveStage === 'research') {
    switch (planPhase) {
      case 'research':
        actions.push('Refresh the evidence pack before asking blocking questions.');
        break;
      case 'interview': {
        const round = planContext?.interviewRoundCount ?? resumeCursor?.interviewRound ?? 0;
        actions.push(
          round > 0
            ? `Continue UltraPlan interview from round ${String(round + 1)}; do not restart discovery.`
            : 'Continue UltraPlan interview from the current evidence pack.',
        );
        actions.push(
          'Research-first before AskUserQuestion; Baseline + Upgrade choices.',
        );
        break;
      }
      case 'design':
        actions.push('Resume design coverage lanes before Review.');
        break;
      case 'review':
        actions.push('Re-verify plan against code/sources, then advance to Write.');
        break;
      case 'write':
        actions.push('Resume writing approved plan sections; do not reopen interview.');
        break;
      case 'exit':
        actions.push('Call ExitPlanMode only after Seed Spec gate passes.');
        break;
      default:
        actions.push('Re-open Ultra Plan file; continue interview or plan gate.');
        break;
    }
  } else {
    switch (effectiveStage) {
      case 'intake':
        actions.push('Re-open Ultra Plan file; continue interview or plan gate.');
        break;
      case 'goal':
        actions.push('Verify UltraGoal contract and resume autonomous pursuit.');
        break;
      case 'staff':
      case 'swarm':
        actions.push('Reconcile swarm staffing; fan out Job workers only if ENGAGE required.');
        break;
      case 'integrate':
        actions.push('Merge specialist output and resolve conflicts before more product edits.');
        break;
      case 'verify':
        actions.push('Re-run mechanical checks; capture runtime evidence for open ACs.');
        break;
      case 'learn':
        actions.push('Update knowledge ledger; promote only verified findings.');
        break;
      case 'done':
        actions.push('Confirm completion criteria and close the run.');
        break;
      default:
        // plan/research are handled above; remaining stages fall through here.
        actions.push(
          `Continue Ultrawork stage ${String(effectiveStage)}; keep WorkGraph current and attach evidence before UpdateGoal(complete).`,
        );
        break;
    }
  }

  // Defensive: never return an empty action list — empty guidance freezes the autonomous loop.
  if (actions.length === 0) {
    actions.push(
      'Continue from durable checkpoint; re-run checks, attach evidence, and only then UpdateGoal(complete).',
    );
  }

  return actions.slice(0, 4);
}
