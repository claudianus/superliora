import type { UltraworkRun } from '@superliora/protocol';
import type { UltraPlanPhase } from '../agent/plan/ultra-plan-mode';
import type { Agent } from '../agent';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import { resolveApprovedUltraworkPlanPath } from './approved-plan';
import { releaseUltraworkPlanModeIfComplete, shouldKeepPlanModeForUltraworkRun } from './recovery';
import { readUltraworkMirrorFromDisk } from './run-store';
import type { UltraworkPlanRecoveryContext, UltraworkRunMirror } from './types';

export function inferUltraPlanPhaseFromPlanContent(content: string): UltraPlanPhase | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;

  const hasExecutionPlan = /##\s*Execution Plan[\s\S]*\S/.test(trimmed);
  const hasWorkGraph = /##\s*WorkGraph[\s\S]*\S/.test(trimmed);
  const hasSwarmDecision = /Swarm decision:\s*(ENGAGE|ADAPTIVE|DEFER)/i.test(trimmed);
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

  // The wire-log journal (replayed into `current`) is the single source of
  // truth. The on-disk mirror is an acceleration/auxiliary copy, so it only
  // wins when it is genuinely ahead of the journal — measured by the durable
  // append-offset captured at checkpoint time. When the mirror carries no
  // offset (older schema-1 mirrors), fall back to the timestamp/graph/teamPlan
  // heuristics so the upgrade stays backward-compatible.
  const journalOffset = agent.records.recordCount();
  const mirrorOffset = mirror.journalOffset;
  const mirrorHasOffset = mirrorOffset !== undefined;

  const mirrorIsAheadByOffset = mirrorHasOffset && mirrorOffset > journalOffset;
  const mirrorUpdated = Date.parse(mirror.lastCheckpointAt || mirror.run.updatedAt);
  const recordUpdated = Date.parse(current.updatedAt);
  const mirrorIsNewer = mirrorUpdated > recordUpdated;
  const mirrorHasRicherGraph =
    (mirror.run.workGraph?.nodes.length ?? 0) > (current.workGraph?.nodes.length ?? 0);
  const mirrorHasTeamPlan = mirror.run.teamPlan !== undefined && current.teamPlan === undefined;

  // With an offset, the journal is authoritative unless the mirror is strictly
  // ahead. Without an offset (legacy mirror), keep the heuristic so older
  // checkpoints still reconcile during the upgrade window.
  const shouldApply = mirrorHasOffset
    ? mirrorIsAheadByOffset
    : mirrorIsNewer || mirrorHasRicherGraph || mirrorHasTeamPlan;
  if (!shouldApply) return;

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
  const approvedPlanPath = await resolveApprovedUltraworkPlanPath(agent, [
    checkpoint.planFilePath,
    agent.ultraSwarmEngageGate.data()?.planPath,
    planMode.planFilePath ?? undefined,
  ]);
  if (approvedPlanPath !== undefined) {
    planMode.restorePlanFilePathQuiet(approvedPlanPath);
  }

  if (run !== null && run !== undefined && !shouldKeepPlanModeForUltraworkRun(run)) {
    releaseUltraworkPlanModeIfComplete(agent, run);
    return;
  }

  const recordRounds = planMode.interviewRoundCount;
  const engineRounds = planMode.ultraEngine.interviewState.rounds.length;
  const mirrorRounds = checkpoint.interviewRoundCount ?? 0;
  const needsMirror =
    mirrorRounds > recordRounds ||
    mirrorRounds > engineRounds ||
    (checkpoint.phase !== undefined &&
      checkpoint.phase !== planMode.phase &&
      recordRounds === 0 &&
      engineRounds === 0);

  if (!needsMirror || checkpoint.phase === undefined) return;

  const ultraPlan =
    checkpoint.ultraPlan ??
    planMode.captureStateCheckpoint()?.ultraPlan ??
    planMode.ultraEngine.serialize();

  planMode.restoreStateQuiet({
    phase: checkpoint.phase as UltraPlanPhase,
    interviewRoundCount: mirrorRounds,
    ultraPlan,
  });
}

/** @deprecated Use {@link reconcileUltraworkFromMirror} */
export async function reconcileUltraworkPlanAfterResume(agent: Agent): Promise<void> {
  await reconcileUltraworkFromMirror(agent);
}
