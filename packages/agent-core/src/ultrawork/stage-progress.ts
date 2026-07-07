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
  return maxUltraworkStage(storedStage, summary.inferredStage);
}

export function summarizeWorkGraphProgress(
  workGraph: WorkGraph | undefined,
): WorkGraphProgressSummary {
  if (workGraph === undefined || workGraph.nodes.length === 0) {
    return { doneCount: 0, pendingCount: 0, inProgressNodes: [] };
  }

  const doneCount = workGraph.nodes.filter((node) => node.status === 'done').length;
  const pendingNodes = workGraph.nodes.filter((node) => node.status !== 'done');
  const inProgressNodes = workGraph.nodes.filter(
    (node) => node.status === 'running' || node.status === 'blocked',
  );
  const nextPendingNode = pendingNodes.find(
    (node) => node.status === 'queued' || node.status === 'blocked' || node.status === 'running',
  );
  const stageSource =
    pendingNodes.length > 0
      ? pendingNodes
      : workGraph.nodes.filter((node) => node.status === 'done');
  const inferredStage = maxStageFromNodes(stageSource);

  return {
    doneCount,
    pendingCount: pendingNodes.length,
    inProgressNodes,
    nextPendingNode,
    inferredStage,
  };
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

function stageIndex(stage: UltraworkStage): number {
  const index = STAGE_INDEX.get(stage);
  if (index === undefined) throw new Error(`Unknown Ultrawork stage: ${stage}`);
  return index;
}
