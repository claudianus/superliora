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
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import type { UltraworkActivation, UltraworkPlanRecoveryContext, UltraworkRecoveryReport, UltraworkResumeCursor } from './types';

export interface ReconcileUltraworkRunResult {
  readonly run: UltraworkRun;
  readonly workGraph?: WorkGraph;
  readonly teamPlan?: TeamPlan;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
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

  const reconciledRun: UltraworkRun = {
    ...run,
    status: 'running',
    workGraph: workGraph ?? run.workGraph,
    teamPlan: teamPlan ?? run.teamPlan,
    updatedAt: new Date().toISOString(),
  };

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
  const pendingNodes = run.workGraph?.nodes.filter((node) => node.status !== 'done') ?? [];
  const nextNode = pendingNodes.find((node) => node.status === 'queued' || node.status === 'blocked');
  const goal = agent.goal.getGoal().goal;
  return {
    stage: run.stage,
    planPhase: planContext?.phase,
    interviewRound: planContext?.interviewRoundCount,
    workGraphNodeId: nextNode?.id,
    goalStatus: goal?.status,
  };
}

export function buildUltraworkRecoveryReport(input: {
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
  readonly planContext?: UltraworkPlanRecoveryContext;
  readonly resumeCursor?: UltraworkResumeCursor;
}): UltraworkRecoveryReport {
  return {
    run: input.run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    orphanedWorkNodes: input.orphanedWorkNodes,
    orphanedExperts: input.orphanedExperts,
    lostBackgroundTasks: input.lostBackgroundTasks,
    nextActions: suggestNextActions(
      input.run,
      input.interruptReason,
      input.planContext,
      input.resumeCursor,
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
    'Resume the interrupted Ultrawork run from the last durable checkpoint. Do not restart from scratch unless the checkpoint is unusable.',
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
    lines.push('Do not create a new plan file or restart EnterPlanMode.');
  }
  if (planContext?.phase !== undefined) {
    lines.push(`UltraPlan phase: ${planContext.phase}`);
  }
  if (planContext?.interviewRoundCount !== undefined && planContext.interviewRoundCount > 0) {
    lines.push(`Interview rounds completed: ${String(planContext.interviewRoundCount)}`);
    lines.push('Do not restart the UltraPlan interview from round 1.');
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
  if (report.run.workGraph !== undefined && report.run.workGraph.nodes.length > 0) {
    const pending = report.run.workGraph.nodes.filter((node) => node.status !== 'done');
    lines.push(`Pending WorkGraph nodes (${String(pending.length)}):`);
    for (const node of pending.slice(0, 12)) {
      lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
    }
  }
  if (report.orphanedWorkNodes.length > 0) {
    lines.push(`Reconcile orphaned work nodes: ${report.orphanedWorkNodes.join(', ')}`);
  }
  if (report.orphanedExperts.length > 0) {
    lines.push(`Reconcile orphaned experts: ${report.orphanedExperts.join(', ')}`);
  }
  if (report.lostBackgroundTasks.length > 0) {
    lines.push(`Lost/failed background tasks: ${report.lostBackgroundTasks.join(', ')}`);
  }

  lines.push('Next actions:');
  for (const action of report.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push('Continue from the current stage, refresh evidence as needed, and keep the WorkGraph ledger current.');
  lines.push('</ultrawork_recovery>');
  return lines.join('\n');
}

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
  if (run === null || run.status !== 'running') return;
  if (run.stage === 'goal') {
    maybeAdvanceUltraworkStage(agent, 'integrate', 'UltraGoal completed');
  }
}

export function maybeFinishUltraworkRun(agent: Agent): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status !== 'running' || run.stage !== 'learn') return;
  const graph = run.workGraph;
  if (graph !== undefined && graph.nodes.length > 0 && !graph.nodes.every((node) => node.status === 'done')) {
    return;
  }
  ultrawork.completeLearnStage();
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

function suggestNextActions(
  run: UltraworkRun,
  interruptReason?: string,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
): string[] {
  const actions: string[] = [];
  if (interruptReason !== undefined) {
    actions.push(`Acknowledge the interruption (${interruptReason}) and restate the remaining objective.`);
  }

  const planPhase = planContext?.phase ?? resumeCursor?.planPhase;
  if (run.stage === 'plan' || run.stage === 'research') {
    switch (planPhase) {
      case 'research':
        actions.push('Refresh the evidence pack with current sources before asking blocking questions.');
        break;
      case 'interview': {
        const round = planContext?.interviewRoundCount ?? resumeCursor?.interviewRound ?? 0;
        actions.push(
          round > 0
            ? `Continue the UltraPlan interview from round ${String(round + 1)}; do not restart discovery.`
            : 'Continue the UltraPlan interview from the current evidence pack.',
        );
        break;
      }
      case 'design':
        actions.push('Resume design exploration and map coverage lanes before Review.');
        break;
      case 'review':
        actions.push('Re-verify the plan against code and sources, then advance to Write when ready.');
        break;
      case 'write':
        actions.push('Resume writing the approved plan sections; do not reopen a fresh interview.');
        break;
      case 'exit':
        actions.push('Call ExitPlanMode only after the plan file still satisfies the Seed Spec gate.');
        break;
      default:
        actions.push('Re-open the active Ultra Plan file and continue the interview or plan gate.');
        break;
    }
  } else {
    switch (run.stage) {
      case 'intake':
        actions.push('Re-open the active Ultra Plan file and continue the interview or plan gate.');
        break;
      case 'goal':
        actions.push('Verify the UltraGoal contract and resume autonomous pursuit.');
        break;
      case 'staff':
      case 'swarm':
        actions.push('Reconcile Swarm staffing, rerun UltraSwarm only if ENGAGE is still required.');
        break;
      case 'integrate':
        actions.push('Merge specialist output and resolve conflicts before more product edits.');
        break;
      case 'verify':
        actions.push('Re-run mechanical checks and capture runtime evidence for open acceptance criteria.');
        break;
      case 'learn':
        actions.push('Update the knowledge persistence ledger and promote only verified findings.');
        break;
      case 'done':
        actions.push('Confirm completion criteria and close the run.');
        break;
    }
  }

  const pendingNodes = run.workGraph?.nodes.filter((node) => node.status !== 'done') ?? [];
  if (pendingNodes.length > 0) {
    const nextNode = pendingNodes.find((node) => node.status === 'queued' || node.status === 'blocked');
    if (nextNode !== undefined) {
      actions.push(`Pick up WorkGraph node ${nextNode.id}: ${nextNode.title}.`);
    }
  }

  return actions.slice(0, 3);
}
