/**
 * Ultrawork resume policy, cursor, and run reconcile helpers.
 */

import type {
  TeamExpertAssignment,
  TeamPlan,
  UltraworkRun,
  UltraworkStage,
  WorkGraph,
  WorkGraphNode,
} from '@superliora/protocol';

import type { Agent } from '../agent';
import { isBackgroundTaskTerminal } from '../agent/background';
import { seedUltraworkGraphFromApprovedPlan } from '../agent/plan/work-graph-from-plan';
import type { UltraPlanPhase } from '../agent/plan/ultra-plan-mode';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import { resolveApprovedUltraworkPlanPath } from './approved-plan';
import { readUltraworkMirrorFromDisk } from './run-store';
import {
  applyWorkGraphProgressToRun,
  detectStuckWorkGraphNodes,
  inferEffectiveUltraworkStage,
  maxUltraworkStage,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from './stage-progress';
import type { UltraworkPlanRecoveryContext, UltraworkResumeCursor } from './types';

export interface ReconcileUltraworkRunResult {
  readonly run: UltraworkRun;
  readonly workGraph?: WorkGraph;
  readonly teamPlan?: TeamPlan;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
}

export function inferResumeStageFloor(run: UltraworkRun): UltraworkStage {
  let floor = run.stage;
  if (run.teamPlan !== undefined && run.teamPlan.experts.length > 0) {
    floor = maxUltraworkStage(floor, 'staff');
    floor = maxUltraworkStage(floor, 'swarm');
    floor = maxUltraworkStage(floor, 'integrate');
  }
  return floor;
}

export function shouldKeepPlanModeForUltraworkRun(run: UltraworkRun): boolean {
  if (run.teamPlan !== undefined && run.teamPlan.experts.length > 0) return false;
  const progress = summarizeWorkGraphProgress(run.workGraph);
  // Any WorkGraph progress means ExitPlanMode already happened (or graph was
  // seeded from an approved plan). Staying in Ultra Plan would trap resume in
  // Design/Review/Write tool locks instead of continuing product work.
  if (progress.doneCount > 0 || progress.pendingCount > 0) return false;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  return ultraworkStageIndex(effectiveStage) <= ultraworkStageIndex('research');
}

export function shouldSkipInterviewOnUltraworkResume(
  agent: Agent,
  run: UltraworkRun,
  planContext?: UltraworkPlanRecoveryContext,
): boolean {
  const planMode = agent.planMode;
  const phase = (planContext?.phase ?? (planMode.isActive ? planMode.phase : undefined)) as
    | UltraPlanPhase
    | undefined;
  const interviewRounds =
    planContext?.interviewRoundCount ?? (planMode.isActive ? planMode.interviewRoundCount : 0);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const progress = summarizeWorkGraphProgress(run.workGraph);
  const goal = agent.goal.getGoal().goal;

  // Execution evidence means interview is done regardless of plan-mode liveness.
  // (Plan mode may already have been released by releaseUltraworkPlanModeIfComplete.)
  if (progress.doneCount > 0 || progress.pendingCount > 0) return true;
  if (goal !== null) return true;
  if (ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('plan')) return true;
  if (run.teamPlan !== undefined && run.teamPlan.experts.length > 0) return true;

  // Still in planning — only skip interview when ultra plan mode is active and
  // the phase/rounds show interview is no longer the right entry point.
  if (!planMode.isActive || !planMode.isUltraMode) return false;
  if (phase === 'design' || phase === 'review' || phase === 'write' || phase === 'exit') return true;
  if (interviewRounds > 0) return true;
  if (phase === 'interview') return true;
  return false;
}

export function applyUltraworkResumeSkipInterview(
  agent: Agent,
  run: UltraworkRun,
  planContext?: UltraworkPlanRecoveryContext,
): {
  readonly run: UltraworkRun;
  readonly planContext?: UltraworkPlanRecoveryContext;
  readonly skippedInterview: boolean;
} {
  if (!shouldSkipInterviewOnUltraworkResume(agent, run, planContext)) {
    return { run, planContext, skippedInterview: false };
  }

  const planMode = agent.planMode;
  const currentPhase = (planContext?.phase ?? (planMode.isActive ? planMode.phase : undefined)) as
    | UltraPlanPhase
    | undefined;
  const progress = summarizeWorkGraphProgress(run.workGraph);
  const goal = agent.goal.getGoal().goal;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const executionStarted =
    progress.doneCount > 0 ||
    progress.pendingCount > 0 ||
    goal !== null ||
    ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('research') ||
    (run.teamPlan !== undefined && run.teamPlan.experts.length > 0);

  // Once execution (or a goal) has started, plan mode is a trap — release it
  // instead of parking the agent in Design with read-only tool locks.
  if (executionStarted) {
    const promotedRun = promoteUltraworkRunStageForResume(run);
    if (planMode.isActive && planMode.isUltraMode) {
      planMode.exit();
    }
    return {
      run: agent.ultrawork.getRun() ?? promotedRun,
      planContext: undefined,
      skippedInterview: true,
    };
  }

  if (planMode.isActive && planMode.isUltraMode) {
    // Preserve an already-advanced phase. Only lift research/interview forward
    // when we still need planning, and never regress design/review/write/exit.
    const restoredPhase = resolveResumePlanPhase(currentPhase);
    if (restoredPhase !== undefined && restoredPhase !== planMode.phase) {
      planMode.setPhase(restoredPhase);
    }
  }

  const promotedRun = promoteUltraworkRunStageForResume(run);
  releaseUltraworkPlanModeIfComplete(agent, promotedRun);

  const updatedPlanContext =
    planMode.isActive && planMode.isUltraMode
      ? {
          planFilePath: planContext?.planFilePath ?? planMode.planFilePath ?? undefined,
          phase: planMode.phase,
          interviewRoundCount: planContext?.interviewRoundCount ?? planMode.interviewRoundCount,
          ultraPlan:
            planContext?.ultraPlan ??
            planMode.captureStateCheckpoint()?.ultraPlan ??
            planMode.ultraEngine.serialize(),
        }
      : undefined;

  return {
    run: agent.ultrawork.getRun() ?? promotedRun,
    planContext: updatedPlanContext,
    skippedInterview: true,
  };
}

/**
 * Pick the UltraPlan phase to restore on resume when interview should be skipped
 * but product execution has not started yet.
 *
 * - design/review/write/exit: keep as-is (never drop back to design from later phases)
 * - research/interview: advance to design so NextPhase is not blocked on interview gates
 * - unknown: leave undefined so the live phase is unchanged
 */
function resolveResumePlanPhase(phase: UltraPlanPhase | undefined): UltraPlanPhase | undefined {
  if (phase === undefined) return 'design';
  if (phase === 'research' || phase === 'interview') return 'design';
  return phase;
}

export function releaseUltraworkPlanModeIfComplete(
  agent: Agent,
  run: UltraworkRun | null = agent.ultrawork.getRun(),
): boolean {
  if (run === null) return false;
  if (!agent.planMode.isActive || !agent.planMode.isUltraMode) return false;
  if (shouldKeepPlanModeForUltraworkRun(run)) return false;
  agent.planMode.exit();
  return true;
}

export function promoteUltraworkRunStageForResume(run: UltraworkRun): UltraworkRun {
  const fromGraph = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const floor = inferResumeStageFloor(run);
  const stage = maxUltraworkStage(fromGraph, floor);
  if (stage === run.stage && run.workGraph === run.workGraph) return run;
  return {
    ...run,
    stage,
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureWorkGraphForResume(
  agent: Agent,
  run: UltraworkRun,
  planFilePath?: string,
): Promise<WorkGraph | undefined> {
  const existing = agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
  if (existing !== undefined) return existing as WorkGraph;

  const mirror = readUltraworkMirrorFromDisk(agent.kaos.getcwd(), run.id);
  const resolvedPlanPath = await resolveApprovedUltraworkPlanPath(agent, [
    planFilePath,
    mirror?.planCheckpoint?.planFilePath,
    agent.ultraSwarmEngageGate.data()?.planPath,
    agent.planMode.planFilePath ?? undefined,
  ]);
  if (resolvedPlanPath === undefined) return undefined;

  try {
    const content = await agent.kaos.readText(resolvedPlanPath);
    const seeded = seedUltraworkGraphFromApprovedPlan(agent, content, resolvedPlanPath);
    if (!seeded.seeded) return undefined;
    return agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY) as WorkGraph | undefined;
  } catch {
    return undefined;
  }
}

export function reconcileUltraworkRunForResume(
  agent: Agent,
  run: UltraworkRun,
): ReconcileUltraworkRunResult {
  const storeGraph = agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
  const sourceGraph = storeGraph ?? run.workGraph;
  const orphanedWorkNodes = collectOrphanedWorkNodes(sourceGraph);
  const orphanedExperts = collectOrphanedExperts(run.teamPlan);
  const workGraph = reconcileWorkGraph(sourceGraph);
  const teamPlan = reconcileTeamPlan(run.teamPlan);
  const backgroundTasks = agent.background.list(false);
  const lostBackgroundTasks = backgroundTasks
    .filter((task) => isBackgroundTaskTerminal(task.status) && (task.status === 'lost' || task.status === 'failed'))
    .map((task) => task.taskId);

  const reconciledRun = promoteUltraworkRunStageForResume(
    applyWorkGraphProgressToRun(
      {
        ...run,
        status: 'running',
        workGraph: workGraph ?? run.workGraph,
        teamPlan: teamPlan ?? run.teamPlan,
        updatedAt: new Date().toISOString(),
      },
      workGraph,
    ),
  );

  agent.telemetry.track('ultrawork_resume', {
    run_id: run.id,
    stage: reconciledRun.stage,
    orphaned_nodes: orphanedWorkNodes.length,
    orphaned_experts: orphanedExperts.length,
    lost_tasks: lostBackgroundTasks.length,
    stuck_nodes: detectStuckWorkGraphNodes(workGraph ?? run.workGraph).length,
    run_age_ms: Date.now() - Date.parse(run.createdAt),
    resume_count: countResumeCycles(run),
  });

  return {
    run: reconciledRun,
    workGraph,
    teamPlan,
    orphanedWorkNodes,
    orphanedExperts,
    lostBackgroundTasks,
  };
}

export function buildUltraworkResumeCursor(
  agent: Agent,
  run: UltraworkRun,
  planContext?: UltraworkPlanRecoveryContext,
): UltraworkResumeCursor {
  const progress = summarizeWorkGraphProgress(run.workGraph);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const nextNode = progress.nextPendingNode;
  const goal = agent.goal.getGoal().goal;
  return {
    stage: effectiveStage,
    planPhase: planContext?.phase,
    interviewRound: planContext?.interviewRoundCount,
    workGraphNodeId: nextNode?.id,
    goalStatus: goal?.status,
    journalOffset: agent.records.recordCount(),
  };
}

function reconcileWorkGraph(graph: WorkGraph | undefined): WorkGraph | undefined {
  if (graph === undefined) return undefined;
  const nodes = graph.nodes.map(reconcileWorkGraphNode);
  return {
    ...graph,
    updatedAt: new Date().toISOString(),
    nodes,
  };
}

function reconcileWorkGraphNode(node: WorkGraphNode): WorkGraphNode {
  if (node.status !== 'running') return node;
  return {
    ...node,
    status: 'blocked',
    verificationSummary: node.verificationSummary ?? 'Recovered after interruption',
  };
}

function reconcileTeamPlan(teamPlan: TeamPlan | undefined): TeamPlan | undefined {
  if (teamPlan === undefined) return undefined;
  const experts = teamPlan.experts.map(reconcileExpert);
  return { ...teamPlan, experts };
}

function reconcileExpert(expert: TeamExpertAssignment): TeamExpertAssignment {
  if (expert.status !== 'running') return expert;
  return { ...expert, status: 'queued' };
}

function collectOrphanedWorkNodes(graph: WorkGraph | undefined): string[] {
  if (graph === undefined) return [];
  return graph.nodes.filter((node) => node.status === 'running').map((node) => node.id);
}

function collectOrphanedExperts(teamPlan: TeamPlan | undefined): string[] {
  if (teamPlan === undefined) return [];
  return teamPlan.experts.filter((expert) => expert.status === 'running').map((expert) => expert.id);
}

/**
 * Count blocked/failed entries in stageHistory as a proxy for resume cycles.
 * High values indicate oscillation (repeated crash-recovery loops).
 */
function countResumeCycles(run: UltraworkRun): number {
  const history = run.stageHistory ?? [];
  return history.filter((entry) => entry.reason !== undefined && /block|fail|interrupt|crash/i.test(entry.reason)).length;
}

