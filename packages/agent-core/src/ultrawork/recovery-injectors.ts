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
import { formatContinuityOperatorNote } from '../agent/context-os';

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
  } catch {
    // Stage transitions are best-effort; do not fail the caller.
  }
}

export function maybeAdvanceUltraworkOnGoalComplete(agent: Agent): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status === 'done' || run.status === 'failed') return;
  maybeFinishUltraworkRun(agent);
  const updated = ultrawork.getRun();
  if (updated !== null && updated.status !== 'done' && updated.status !== 'failed') {
    try {
      ultrawork.completeLearnStage('UltraGoal completed');
    } catch (error) {
      agent.log.warn('ultrawork goal-complete finish failed', { error });
    }
  }
}

export function injectUltraworkPostSwarmContinuation(agent: Agent): void {
  const run = agent.ultrawork?.getRun();
  if (run === null || run === undefined || run.status !== 'running') return;
  if (run.stage !== 'integrate') return;
  agent.context.appendSystemReminder(
    [
      '<ultrawork_post_swarm>',
      'UltraSwarm finished. Continue this Ultrawork run in order:',
      '1. Integrate — merge specialist output, resolve conflicts, pick an integration owner before more product edits.',
      '2. Verify — mechanical + real-surface checks for acceptance criteria.',
      '3. Learn — persist only verified durable findings to Liora Recall or LLM Wiki.',
      'Do not call UltraSwarm again unless revision gaps truly require another specialist wave.',
      '</ultrawork_post_swarm>',
    ].join('\n'),
    { kind: 'injection', variant: 'ultrawork_post_swarm' },
  );
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

  const lines = [
    '<ultrawork_post_compaction>',
    'Context compacted during active Ultrawork. Continue from the durable checkpoint — do not restart UltraPlan/UltraResearch or open a new Ultrawork run.',
    `Run: ${run.id} · stage=${run.stage}`,
  ];
  if (effectiveStage !== run.stage) {
    lines.push(`Effective stage: ${effectiveStage}`);
  }
  if (resumeCursor.workGraphNodeId !== undefined) {
    lines.push(`Resume node: ${resumeCursor.workGraphNodeId}`);
  }

  const continuityNote = formatContinuityOperatorNote(agent.contextOS.health());
  if (continuityNote !== undefined) {
    lines.push(continuityNote);
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
      return 'Re-run mechanical checks and capture runtime evidence for open AC. Prefer deterministic proof over claimed success.';
    case 'learn':
      return 'Promote only verified findings to Liora Recall or LLM Wiki.';
    default:
      return undefined;
  }
}

export { maybeFinishUltraworkRun } from './finish-run';
