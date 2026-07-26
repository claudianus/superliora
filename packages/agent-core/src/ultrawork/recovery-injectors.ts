import type { UltraworkStage } from '@superliora/protocol';

import type { Agent } from '../agent';
import { maybeFinishUltraworkRun } from './finish-run';
import {
  analyzeFailedNodes,
  countResumeCyclesFromHistory,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  inferEffectiveUltraworkStage,
  maxUltraworkStage,
  OSCILLATION_WARN_THRESHOLD,
  ultraworkStageIndex,
} from './stage-progress';
import type { UltraworkPlanRecoveryContext } from './types';
import {
  collectVerificationGapNodes,
  formatBlockedNodeNextActions,
  formatEmptyWorkGraphSeedNextActions,
  formatEvidenceHardGateNextActions,
  formatEvidenceHardGateSummary,
  formatFailedNodeNextActions,
  formatHighResumeOscillationNextActions,
  formatIncompleteNodeNextActions,
  formatLongRunningStageNextActions,
  formatNeedsIntegrationNextActions,
  formatOwnerlessRunningNextActions,
  formatQueuedDependsOnWaitNextActions,
  formatStuckNodeNextActions,
  formatVerificationGapNextActions,
  formatVerificationGapSummary,
  suggestNextActions,
} from './recovery-prompt';
import {
  buildUltraworkResumeCursor,
  inferResumeStageFloor,
} from './recovery-resume';

export function maybeAdvanceUltraworkStage(
  agent: Agent,
  to: UltraworkStage,
  reason?: string,
): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status === 'done' || run.status === 'failed') return;
  if (run.stage === to) return;

  const resumeFloor = maxUltraworkStage(
    inferEffectiveUltraworkStage(run.stage, run.workGraph),
    inferResumeStageFloor(run),
  );
  if (ultraworkStageIndex(to) < ultraworkStageIndex(resumeFloor)) return;

  try {
    ultrawork.advance(to, reason);
  } catch (error) {
    // Stage transitions are best-effort; do not fail the caller.
    // Log so genuine bugs (e.g. invalid skip) are observable.
    agent.log.warn('ultrawork stage advance failed', { to, reason, error });
  }
}

export function maybeAdvanceUltraworkOnGoalComplete(agent: Agent): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status === 'done' || run.status === 'failed') return;
  // Only finish when the completion audit + WorkGraph allow it.
  // Never force completeLearnStage on empty/incomplete graphs — that was a
  // false-complete path (model UpdateGoal(complete) while still in plan).
  void maybeFinishUltraworkRun(agent);
}


/**
 * Shared WorkGraph stall classification + nextActions for post-swarm /
 * post-compaction injectors so the two surfaces cannot drift.
 */
