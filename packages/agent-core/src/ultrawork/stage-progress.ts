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

/**
 * Identify potentially stuck nodes: nodes in 'running' or 'blocked' status
 * that may indicate a stalled workflow. Used by recovery prompts and telemetry
 * to surface work that needs attention or circuit-breaking.
 */
export function detectStuckWorkGraphNodes(
  workGraph: WorkGraph | undefined,
): readonly WorkGraphNode[] {
  if (workGraph === undefined) return [];
  return workGraph.nodes.filter(
    (node) => node.status === 'running' || node.status === 'blocked',
  );
}

/**
 * Default stage duration thresholds (ms). Stages exceeding these are flagged
 * as potentially stuck. Based on the "un-bounded loops" anti-pattern (S0):
 * every stage needs a wall-clock bound to prevent runaway cost.
 */
const STAGE_DURATION_THRESHOLDS_MS: Readonly<Record<UltraworkStage, number>> = {
  intake: 5 * 60_000, // 5 min
  plan: 15 * 60_000, // 15 min
  research: 10 * 60_000, // 10 min
  goal: 5 * 60_000, // 5 min
  staff: 5 * 60_000, // 5 min
  swarm: 30 * 60_000, // 30 min
  integrate: 15 * 60_000, // 15 min
  verify: 10 * 60_000, // 10 min
  learn: 5 * 60_000, // 5 min
  done: Number.POSITIVE_INFINITY, // terminal, no threshold
};

export interface LongRunningStageInfo {
  readonly stage: UltraworkStage;
  readonly elapsedMs: number;
  readonly thresholdMs: number;
}

/**
 * Detect if the current stage has been running longer than its expected
 * threshold. Returns info about the long-running stage, or undefined if
 * the stage is within bounds or duration cannot be determined.
 */
export function detectLongRunningStage(
  run: UltraworkRun,
): LongRunningStageInfo | undefined {
  const stage = run.stage;
  if (stage === 'done') return undefined;
  const thresholdMs = STAGE_DURATION_THRESHOLDS_MS[stage];
  if (!Number.isFinite(thresholdMs)) return undefined;

  // Find when the current stage was entered from stageHistory.
  const history = run.stageHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry !== undefined && entry.stage === stage) {
      const enteredAt = Date.parse(entry.enteredAt);
      if (!Number.isFinite(enteredAt)) return undefined;
      const elapsedMs = Date.now() - enteredAt;
      if (elapsedMs > thresholdMs) {
        return { stage, elapsedMs, thresholdMs };
      }
      return undefined;
    }
  }
  return undefined;
}

function stageIndex(stage: UltraworkStage): number {
  return ultraworkStageIndex(stage);
}
