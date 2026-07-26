import type { UltraworkStage } from '@superliora/protocol';

import type { Agent } from '../agent';
import { maybeFinishUltraworkRun } from './finish-run';
import {
  inferEffectiveUltraworkStage,
  maxUltraworkStage,
  ultraworkStageIndex,
} from './stage-progress';
import type { UltraworkPlanRecoveryContext } from './types';
import { suggestNextActions } from './recovery-prompt';
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

  const pendingNodes =
    run.workGraph?.nodes.filter(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    ) ?? [];
  const failedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'failed') ?? [];
  const needsIntegrationNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'needs_integration') ?? [];
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
  if (failedNodes.length > 0) {
    lines.push(
      `Failed WorkGraph nodes (${String(failedNodes.length)}): ${failedNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${failedNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(
      'Failed nodes block UpdateGoal(complete) — repair, re-verify, or cancel only after deliberate scope drop.',
    );
  }
  if (needsIntegrationNodes.length > 0) {
    lines.push(
      `Needs-integration WorkGraph nodes (${String(needsIntegrationNodes.length)}): ${needsIntegrationNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${needsIntegrationNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(
      'needs_integration blocks UpdateGoal(complete) — merge specialist handoffs and mark nodes done only after integration evidence.',
    );
  }
  if (pendingNodes.length > 0) {
    lines.push(
      `Pending WorkGraph nodes (${String(pendingNodes.length)}): ${pendingNodes
        .slice(0, 4)
        .map((node) => `${node.id}[${node.status}] ${node.title}`)
        .join(', ')}${pendingNodes.length > 4 ? ', …' : ''}`,
    );
  }
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

  const pendingNodes =
    run.workGraph?.nodes.filter(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    ) ?? [];
  const failedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'failed') ?? [];
  const needsIntegrationNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'needs_integration') ?? [];
  if (failedNodes.length > 0) {
    lines.push(
      `Failed WorkGraph nodes (${String(failedNodes.length)}): ${failedNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${failedNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(
      'Failed nodes block UpdateGoal(complete) — repair, re-verify, or cancel only after deliberate scope drop.',
    );
  }
  if (needsIntegrationNodes.length > 0) {
    lines.push(
      `Needs-integration WorkGraph nodes (${String(needsIntegrationNodes.length)}): ${needsIntegrationNodes
        .slice(0, 4)
        .map((node) => `${node.id} ${node.title}`)
        .join(', ')}${needsIntegrationNodes.length > 4 ? ', …' : ''}`,
    );
    lines.push(
      'needs_integration blocks UpdateGoal(complete) — merge specialist handoffs and mark nodes done only after integration evidence.',
    );
  }
  if (pendingNodes.length > 0) {
    lines.push(
      `Pending WorkGraph nodes (${String(pendingNodes.length)}): ${pendingNodes
        .slice(0, 4)
        .map((node) => `${node.id}[${node.status}] ${node.title}`)
        .join(', ')}${pendingNodes.length > 4 ? ', …' : ''}`,
    );
  }

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