function appendWorkGraphRecoveryLines(
  lines: string[],
  run: NonNullable<ReturnType<NonNullable<Agent['ultrawork']>['getRun']>>,
): void {
  const graphNodeCount = run.workGraph?.nodes.length ?? 0;
  if (graphNodeCount === 0) {
    lines.push('WorkGraph empty or missing.');
    lines.push(...formatEmptyWorkGraphSeedNextActions());
  }

  const pendingNodes =
    run.workGraph?.nodes.filter(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    ) ?? [];
  const failedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'failed') ?? [];
  const needsIntegrationNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'needs_integration') ?? [];
  const blockedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'blocked') ?? [];
  const ownerlessRunningNodes =
    run.workGraph?.nodes.filter(
      (node) =>
        node.status === 'running' &&
        (node.ownerExpertId === undefined || node.ownerExpertId.length === 0) &&
        (node.ownerAgentId === undefined || node.ownerAgentId.length === 0),
    ) ?? [];
  const verificationGapNodes = collectVerificationGapNodes(run.workGraph?.nodes);

  if (failedNodes.length > 0) {
    lines.push(
      `Failed WorkGraph nodes (${String(failedNodes.length)}): ${failedNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${failedNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatFailedNodeNextActions(failedNodes, run.workGraph));
    const failedAnalysis = analyzeFailedNodes(run.workGraph);
    for (const { node, category, guidance } of failedAnalysis.slice(0, 2)) {
      lines.push(`- ${node.id} [${category}]: ${guidance}`);
    }
  }
  if (needsIntegrationNodes.length > 0) {
    lines.push(
      `Needs-integration WorkGraph nodes (${String(needsIntegrationNodes.length)}): ${needsIntegrationNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${needsIntegrationNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatNeedsIntegrationNextActions(needsIntegrationNodes));
  }
  if (blockedNodes.length > 0) {
    lines.push(
      `Blocked WorkGraph nodes (${String(blockedNodes.length)}): ${blockedNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${blockedNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatBlockedNodeNextActions(blockedNodes));
  }
  if (ownerlessRunningNodes.length > 0) {
    lines.push(
      `Ownerless running WorkGraph nodes (${String(ownerlessRunningNodes.length)}): ${ownerlessRunningNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${ownerlessRunningNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatOwnerlessRunningNextActions(ownerlessRunningNodes));
  }
  const waitingQueuedNodes =
    run.workGraph?.nodes.filter((node) => {
      if (node.status !== 'queued') return false;
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    }) ?? [];
  if (waitingQueuedNodes.length > 0 && blockedNodes.length === 0) {
    lines.push(
      `Queued waiting on dependsOn (${String(waitingQueuedNodes.length)}): ${waitingQueuedNodes
        .slice(0, 4)
        .map((node) => {
          const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
          return `${node.id} (dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`;
        })
        .join('; ')}${waitingQueuedNodes.length > 4 ? '; …' : ''}`,
    );
    lines.push(...formatQueuedDependsOnWaitNextActions(waitingQueuedNodes));
  }
  if (verificationGapNodes.length > 0) {
    lines.push(
      `Verification-gap WorkGraph nodes (${String(verificationGapNodes.length)}): ${formatVerificationGapSummary(verificationGapNodes)}${verificationGapNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatVerificationGapNextActions(verificationGapNodes));
  }
  {
    const evidenceHardGateSummary = formatEvidenceHardGateSummary(run.workGraph?.nodes);
    if (evidenceHardGateSummary !== undefined) {
      lines.push(`Evidence hard-gate nodes: ${evidenceHardGateSummary}`);
      lines.push(...formatEvidenceHardGateNextActions(run.workGraph?.nodes));
    }
  }
  if (pendingNodes.length > 0) {
    lines.push(
      `Pending WorkGraph nodes (${String(pendingNodes.length)}): ${pendingNodes
        .slice(0, 4)
        .map((node) => `${node.id}[${node.status}] ${node.title}`)
        .join(', ')}${pendingNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(...formatIncompleteNodeNextActions());
  }
  // Match recovery-prompt / envelope circuit-break signals on mid-run injectors.
  const stuckNodes = detectStuckWorkGraphNodes(run.workGraph);
  if (stuckNodes.length > 0) {
    lines.push(
      `stuck_nodes: ${stuckNodes
        .slice(0, 5)
        .map((node) => `${node.id}[${node.status}]`)
        .join(', ')}`,
    );
    lines.push(...formatStuckNodeNextActions(stuckNodes));
  }
  const longStage = detectLongRunningStage(run);
  if (longStage !== undefined) {
    const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
    const thresholdMin = Math.round(longStage.thresholdMs / 60_000);
    lines.push(
      `long_running_stage: ${longStage.stage} ~${String(elapsedMin)}min (expected <${String(thresholdMin)}min) — consider advancing or splitting work.`,
      ...formatLongRunningStageNextActions(longStage),
    );
  }
  const resumeCycles = countResumeCyclesFromHistory(run);
  if (resumeCycles >= OSCILLATION_WARN_THRESHOLD) {
    lines.push(
      `high_resume_count: ${String(resumeCycles)} (≥${String(OSCILLATION_WARN_THRESHOLD)}) — repeated crash-recovery cycles; simplify objective or split run.`,
      ...formatHighResumeOscillationNextActions(resumeCycles),
    );
  }
}

export function injectUltraworkPostSwarmContinuation(agent: Agent): void {
  const run = agent.ultrawork?.getRun();
  if (run === null || run === undefined || run.status !== 'running') return;
  if (run.stage !== 'integrate') return;

  const planContext = agent.ultrawork.isModeEnabled()
    ? capturePlanRecoveryContextFromAgent(agent)
    : undefined;
  const resumeCursor = buildUltraworkResumeCursor(agent, run, planContext);
  const nextActions = suggestNextActions(
    run,
    'UltraSwarm finished — integrate then verify',
    planContext,
    resumeCursor,
  );

  const interruptReason = agent.ultrawork?.getInterruptReason()?.trim();
  const lines = [
    '<ultrawork_post_swarm>',
    'UltraSwarm finished. Continue this Ultrawork run in order:',
    `Run: ${run.id} · stage=${run.stage} · status=${run.status}`,
    `Objective: ${run.objective}`,
    '1. Integrate — merge specialist output, resolve conflicts, pick an integration owner before more product edits.',
    '2. Verify — mechanical + real-surface checks for acceptance criteria.',
    '3. Learn — persist only verified durable findings to Liora Recall or LLM Wiki.',
  ];
  if (interruptReason !== undefined && interruptReason.length > 0) {
    lines.push(`Interrupt reason: ${interruptReason}`);
  }
  if (resumeCursor.workGraphNodeId !== undefined) {
    lines.push(`Resume node: ${resumeCursor.workGraphNodeId}`);
  }
  if (resumeCursor.journalOffset !== undefined) {
    lines.push(`journal_offset: ${String(resumeCursor.journalOffset)}`);
  }
  appendWorkGraphRecoveryLines(lines, run);
  if (nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of nextActions.slice(0, 3)) {
      lines.push(`- ${action}`);
    }
  }
  lines.push(
    'Do not call UltraSwarm again unless revision gaps truly require another specialist wave.',
    'False-complete guard: UpdateGoal(complete) is rejected while WorkGraph is empty/incomplete or requiredEvidence lacks verificationStatus=passed. Keep working until audit passes — do not wait for the user to re-prompt.',
    '</ultrawork_post_swarm>',
  );
  agent.context.appendSystemReminder(lines.join('\n'), {
    kind: 'injection',
    variant: 'ultrawork_post_swarm',
  });
}

export function injectUltraworkPostCompactionContinuation(agent: Agent): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status !== 'running') return;

  const planContext = ultrawork.isModeEnabled()
    ? capturePlanRecoveryContextFromAgent(agent)
    : undefined;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const resumeCursor = buildUltraworkResumeCursor(agent, run, planContext);
  const nextActions = suggestNextActions(run, 'Context compacted', planContext, resumeCursor);

  const interruptReason = ultrawork.getInterruptReason()?.trim();
  const lines = [
    '<ultrawork_post_compaction>',
    'Context compacted during active Ultrawork. Continue from the durable checkpoint — do not restart UltraPlan/UltraResearch or open a new Ultrawork run.',
    `Run: ${run.id} · stage=${run.stage} · status=${run.status}`,
    `Objective: ${run.objective}`,
  ];
  if (effectiveStage !== run.stage) {
    lines.push(`Effective stage: ${effectiveStage}`);
  }
  if (interruptReason !== undefined && interruptReason.length > 0) {
    lines.push(`Interrupt reason: ${interruptReason}`);
  }
  if (resumeCursor.workGraphNodeId !== undefined) {
    lines.push(`Resume node: ${resumeCursor.workGraphNodeId}`);
  }
  if (resumeCursor.journalOffset !== undefined) {
    lines.push(`journal_offset: ${String(resumeCursor.journalOffset)}`);
  }
  appendWorkGraphRecoveryLines(lines, run);

  const stageGuidance = stageContinuationGuidance(effectiveStage, agent.ultraSwarmRun !== undefined);
  if (stageGuidance !== undefined) {
    lines.push(stageGuidance);
  }

  if (nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of nextActions.slice(0, 3)) {
      lines.push(`- ${action}`);
    }
  }
  lines.push(
    'False-complete guard: do not mark the goal complete without a seeded WorkGraph, evidence, and verification. Continue the loop autonomously.',
  );
  lines.push('</ultrawork_post_compaction>');

  agent.context.appendSystemReminder(lines.join('\n'), {
    kind: 'injection',
    variant: 'ultrawork_post_compaction',
  });
}

export function capturePlanRecoveryContextFromAgent(agent: Agent): UltraworkPlanRecoveryContext | undefined {
  const planMode = agent.planMode;
  if (!planMode.isActive || !planMode.isUltraMode) return undefined;
  return {
    planFilePath: planMode.planFilePath ?? undefined,
    phase: planMode.phase,
    interviewRoundCount: planMode.interviewRoundCount,
    ultraPlan: planMode.captureStateCheckpoint()?.ultraPlan,
  };
}

function stageContinuationGuidance(stage: UltraworkStage, duringSwarm: boolean): string | undefined {
  if (duringSwarm) {
    return 'UltraSwarm is active. Let the current wave finish; integrate/verify after swarm completes.';
  }
  switch (stage) {
    case 'plan':
      return 'Continue UltraPlan interview/plan gate from checkpoint. Do not create a new plan file.';
    case 'research':
      return 'Refresh or extend the evidence pack as needed. Do not restart UltraResearch from scratch.';
    case 'staff':
    case 'swarm':
      return 'Reconcile team staffing; call UltraSwarm only when ENGAGE is still required.';
    case 'integrate':
      return 'Merge specialist output and resolve conflicts before more product edits.';
    case 'verify':
      return 'Re-run mechanical checks and capture runtime evidence for open AC. Prefer deterministic proof over claimed success. Verification checklist: (1) typecheck/lint pass, (2) tests pass, (3) acceptance criteria have runtime evidence, (4) no regressions in adjacent surfaces.';
    case 'learn':
      return 'Promote only verified findings to Liora Recall or LLM Wiki.';
    default:
      return undefined;
  }
}

export { maybeFinishUltraworkRun } from './finish-run';
