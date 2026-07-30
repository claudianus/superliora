import type { WorkGraph, WorkGraphNode } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import { applyEvidenceHardGate } from '../../../collaboration/swarm-evidence-gate';
import {
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  rebindPhaseWorkNodeIds,
  SWARM_DAG_TERMINAL_STATUSES,
} from '../../../collaboration/swarm-dag-scheduler';
import { maybeFinishUltraworkRun } from '../../../ultrawork';
import type { ToolStore } from '../../store';
import { TODO_STORE_KEY } from '../state/todo-list';
import {
  ULTRAWORK_GRAPH_STORE_KEY,
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../state/ultrawork-graph';
import { cloneWorkGraphNode, uniqueStrings } from './ultra-swarm-helpers';
import {
  ownerExpertIdForWorkNodes,
  ownerResultForWorkNodes,
  workNodeOutcome,
  type UltraSwarmPhase,
  type UltraSwarmRenderedResult,
  type UltraSwarmSpec,
} from './ultra-swarm-phase';
import type { UltraSwarmToolInput } from './ultra-swarm-schema';

/**
 * Owns the UltraworkGraph work-node lifecycle side effects for UltraSwarm:
 * resolving bound nodes, marking them running/done/failed/cancelled, and
 * rebinding phase specs to the live DAG ready-set. Extracted from
 * `UltraSwarmTool` as a pure delegate — same `store`/`agent` dependencies,
 * no behavior change.
 */
export class UltraSwarmWorkNodeCoordinator {
  constructor(
    private readonly store: ToolStore,
    private readonly agent: Agent,
  ) {}

  resolveWorkNodeContext(
    args: UltraSwarmToolInput,
  ): { readonly graph: WorkGraph; readonly nodes: readonly WorkGraphNode[] } | undefined {
    const ids = uniqueStrings(args.work_node_ids ?? []);
    if (ids.length === 0) return undefined;
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) {
      throw new Error(
        'UltraSwarm work_node_ids requires an existing UltraworkGraph. Approved Ultra Plans seed the graph on ExitPlanMode; otherwise call UltraworkGraph first or omit work_node_ids.',
      );
    }
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const nodes = ids.map((id) => {
      const node = nodeById.get(id);
      if (node === undefined) {
        const knownIds = graph.nodes.map((entry) => entry.id).join(', ');
        throw new Error(
          `UltraSwarm work_node_ids includes missing node ${id}. Known node ids: ${knownIds.length === 0 ? 'none' : knownIds}.`,
        );
      }
      return node;
    });
    return { graph: cloneWorkGraph(graph), nodes: nodes.map(cloneWorkGraphNode) };
  }

  markWorkNodesRunning(nodeIds: readonly string[], ownerExpertId: string | undefined): void {
    this.updateWorkNodes(nodeIds, (node) => ({
      ...node,
      status: 'running',
      ownerExpertId: node.ownerExpertId ?? ownerExpertId,
    }));
  }

  /**
   * After a phase completes, mark claimed work nodes done/failed so the DAG
   * ready-set advances for subsequent phases.
   */
  finishPhaseClaimedWorkNodes(
    results: readonly UltraSwarmRenderedResult[],
  ): void {
    const claimed = new Set<string>();
    for (const result of results) {
      if (result.spec.workNodeIds.length === 0) continue;
      this.finishWorkNodes(result.spec.workNodeIds, [result]);
      for (const id of result.spec.workNodeIds) claimed.add(id);
    }
    if (claimed.size > 0) {
      this.agent.telemetry.track('ultra_swarm_dag_phase_finish', {
        finished_count: claimed.size,
        finished_ids: [...claimed].slice(0, 32).join(','),
      });
    }
  }

  /**
   * Rebind phase specs to currently ready WorkGraph nodes (live store).
   * Specs that already hold ready/running ids keep them; empty/blocked specs
   * pick up newly unlocked ready nodes so phase runners do not starve.
   * Pure assignment lives in `rebindPhaseWorkNodeIds`; this method adds
   * telemetry and mark-running side effects.
   */
  rebindPhaseSpecsToLiveReadyNodes(
    phaseSpecs: readonly UltraSwarmSpec[],
    boundWorkNodeIds: readonly string[],
    runId: string,
  ): UltraSwarmSpec[] {
    if (phaseSpecs.length === 0 || boundWorkNodeIds.length === 0) {
      return [...phaseSpecs];
    }
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return [...phaseSpecs];

    const dagNodes = graph.nodes.map((node) => ({
      id: node.id,
      dependsOn: node.dependsOn,
      status: node.status,
    }));
    const partition = partitionReadyWorkNodeIds(
      dagNodes.filter((node) => boundWorkNodeIds.includes(node.id)),
    );
    this.agent.telemetry.track('ultra_swarm_dag_phase_ready', {
      run_id: runId,
      ready_count: partition.readyIds.length,
      blocked_count: partition.blockedIds.length,
      ready_ids: partition.readyIds.slice(0, 32).join(','),
    });

    const rebound = rebindPhaseWorkNodeIds(phaseSpecs, boundWorkNodeIds, dagNodes);
    const readyIds = preferReadyWorkNodeIds(boundWorkNodeIds, dagNodes);
    if (readyIds.length === 0) return rebound;

    const newlyRunning = uniqueStrings(rebound.flatMap((spec) => spec.workNodeIds)).filter(
      (id) => {
        const node = graph.nodes.find((n) => n.id === id);
        return (
          node !== undefined &&
          node.status !== 'running' &&
          !SWARM_DAG_TERMINAL_STATUSES.has(node.status)
        );
      },
    );
    if (newlyRunning.length > 0) {
      this.markWorkNodesRunning(newlyRunning, ownerExpertIdForWorkNodes(rebound));
    }
    return rebound;
  }

  finishWorkNodes(
    nodeIds: readonly string[],
    results: readonly UltraSwarmRenderedResult[],
  ): void {
    const outcome = workNodeOutcome(results);
    const owner = ownerResultForWorkNodes(results);
    // Skip already-terminal nodes so multi-phase finish is idempotent.
    // needs_integration / cancelled / failed / blocked count as terminal too.
    this.updateWorkNodes(nodeIds, (node) => {
      if (SWARM_DAG_TERMINAL_STATUSES.has(node.status)) return node;
      return {
        ...node,
        ownerExpertId: node.ownerExpertId ?? owner?.spec.expertId,
        ownerAgentId: node.ownerAgentId ?? owner?.agentId,
        status: outcome.status,
        evidenceIds: uniqueStrings([...(node.evidenceIds ?? []), ...outcome.evidenceIds]),
        verificationStatus: outcome.verificationStatus,
        verificationSummary: outcome.summary,
      };
    });
  }

  failWorkNodes(nodeIds: readonly string[], error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.updateWorkNodes(nodeIds, (node) => ({
      ...node,
      status: 'failed',
      verificationStatus: 'failed',
      verificationSummary: `UltraSwarm failed before returning node evidence: ${message}`,
    }));
  }

  /**
   * Budget governor hard kill: abort the linked phase controller (cancels
   * in-flight/remaining subagents that share its signal) and mark non-terminal
   * bound work nodes cancelled with a visible verificationSummary reason.
   */
  applyBudgetKill(input: {
    readonly phaseController: AbortController;
    readonly runId: string;
    readonly phase: UltraSwarmPhase;
    readonly reason: string;
    readonly boundWorkNodeIds: readonly string[];
  }): void {
    if (!input.phaseController.signal.aborted) {
      input.phaseController.abort(new Error(input.reason));
    }

    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    const candidateIds =
      input.boundWorkNodeIds.length > 0
        ? input.boundWorkNodeIds
        : (graph?.nodes.map((node) => node.id) ?? []);
    const openIds = candidateIds.filter((id) => {
      const node = graph?.nodes.find((entry) => entry.id === id);
      if (node === undefined) return false;
      // running is never terminal; also cancel queued/ready open work.
      return node.status === 'running' || !SWARM_DAG_TERMINAL_STATUSES.has(node.status);
    });
    if (openIds.length > 0) {
      this.updateWorkNodes(openIds, (node) => {
        if (node.status !== 'running' && SWARM_DAG_TERMINAL_STATUSES.has(node.status)) {
          return node;
        }
        return {
          ...node,
          status: 'cancelled',
          verificationStatus: 'failed',
          verificationSummary: `Budget kill (${input.phase}): ${input.reason}`,
        };
      });
    }
    this.agent.emitEvent({
      type: 'ultrawork.swarm.paused',
      runId: input.runId,
      reason: `Budget kill: ${input.reason}`,
      phase: input.phase,
    } as any);
  }

  private updateWorkNodes(
    nodeIds: readonly string[],
    update: (node: WorkGraphNode) => WorkGraphNode,
  ): void {
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return;
    const targetIds = new Set(nodeIds);
    const mapped = graph.nodes.map((node) =>
      targetIds.has(node.id) ? update(cloneWorkGraphNode(node)) : node,
    );
    // Same hard gate as UltraworkGraph tool path — UltraSwarm must not be a
    // privileged done mutator that bypasses requiredEvidence checks.
    const gated = applyEvidenceHardGate(mapped);
    if (gated.violations.length > 0) {
      this.agent.telemetry.track('evidence_gate_violations', {
        run_id: graph.runId,
        source: 'ultra_swarm_update_work_nodes',
        violations: gated.violations.length,
        node_ids: gated.violations.map((v) => v.nodeId).slice(0, 32).join(','),
      });
    }
    const next = cloneWorkGraph({
      ...graph,
      updatedAt: new Date().toISOString(),
      nodes: gated.nodes,
    });
    this.store.set(ULTRAWORK_GRAPH_STORE_KEY, next);
    this.store.set(TODO_STORE_KEY, todosFromWorkGraph(next));
    for (const node of next.nodes) {
      if (!targetIds.has(node.id)) continue;
      this.agent.emitEvent({
        type: 'ultrawork.task.assigned',
        runId: next.runId,
        task: node,
      });
    }
    // Sync the updated graph into the run so its workGraph reflects the new
    // node statuses, then check whether the run (and its UltraGoal) should
    // finish. Without this, swarm-completed nodes never trigger the
    // run/goal termination path — the UltraworkGraph tool does this sync,
    // but updateWorkNodes is the path UltraSwarm uses, and it was missing.
    this.agent.ultrawork.syncWorkGraphFromStore();
    // Fire-and-forget: this method is sync; markComplete applies status
    // synchronously so the race window is minimal.
    void maybeFinishUltraworkRun(this.agent);
  }
}
