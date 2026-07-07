import type { UltraworkRun } from '@superliora/protocol';
import type { UltraPlanPhase } from '../agent/plan/ultra-plan-mode';
import type { Agent } from '../agent';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import { resolveApprovedUltraworkPlanPath } from './approved-plan';
import { readUltraworkMirrorFromDisk } from './run-store';
import type { UltraworkPlanRecoveryContext, UltraworkRunMirror } from './types';

export function inferUltraPlanPhaseFromPlanContent(content: string): UltraPlanPhase | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;

  const hasExecutionPlan = /##\s*Execution Plan[\s\S]*\S/.test(trimmed);
  const hasWorkGraph = /##\s*WorkGraph[\s\S]*\S/.test(trimmed);
  const hasSwarmDecision = /Swarm decision:\s*(ENGAGE|DEFER)/i.test(trimmed);
  const hasSeedSpecBody =
    /Verifiable UltraGoal:\s*\S/.test(trimmed) &&
    /Acceptance Criteria:\s*\S/.test(trimmed) &&
    /Verification Plan:\s*\S/.test(trimmed);

  if (hasExecutionPlan && hasWorkGraph && hasSwarmDecision && hasSeedSpecBody) {
    return 'exit';
  }
  if (hasExecutionPlan || hasWorkGraph) return 'write';
  if (hasSeedSpecBody && hasSwarmDecision) return 'review';
  if (hasSeedSpecBody) return 'design';
  return undefined;
}

export async function reconcileUltraworkFromMirror(agent: Agent): Promise<void> {
  const run = agent.ultrawork.getRun();
  if (run === null) return;

  const mirror = readUltraworkMirrorFromDisk(agent.kaos.getcwd(), run.id);
  if (mirror === null) {
    await reconcileUltraworkPlanWithoutMirror(agent);
    return;
  }

  reconcileUltraworkRunFromMirror(agent, mirror);
  await reconcileUltraworkPlanFromMirror(agent, mirror);
}

async function reconcileUltraworkPlanWithoutMirror(agent: Agent): Promise<void> {
  const planMode = agent.planMode;
  if (!planMode.isActive || !planMode.isUltraMode) return;
  if (planMode.interviewRoundCount > 0 || planMode.ultraEngine.interviewState.rounds.length > 0) {
    return;
  }

  const planPath = planMode.planFilePath;
  if (planPath === null) return;
  let content = '';
  try {
    content = await agent.kaos.readText(planPath);
  } catch {
    return;
  }
  const inferred = inferUltraPlanPhaseFromPlanContent(content);
  if (inferred === undefined || inferred === planMode.phase) return;
  planMode.restoreStateQuiet({
    phase: inferred,
    interviewRoundCount: planMode.interviewRoundCount,
    ultraPlan: planMode.captureStateCheckpoint()?.ultraPlan ?? planMode.ultraEngine.serialize(),
  });
}

function reconcileUltraworkRunFromMirror(agent: Agent, mirror: UltraworkRunMirror): void {
  const current = agent.ultrawork.getRun();
  if (current === null) return;

  const mirrorUpdated = Date.parse(mirror.lastCheckpointAt || mirror.run.updatedAt);
  const recordUpdated = Date.parse(current.updatedAt);
  const mirrorIsNewer = mirrorUpdated > recordUpdated;
  const mirrorHasRicherGraph =
    (mirror.run.workGraph?.nodes.length ?? 0) > (current.workGraph?.nodes.length ?? 0);
  const mirrorHasTeamPlan = mirror.run.teamPlan !== undefined && current.teamPlan === undefined;

  if (!mirrorIsNewer && !mirrorHasRicherGraph && !mirrorHasTeamPlan) return;

  agent.ultrawork.applyMirrorRunQuiet({
    run: {
      ...mirror.run,
      status: current.status,
    },
    activation: mirror.activation,
    interruptReason: mirror.interruptReason ?? agent.ultrawork.getInterruptReason(),
  });

  const graph = mirror.run.workGraph;
  if (graph !== undefined) {
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, graph);
  }
}

async function reconcileUltraworkPlanFromMirror(agent: Agent, mirror: UltraworkRunMirror): Promise<void> {
  const planMode = agent.planMode;
  if (!planMode.isActive || !planMode.isUltraMode) return;
  if (mirror.planCheckpoint !== undefined) {
    await applyPlanCheckpointQuiet(
      agent,
      planMode,
      mirror.planCheckpoint,
      agent.ultrawork.getRun() ?? undefined,
    );
  }
}

async function applyPlanCheckpointQuiet(
  agent: Agent,
  planMode: Agent['planMode'],
  checkpoint: UltraworkPlanRecoveryContext,
  run?: UltraworkRun | null,
): Promise<void> {
  const hasStaffedTeam =
    run?.teamPlan !== undefined && (run.teamPlan.experts.length ?? 0) > 0;
  let resolvedCheckpoint =
    hasStaffedTeam && checkpoint.phase !== 'exit'
      ? { ...checkpoint, phase: 'exit' as const }
      : checkpoint;

  const approvedPlanPath = await resolveApprovedUltraworkPlanPath(agent, [
    resolvedCheckpoint.planFilePath,
    agent.ultraSwarmEngageGate.data()?.planPath,
    planMode.planFilePath ?? undefined,
  ]);
  if (approvedPlanPath !== undefined) {
    planMode.restorePlanFilePathQuiet(approvedPlanPath);
    resolvedCheckpoint = { ...resolvedCheckpoint, planFilePath: approvedPlanPath };
  }

  const recordRounds = planMode.interviewRoundCount;
  const engineRounds = planMode.ultraEngine.interviewState.rounds.length;
  const mirrorRounds = resolvedCheckpoint.interviewRoundCount ?? 0;
  const needsMirror =
    mirrorRounds > recordRounds ||
    mirrorRounds > engineRounds ||
    (resolvedCheckpoint.phase !== undefined &&
      resolvedCheckpoint.phase !== planMode.phase &&
      (recordRounds === 0 && engineRounds === 0 || hasStaffedTeam));

  if (!needsMirror || resolvedCheckpoint.phase === undefined) return;

  const ultraPlan =
    resolvedCheckpoint.ultraPlan ??
    planMode.captureStateCheckpoint()?.ultraPlan ??
    planMode.ultraEngine.serialize();

  planMode.restoreStateQuiet({
    phase: resolvedCheckpoint.phase as UltraPlanPhase,
    interviewRoundCount: mirrorRounds,
    ultraPlan,
  });
}

/** @deprecated Use {@link reconcileUltraworkFromMirror} */
export async function reconcileUltraworkPlanAfterResume(agent: Agent): Promise<void> {
  await reconcileUltraworkFromMirror(agent);
}
