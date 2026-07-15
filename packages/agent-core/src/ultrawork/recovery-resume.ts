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
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  return ultraworkStageIndex(effectiveStage) <= ultraworkStageIndex('research');
}

export function shouldSkipInterviewOnUltraworkResume(
  agent: Agent,
  run: UltraworkRun,
  planContext?: UltraworkPlanRecoveryContext,
): boolean {
  const planMode = agent.planMode;
  if (!planMode.isActive || !planMode.isUltraMode) return false;

  const phase = (planContext?.phase ?? planMode.phase) as UltraPlanPhase;
  const interviewRounds = planContext?.interviewRoundCount ?? planMode.interviewRoundCount;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const progress = summarizeWorkGraphProgress(run.workGraph);
  const goal = agent.goal.getGoal().goal;

  if (phase === 'design' || phase === 'review' || phase === 'write' || phase === 'exit') return true;
  if (interviewRounds > 0) return true;
  if (progress.doneCount > 0 || progress.pendingCount > 0) return true;
  if (goal !== null) return true;
  if (ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('plan')) return true;
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
  if (planMode.isActive && planMode.isUltraMode) {
    const phase = (planContext?.phase ?? planMode.phase) as UltraPlanPhase;
    if (phase === 'research' || phase === 'interview') {
      planMode.setPhase('design');
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
      : planContext;

  return {
    run: agent.ultrawork.getRun() ?? promotedRun,
    planContext: updatedPlanContext,
    skippedInterview: true,
  };
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

