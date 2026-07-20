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

/**
 * Failure categories for WorkGraph nodes. Used to provide targeted
 * recovery guidance based on the type of failure encountered.
 */
export type WorkGraphFailureCategory =
  | 'timeout' // Operation exceeded time limit
  | 'validation' // Verification or quality check failed
  | 'dependency' // Blocked by upstream failure
  | 'resource' // Missing tools, files, or permissions
  | 'unknown'; // Unclassified failure

/**
 * Categorize a failed node based on its verificationSummary.
 * Enables targeted recovery guidance per failure type.
 */
export function categorizeNodeFailure(node: WorkGraphNode): WorkGraphFailureCategory {
  const summary = (node.verificationSummary ?? '').toLowerCase();
  if (/timeout|timed?\s*out|deadline|exceeded/.test(summary)) return 'timeout';
  if (/verif|check|test|assert|expect|quality|lint|type/.test(summary)) return 'validation';
  if (/depend|blocked|upstream|prerequisite|waiting/.test(summary)) return 'dependency';
  if (/permission|denied|missing|not found|unavailable|no such/.test(summary)) return 'resource';
  return 'unknown';
}

/**
 * Recovery guidance per failure category. Based on graceful degradation
 * patterns: different failure types need different recovery strategies.
 */
export const FAILURE_RECOVERY_GUIDANCE: Readonly<Record<WorkGraphFailureCategory, string>> = {
  timeout: 'Increase timeout or split into smaller subtasks; check for infinite loops.',
  validation: 'Review acceptance criteria; fix implementation or adjust test expectations.',
  dependency: 'Resolve upstream blockers first; consider re-queuing after dependencies complete.',
  resource: 'Verify tool availability, file paths, and permissions; check environment setup.',
  unknown: 'Inspect node details and logs; consider manual intervention or re-queuing.',
};

/**
 * Analyze failed nodes and return categorized failure info with guidance.
 */
export function analyzeFailedNodes(
  workGraph: WorkGraph | undefined,
): readonly { readonly node: WorkGraphNode; readonly category: WorkGraphFailureCategory; readonly guidance: string }[] {
  if (workGraph === undefined) return [];
  return workGraph.nodes
    .filter((node) => node.status === 'failed')
    .map((node) => {
      const category = categorizeNodeFailure(node);
      return { node, category, guidance: FAILURE_RECOVERY_GUIDANCE[category] };
    });
}

/**
 * Context pressure levels. Based on context engineering best practices (2026):
 * "context rot" — as tokens increase, model recall accuracy decreases.
 */
export type ContextPressureLevel = 'low' | 'moderate' | 'high' | 'critical';

/**
 * Context pressure thresholds (ratio of used context to max context).
 * Aligned with compaction trigger ratios in the compaction strategy.
 */
const CONTEXT_PRESSURE_THRESHOLDS: Readonly<Record<ContextPressureLevel, number>> = {
  low: 0.5, // Below 50% — plenty of room
  moderate: 0.7, // 50-70% — normal operating range
  high: 0.85, // 70-85% — approaching compaction trigger
  critical: 1.0, // Above 85% — compaction imminent or overdue
};

/**
 * Guidance per context pressure level. Helps the agent understand
 * when to be more conservative with context usage.
 */
export const CONTEXT_PRESSURE_GUIDANCE: Readonly<Record<ContextPressureLevel, string>> = {
  low: 'Context budget healthy; full tool output and detailed reasoning available.',
  moderate: 'Context usage moderate; prefer concise tool outputs and focused reasoning.',
  high: 'Context pressure high; truncate tool outputs, avoid verbose logging, consider compaction.',
  critical: 'Context critical; minimize all non-essential output, compaction likely needed immediately.',
};

/**
 * Assess context pressure level based on usage ratio.
 * Returns the pressure level and corresponding guidance.
 */
export function assessContextPressure(usageRatio: number): {
  readonly level: ContextPressureLevel;
  readonly guidance: string;
} {
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.low) {
    return { level: 'low', guidance: CONTEXT_PRESSURE_GUIDANCE.low };
  }
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.moderate) {
    return { level: 'moderate', guidance: CONTEXT_PRESSURE_GUIDANCE.moderate };
  }
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.high) {
    return { level: 'high', guidance: CONTEXT_PRESSURE_GUIDANCE.high };
  }
  return { level: 'critical', guidance: CONTEXT_PRESSURE_GUIDANCE.critical };
}

// ---------------------------------------------------------------------------
// Graduated recovery escalation (self-healing pattern)
// ---------------------------------------------------------------------------

export type RecoveryEscalationLevel = 'retry' | 'replan' | 'degrade' | 'abort';

const ESCALATION_THRESHOLDS: Readonly<Record<RecoveryEscalationLevel, number>> = {
  retry: 0, // First failure: simple retry
  replan: 2, // After 2 failures: re-plan approach
  degrade: 4, // After 4 failures: degrade scope
  abort: 6, // After 6 failures: consider aborting
};

export const ESCALATION_GUIDANCE: Readonly<Record<RecoveryEscalationLevel, string>> = {
  retry: 'Retry the failed operation with the same approach; transient errors often resolve on retry.',
  replan: 'Multiple failures detected; re-plan the approach — try a different strategy or break into smaller steps.',
  degrade: 'Persistent failures; consider degrading scope — skip non-critical subtasks or use fallback implementations.',
  abort: 'Repeated failures across multiple attempts; consider aborting this path and reporting to user for guidance.',
};

/**
 * Determine the appropriate recovery escalation level based on failure count.
 * Follows the "graduated remediation" pattern: start with low-risk actions,
 * escalate to more significant interventions as failures accumulate.
 */
export function assessRecoveryEscalation(failureCount: number): {
  readonly level: RecoveryEscalationLevel;
  readonly guidance: string;
} {
  if (failureCount >= ESCALATION_THRESHOLDS.abort) {
    return { level: 'abort', guidance: ESCALATION_GUIDANCE.abort };
  }
  if (failureCount >= ESCALATION_THRESHOLDS.degrade) {
    return { level: 'degrade', guidance: ESCALATION_GUIDANCE.degrade };
  }
  if (failureCount >= ESCALATION_THRESHOLDS.replan) {
    return { level: 'replan', guidance: ESCALATION_GUIDANCE.replan };
  }
  return { level: 'retry', guidance: ESCALATION_GUIDANCE.retry };
}
