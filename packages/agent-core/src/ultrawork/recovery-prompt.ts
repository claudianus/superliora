/**
 * Pure Ultrawork recovery report/prompt builders (no Agent mutation).
 */

import type { UltraworkRun } from '@superliora/protocol';

import {
  inferEffectiveUltraworkStage,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from './stage-progress';
import type {
  UltraworkActivation,
  UltraworkPlanRecoveryContext,
  UltraworkRecoveryReport,
  UltraworkResumeCursor,
} from './types';

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
    'Resume from the last durable checkpoint. Do not restart from scratch unless unusable.',
    `Run id: ${report.run.id}`,
    `Objective: ${report.run.objective}`,
    `Stage: ${report.run.stage}`,
    `Status: ${report.run.status}`,
    `Last updated: ${report.run.updatedAt}`,
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
    lines.push(`UltraPlan phase: ${planContext.phase}; do not create a new plan file or restart EnterPlanMode.`);
  }
  if (planContext?.interviewRoundCount !== undefined && planContext.interviewRoundCount > 0) {
    lines.push(`Interview rounds completed: ${String(planContext.interviewRoundCount)}; do not restart UltraPlan interview from round 1.`);
  }
  if (report.skippedInterview === true) {
    lines.push(
      'Resume policy: Skip UltraPlan interview on resume. Continue design/implementation/verification from checkpoint.',
    );
    lines.push(
      'Do not ask blocking interview questions unless a critical missing blocker blocks progress.',
    );
  }

  const progress = summarizeWorkGraphProgress(report.run.workGraph);
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
      'Do not restart UltraResearch, UltraPlan interview, or other completed stages unless the checkpoint is unusable.',
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
  }

  // Keep only the most actionable pending nodes / orphans; full graph is on disk.
  if (report.run.workGraph !== undefined && report.run.workGraph.nodes.length > 0) {
    const pending = report.run.workGraph.nodes.filter((node) => node.status !== 'done');
    if (pending.length > 0) {
      lines.push(`Pending WorkGraph nodes (${String(pending.length)}):`);
      for (const node of pending.slice(0, 5)) {
        lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
      }
      if (pending.length > 5) {
        lines.push(`- … ${String(pending.length - 5)} more`);
      }
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
    'Continue from current stage; refresh evidence; keep WorkGraph current. Prefer tests/typecheck/real-surface proof over claims; mark AC/nodes done only with evidence. Preserve durable ids.',
  );
  lines.push('</ultrawork_recovery>');
  return lines.join('\n');
}

export function suggestNextActions(
  run: UltraworkRun,
  interruptReason?: string,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
  skippedInterview = false,
): string[] {
  const actions: string[] = [];
  if (interruptReason !== undefined) {
    actions.push(`Acknowledge interruption (${interruptReason}); restate remaining objective.`);
  }

  const progress = summarizeWorkGraphProgress(run.workGraph);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  if (
    progress.doneCount > 0 &&
    ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('research') &&
    run.stage === 'research'
  ) {
    actions.push(
      'WorkGraph is ahead of checkpoint — continue in-progress node; do not restart research.',
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
      if (planPhase === 'design' || planPhase === 'review' || planPhase === 'write') {
        actions.push(`Resume UltraPlan ${planPhase}; advance toward ExitPlanMode without new interview rounds.`);
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
          'Research-first before AskUserQuestion; offer Baseline + Upgrade choices.',
        );
        break;
      }
      case 'design':
        actions.push('Resume design exploration and coverage lanes before Review.');
        break;
      case 'review':
        actions.push('Re-verify plan against code/sources, then advance to Write when ready.');
        break;
      case 'write':
        actions.push('Resume writing approved plan sections; do not reopen a fresh interview.');
        break;
      case 'exit':
        actions.push('Call ExitPlanMode only after Seed Spec gate still passes.');
        break;
      default:
        actions.push('Re-open the active Ultra Plan file; continue interview or plan gate.');
        break;
    }
  } else {
    switch (effectiveStage) {
      case 'intake':
        actions.push('Re-open the active Ultra Plan file; continue interview or plan gate.');
        break;
      case 'goal':
        actions.push('Verify UltraGoal contract and resume autonomous pursuit.');
        break;
      case 'staff':
      case 'swarm':
        actions.push('Reconcile swarm staffing; rerun UltraSwarm only if ENGAGE still required.');
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
    }
  }

  return actions.slice(0, 4);
}
