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
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import type { UltraworkActivation, UltraworkPlanRecoveryContext, UltraworkRecoveryReport, UltraworkResumeCursor } from './types';
import type { UltraPlanPhase } from '../agent/plan/ultra-plan-mode';
import {
  applyWorkGraphProgressToRun,
  inferEffectiveUltraworkStage,
  maxUltraworkStage,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from './stage-progress';
import { readUltraworkMirrorFromDisk } from './run-store';
import { resolveApprovedUltraworkPlanPath } from './approved-plan';

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
  if (report.skippedInterview === true) {
    lines.push(
      'Resume policy: Skip UltraPlan interview on resume. Continue design, implementation, or verification from the saved checkpoint.',
    );
    lines.push(
      'Do not ask blocking interview questions unless a critical missing blocker prevents progress.',
    );
  }
  const progress = summarizeWorkGraphProgress(report.run.workGraph);
  if (progress.doneCount > 0 || progress.pendingCount > 0) {
    lines.push(
      `WorkGraph progress: ${String(progress.doneCount)} done, ${String(progress.pendingCount)} pending.`,
    );
    if (progress.inProgressNodes.length > 0) {
      for (const node of progress.inProgressNodes.slice(0, 6)) {
        lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
      }
    }
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
  if (run === null || run.status !== 'running') return;
  maybeFinishUltraworkRun(agent);
  const updated = ultrawork.getRun();
  if (updated !== null && updated.status === 'running') {
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
      '1. Integrate — merge specialist output, resolve conflicts, and pick an integration owner before more product edits.',
      '2. Verify — run mechanical checks and real surface checks for acceptance criteria.',
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
    'Context was compacted during an active Ultrawork run. Continue from the durable checkpoint — do not restart UltraPlan, UltraResearch, or open a new Ultrawork run.',
    `Run id: ${run.id}`,
    `Stage: ${run.stage}`,
  ];
  if (effectiveStage !== run.stage) {
    lines.push(`Effective stage: ${effectiveStage}`);
  }
  if (resumeCursor.workGraphNodeId !== undefined) {
    lines.push(`Resume node: ${resumeCursor.workGraphNodeId}`);
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

function capturePlanRecoveryContextFromAgent(agent: Agent): UltraworkPlanRecoveryContext | undefined {
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
    return 'UltraSwarm is active. Let the current wave finish; use integrate/verify after swarm completes.';
  }
  switch (stage) {
    case 'plan':
      return 'Continue the UltraPlan interview or plan gate from the saved checkpoint. Do not create a new plan file.';
    case 'research':
      return 'Refresh or extend the evidence pack as needed. Do not restart UltraResearch from scratch.';
    case 'staff':
    case 'swarm':
      return 'Reconcile team staffing and call UltraSwarm only when ENGAGE is still required.';
    case 'integrate':
      return 'Merge specialist output and resolve conflicts before more product edits.';
    case 'verify':
      return 'Re-run mechanical checks and capture runtime evidence for open acceptance criteria.';
    case 'learn':
      return 'Promote only verified findings to Liora Recall or LLM Wiki.';
    default:
      return undefined;
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
  skippedInterview = false,
): string[] {
  const actions: string[] = [];
  if (interruptReason !== undefined) {
    actions.push(`Acknowledge the interruption (${interruptReason}) and restate the remaining objective.`);
  }

  const progress = summarizeWorkGraphProgress(run.workGraph);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  if (
    progress.doneCount > 0 &&
    stageIndex(effectiveStage) > stageIndex('research') &&
    run.stage === 'research'
  ) {
    actions.push(
      'The WorkGraph shows completed work beyond the checkpoint stage. Continue implementation/verification from the current in-progress node; do not restart research.',
    );
  }
  if (progress.nextPendingNode !== undefined) {
    actions.push(
      `Resume WorkGraph node ${progress.nextPendingNode.id}: ${progress.nextPendingNode.title}.`,
    );
  }

  const planPhase = planContext?.phase ?? resumeCursor?.planPhase;
  if (skippedInterview) {
    if (progress.nextPendingNode !== undefined) {
      actions.push(
        `Continue implementation from WorkGraph node ${progress.nextPendingNode.id}; do not reopen UltraPlan interview.`,
      );
    } else if (planPhase === 'design' || planPhase === 'review' || planPhase === 'write') {
      actions.push(`Resume UltraPlan ${planPhase} and advance toward ExitPlanMode without new interview rounds.`);
    } else if (effectiveStage === 'goal' || effectiveStage === 'staff' || effectiveStage === 'swarm') {
      actions.push('Verify the UltraGoal contract and resume autonomous pursuit without interview questions.');
    } else if (
      effectiveStage === 'integrate' ||
      effectiveStage === 'verify' ||
      effectiveStage === 'learn'
    ) {
      actions.push(`Continue the ${effectiveStage} stage from the checkpoint; do not reopen UltraPlan interview.`);
    } else {
      actions.push('Continue design and implementation from the saved checkpoint; do not reopen UltraPlan interview.');
    }
  } else if (effectiveStage === 'plan' || effectiveStage === 'research') {
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
        actions.push(
          'Before the next AskUserQuestion, use read-only WebSearch, FetchURL, and codebase read tools when needed so options stay evidence-backed.',
        );
        actions.push(
          'Continue elevating the goal: teach brief insights and offer Baseline + Upgrade choices — not only gap-filling questions.',
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
    switch (effectiveStage) {
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

  return actions.slice(0, 4);
}

function stageIndex(stage: UltraworkStage): number {
  const order: readonly UltraworkStage[] = [
    'intake',
    'plan',
    'research',
    'goal',
    'staff',
    'swarm',
    'integrate',
    'verify',
    'learn',
    'done',
  ];
  const index = order.indexOf(stage);
  if (index < 0) throw new Error(`Unknown Ultrawork stage: ${stage}`);
  return index;
}
