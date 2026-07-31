import type { UltraworkRun } from '@superliora/protocol';

import {
  analyzeFailedNodes,
  countResumeCyclesFromHistory,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  inferEffectiveUltraworkStage,
  OSCILLATION_WARN_THRESHOLD,
  summarizeWorkGraphProgress,
} from '../stage-progress';
import {
  collectVerificationGapNodes,
  formatVerificationGapNextActions,
  formatVerificationGapSummary,
} from './evidence';
import {
  formatBlockedNodeNextActions,
  formatFailedNodeNextActions,
  formatNeedsIntegrationNextActions,
  formatOwnerlessRunningNextActions,
  formatQueuedDependsOnWaitNextActions,
  formatStuckNodeNextActions,
} from './node-actions';
import { formatEmptyWorkGraphSeedNextActions } from './stage-actions';
import { suggestNextActions } from './suggest';
import type {
  UltraworkActivation,
  UltraworkPlanRecoveryContext,
  UltraworkRecoveryReport,
  UltraworkResumeCursor,
} from '../types';

export function buildUltraworkRecoveryReport(input: {
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
  readonly planContext?: UltraworkPlanRecoveryContext;
  readonly resumeCursor?: UltraworkResumeCursor;
  readonly skippedInterview?: boolean;
}): UltraworkRecoveryReport {
  return {
    run: input.run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    orphanedWorkNodes: input.orphanedWorkNodes,
    orphanedExperts: input.orphanedExperts,
    lostBackgroundTasks: input.lostBackgroundTasks,
    skippedInterview: input.skippedInterview,
    nextActions: suggestNextActions(
      input.run,
      input.interruptReason,
      input.planContext,
      input.resumeCursor,
      input.skippedInterview,
    ),
  };
}

