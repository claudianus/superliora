import type { UltraworkRun, UltraworkStage, WorkGraph, WorkGraphNode } from '@superliora/protocol';

import { ULTRAWORK_STAGE_ORDER } from './state';

const STAGE_INDEX = new Map<UltraworkStage, number>(
  ULTRAWORK_STAGE_ORDER.map((stage, index) => [stage, index]),
);

export interface WorkGraphProgressSummary {
  readonly doneCount: number;
  readonly pendingCount: number;
  readonly inProgressNodes: readonly WorkGraphNode[];
  readonly nextPendingNode?: WorkGraphNode;
  readonly inferredStage?: UltraworkStage;
}

export function maxUltraworkStage(
  left: UltraworkStage,
  right: UltraworkStage,
): UltraworkStage {
  return stageIndex(left) >= stageIndex(right) ? left : right;
}

export function inferEffectiveUltraworkStage(
  storedStage: UltraworkStage,
  workGraph: WorkGraph | undefined,
): UltraworkStage {
  const summary = summarizeWorkGraphProgress(workGraph);
  if (summary.inferredStage === undefined) return storedStage;
  // Block false completion: never auto-jump to learn/done from the graph.
  // verify is allowed only while open work remains at that stage (resume).
  const capped = capAutoPromotedStage(summary.inferredStage, summary, workGraph);
  return maxUltraworkStage(storedStage, capped);
}

export function summarizeWorkGraphProgress(
  workGraph: WorkGraph | undefined,
): WorkGraphProgressSummary {
  if (workGraph === undefined || workGraph.nodes.length === 0) {
    return { doneCount: 0, pendingCount: 0, inProgressNodes: [] };
  }

  const doneCount = workGraph.nodes.filter((node) => node.status === 'done').length;
  const pendingNodes = workGraph.nodes.filter((node) => !isTerminalWorkNodeStatus(node.status));
  const inProgressNodes = workGraph.nodes.filter(
    (node) =>
      node.status === 'running' ||
      node.status === 'blocked' ||
      node.status === 'needs_integration',
  );
  const nextPendingNode = pendingNodes.find(
    (node) =>
      node.status === 'queued' ||
      node.status === 'blocked' ||
      node.status === 'running' ||
      node.status === 'needs_integration',
  );
  const stageSource =
    pendingNodes.length > 0
      ? pendingNodes
      : workGraph.nodes.filter((node) => node.status === 'done');
  // If any node still needs main integration, do not treat the graph as fully
  // finished even when no other pending nodes remain.
  const needsIntegration = workGraph.nodes.some((node) => node.status === 'needs_integration');
  const rawInferred = maxStageFromNodes(stageSource);
  const inferredStage =
    needsIntegration && rawInferred !== undefined
      ? maxUltraworkStage(rawInferred, 'integrate')
      : rawInferred;

  return {
    doneCount,
    pendingCount: pendingNodes.length,
    inProgressNodes,
    nextPendingNode,
    inferredStage,
  };
}

function isTerminalWorkNodeStatus(status: WorkGraphNode['status']): boolean {
  return status === 'done' || status === 'failed';
}

function capAutoPromotedStage(
  stage: UltraworkStage,
  summary: WorkGraphProgressSummary,
  workGraph: WorkGraph | undefined,
): UltraworkStage {
  if (stage === 'learn' || stage === 'done') {
    return 'integrate';
  }
  if (stage === 'verify') {
    const hasOpenVerifyWork =
      workGraph?.nodes.some(
        (node) =>
          node.stage === 'verify' &&
          (node.status === 'queued' ||
            node.status === 'running' ||
            node.status === 'blocked' ||
            node.status === 'needs_integration'),
      ) === true;
    // All-done graphs must not auto-enter verify; main agent advances after checks.
    if (!hasOpenVerifyWork || summary.pendingCount === 0) {
      return 'integrate';
    }
  }
  return stage;
}

export function applyWorkGraphProgressToRun(run: UltraworkRun, workGraph?: WorkGraph): UltraworkRun {
  const graph = workGraph ?? run.workGraph;
  const stage = inferEffectiveUltraworkStage(run.stage, graph);
  if (stage === run.stage && graph === run.workGraph) return run;
  return {
    ...run,
    stage,
    workGraph: graph ?? run.workGraph,
    updatedAt: new Date().toISOString(),
  };
}

export function maybeSyncUltraworkStageFromWorkGraph(
  syncStageForward: (stage: UltraworkStage, reason?: string) => UltraworkRun,
  run: UltraworkRun,
  workGraph: WorkGraph | undefined,
): UltraworkRun {
  if (run.status !== 'running' || workGraph === undefined) return run;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, workGraph);
  if (effectiveStage === run.stage) return run;
  return syncStageForward(effectiveStage, 'Synced from WorkGraph progress');
}

function maxStageFromNodes(nodes: readonly WorkGraphNode[]): UltraworkStage | undefined {
  let best: UltraworkStage | undefined;
  for (const node of nodes) {
    if (best === undefined) {
      best = node.stage;
      continue;
    }
    best = maxUltraworkStage(best, node.stage);
  }
  return best;
}

export function ultraworkStageIndex(stage: UltraworkStage): number {
  const index = STAGE_INDEX.get(stage);
  if (index === undefined) throw new Error(`Unknown Ultrawork stage: ${stage}`);
  return index;
}

function stageIndex(stage: UltraworkStage): number {
  return ultraworkStageIndex(stage);
}