export function buildUltraworkRecoveryPrompt(
  report: UltraworkRecoveryReport,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
): string {
  const lines = [
    '<ultrawork_recovery>',
    'Resume from last durable checkpoint. Do not restart from scratch unless unusable.',
    `Run: ${report.run.id} · stage=${report.run.stage} · status=${report.run.status}`,
    `Objective: ${report.run.objective}`,
    `Updated: ${report.run.updatedAt}`,
  ];

  if (report.interruptReason !== undefined) {
    lines.push(`Interrupt reason: ${report.interruptReason}`);
  }
  if (report.activation !== undefined) {
    lines.push(`Evidence root: ${report.activation.evidenceRoot}`);
  }
  if (planContext?.planFilePath !== undefined) {
    lines.push(`Plan file: ${planContext.planFilePath}`);
  }
  if (planContext?.phase !== undefined) {
    lines.push(`UltraPlan phase: ${planContext.phase}; do not create plan file or restart EnterPlanMode.`);
  }
  if (planContext?.interviewRoundCount !== undefined && planContext.interviewRoundCount > 0) {
    lines.push(`Interview rounds completed: ${String(planContext.interviewRoundCount)}; do not restart interview from round 1.`);
  }
  if (report.skippedInterview === true) {
    lines.push(
      'Resume policy: Skip UltraPlan interview. Continue design/implementation/verification from checkpoint.',
    );
    lines.push(
      'Do not ask blocking interview questions unless a critical blocker blocks progress.',
    );
  }

  const progress = summarizeWorkGraphProgress(report.run.workGraph);
  const graphNodeCount = report.run.workGraph?.nodes.length ?? 0;
  // Body-level seed (nextActions already prioritizes empty graphs) — match injectors/envelope.
  if (graphNodeCount === 0) {
    lines.push('WorkGraph empty or missing.');
    lines.push(...formatEmptyWorkGraphSeedNextActions());
  }
  if (progress.doneCount > 0 || progress.pendingCount > 0) {
    lines.push(
      `WorkGraph progress: ${String(progress.doneCount)} done, ${String(progress.pendingCount)} pending.`,
    );
  }

  const effectiveStage = inferEffectiveUltraworkStage(report.run.stage, report.run.workGraph);
  if (effectiveStage !== report.run.stage) {
    lines.push(
      `Effective resume stage: ${effectiveStage} (checkpoint stage ${report.run.stage} is behind WorkGraph progress).`,
    );
    lines.push(
      'Do not restart UltraResearch, UltraPlan interview, or other completed stages unless checkpoint is unusable.',
    );
  }

  if (resumeCursor !== undefined) {
    lines.push('Resume cursor:');
    lines.push(`- stage: ${resumeCursor.stage}`);
    if (resumeCursor.planPhase !== undefined) {
      lines.push(`- plan_phase: ${resumeCursor.planPhase}`);
    }
    if (resumeCursor.interviewRound !== undefined && resumeCursor.interviewRound > 0) {
      lines.push(`- continue_interview_from_round: ${String(resumeCursor.interviewRound + 1)}`);
    }
    if (resumeCursor.workGraphNodeId !== undefined) {
      lines.push(`- work_graph_node: ${resumeCursor.workGraphNodeId}`);
    }
    if (resumeCursor.goalStatus !== undefined) {
      lines.push(`- goal_status: ${resumeCursor.goalStatus}`);
    }
    if (resumeCursor.journalOffset !== undefined) {
      lines.push(`- journal_offset: ${String(resumeCursor.journalOffset)}`);
    }
  }

  // Keep only the most actionable pending nodes / orphans; full graph is on disk.
  // cancelled is success-terminal (deliberate scope drop) — match injectors / resume-intent.
  // Injector/envelope-grade stall classification so crash recovery is not a flat pending dump.
  if (report.run.workGraph !== undefined && report.run.workGraph.nodes.length > 0) {
    const nodes = report.run.workGraph.nodes;
    const pending = nodes.filter(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    );
    const failedNodes = nodes.filter((node) => node.status === 'failed');
    const needsIntegrationNodes = nodes.filter((node) => node.status === 'needs_integration');
    const blockedNodes = nodes.filter((node) => node.status === 'blocked');
    const ownerlessRunningNodes = nodes.filter(
      (node) =>
        node.status === 'running' &&
        (node.ownerExpertId === undefined || node.ownerExpertId.length === 0) &&
        (node.ownerAgentId === undefined || node.ownerAgentId.length === 0),
    );
    const waitingQueuedNodes = nodes.filter((node) => {
      if (node.status !== 'queued') return false;
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    });
    const verificationGapNodes = collectVerificationGapNodes(nodes);

    if (failedNodes.length > 0) {
      lines.push(
        `Failed WorkGraph nodes (${String(failedNodes.length)}): ${failedNodes
          .slice(0, 4)
          .map((node) => `${node.id} ${node.title}`)
          .join(', ')}${failedNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(...formatFailedNodeNextActions(failedNodes, report.run.workGraph));
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
    if (waitingQueuedNodes.length > 0 && blockedNodes.length === 0) {
      lines.push(
        `Queued waiting on dependsOn (${String(waitingQueuedNodes.length)}): ${waitingQueuedNodes
          .slice(0, 4)
          .map((node) => {
            const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
            return `${node.id} (dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? `, … +${String(deps.length - 3)} more` : ''})`;
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

    if (pending.length > 0) {
      lines.push(`Pending WorkGraph nodes (${String(pending.length)}):`);
      for (const node of pending.slice(0, 5)) {
        lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
      }
      if (pending.length > 5) {
        lines.push(`- … ${String(pending.length - 5)} more`);
      }
    }
    // Highlight stuck nodes (running/blocked) that may need circuit-breaking.
    const stuckNodes = detectStuckWorkGraphNodes(report.run.workGraph);
    if (stuckNodes.length > 0) {
      lines.push(
        `⚠ Stuck nodes (${String(stuckNodes.length)}): ${stuckNodes.slice(0, 3).map((n) => `${n.id} [${n.status}]`).join(', ')}`,
      );
      lines.push(...formatStuckNodeNextActions(stuckNodes));
    }
  }
  // Warn about stages running longer than expected (un-bounded loop anti-pattern).
  const longStage = detectLongRunningStage(report.run);
  if (longStage !== undefined) {
    const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
    const thresholdMin = Math.round(longStage.thresholdMs / 60_000);
    lines.push(
      `⚠ Stage "${longStage.stage}" running ~${String(elapsedMin)}min (expected <${String(thresholdMin)}min). Consider advancing or splitting work.`,
    );
  }
  // Warn about oscillation (repeated crash-recovery loops).
  const resumeCycles = countResumeCyclesFromHistory(report.run);
  if (resumeCycles >= OSCILLATION_WARN_THRESHOLD) {
    lines.push(
      `⚠ High resume count (${String(resumeCycles)}): repeated crash-recovery cycles detected. Consider simplifying the objective or breaking into smaller runs.`,
    );
  }
  // Analyze failed nodes and provide categorized recovery guidance.
  const failedAnalysis = analyzeFailedNodes(report.run.workGraph);
  if (failedAnalysis.length > 0) {
    lines.push(`Failed nodes (${String(failedAnalysis.length)}):`);
    for (const { node, category, guidance } of failedAnalysis.slice(0, 3)) {
      lines.push(`- ${node.id} [${category}]: ${guidance}`);
    }
    if (failedAnalysis.length > 3) {
      lines.push(`- … ${String(failedAnalysis.length - 3)} more failed nodes`);
    }
  }
  if (report.orphanedWorkNodes.length > 0) {
    lines.push(`Reconcile orphaned work nodes: ${report.orphanedWorkNodes.slice(0, 8).join(', ')}`);
  }
  if (report.orphanedExperts.length > 0) {
    lines.push(`Reconcile orphaned experts: ${report.orphanedExperts.slice(0, 8).join(', ')}`);
  }
  if (report.lostBackgroundTasks.length > 0) {
    lines.push(`Lost/failed background tasks: ${report.lostBackgroundTasks.slice(0, 8).join(', ')}`);
  }

  lines.push('Next actions:');
  for (const action of report.nextActions.slice(0, 4)) {
    lines.push(`- ${action}`);
  }
  lines.push(
    'Source of truth: Repository files, git status, and WorkGraph are more reliable than prior chat memory. Inspect workspace first.',
  );
  lines.push(
    'Continue from stage; refresh evidence; keep WorkGraph current. Prefer tests/typecheck/real-surface proof; mark AC/nodes done only with evidence. Preserve durable ids.',
  );
  lines.push('</ultrawork_recovery>');
  const result = lines.join('\n');
  // Guard: clip excessively large recovery prompts to protect context budget.
  const MAX_RECOVERY_PROMPT_CHARS = 4_000;
  if (result.length > MAX_RECOVERY_PROMPT_CHARS) {
    return `${result.slice(0, MAX_RECOVERY_PROMPT_CHARS)}\n… (truncated)\n</ultrawork_recovery>`;
  }
  return result;
}
