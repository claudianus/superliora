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
import {
  fireTaskCompleted,
  fireTaskCreated,
  isTeamTaskCompletionStatus,
  publishTeamHookDecision,
} from '../../../session/team-hooks';
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

  async markWorkNodesRunning(
    nodeIds: readonly string[],
    ownerExpertId: string | undefined,
    teamName: string,
    signal: AbortSignal,
  ): Promise<{
    readonly claimedIds: readonly string[];
    readonly haltReason?: string;
    readonly blockedFeedbacks: readonly string[];
  }> {
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    const claimed: string[] = [];
    const blockedFeedbacks: string[] = [];
    for (const id of nodeIds) {
      const node = graph?.nodes.find((entry) => entry.id === id);
      const decision = await fireTaskCreated(this.agent.hooks, {
        taskId: id,
        taskSubject: node?.title ?? id,
        taskDescription: node?.verificationSummary,
        teammateName: ownerExpertId,
        teamName,
        signal,
      });
      publishTeamHookDecision(this.agent, 'TaskCreated', decision);
      if (decision.kind === 'halt') {
        return { claimedIds: claimed, haltReason: decision.reason, blockedFeedbacks };
      }
      if (decision.kind === 'block') {
        blockedFeedbacks.push(`[${id}] ${decision.feedback}`);
        this.agent.telemetry.track('ultra_swarm_task_created_blocked', {
          task_id: id,
          feedback: decision.feedback.slice(0, 240),
        });
        continue;
      }
      claimed.push(id);
    }
    if (claimed.length > 0) {
      this.updateWorkNodes(claimed, (node) => ({
        ...node,
        status: 'running',
        ownerExpertId: node.ownerExpertId ?? ownerExpertId,
      }));
    }
    return { claimedIds: claimed, blockedFeedbacks };
  }

  /**
   * After a phase completes, mark claimed work nodes done/failed so the DAG
   * ready-set advances for subsequent phases.
   */
  async finishPhaseClaimedWorkNodes(
    results: readonly UltraSwarmRenderedResult[],
    teamName: string,
    signal: AbortSignal,
  ): Promise<{ readonly haltReason?: string; readonly blockedFeedbacks: readonly string[] }> {
    const claimed = new Set<string>();
    const blockedFeedbacks: string[] = [];
    for (const result of results) {
      if (result.spec.workNodeIds.length === 0) continue;
      const finished = await this.finishWorkNodes(
        result.spec.workNodeIds,
        [result],
        teamName,
        signal,
      );
      if (finished.haltReason !== undefined) {
        return { haltReason: finished.haltReason, blockedFeedbacks };
      }
      blockedFeedbacks.push(...finished.blockedFeedbacks);
      for (const id of result.spec.workNodeIds) claimed.add(id);
    }
    if (claimed.size > 0) {
      this.agent.telemetry.track('ultra_swarm_dag_phase_finish', {
        finished_count: claimed.size,
        finished_ids: [...claimed].slice(0, 32).join(','),
      });
    }
    return { blockedFeedbacks };
  }

  /**
   * Rebind phase specs to currently ready WorkGraph nodes (live store).
   * Specs that already hold ready/running ids keep them; empty/blocked specs
   * pick up newly unlocked ready nodes so phase runners do not starve.
   * Pure assignment lives in `rebindPhaseWorkNodeIds`; this method adds
   * telemetry and mark-running side effects.
   */
  async rebindPhaseSpecsToLiveReadyNodes(
    phaseSpecs: readonly UltraSwarmSpec[],
    boundWorkNodeIds: readonly string[],
    runId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly specs: UltraSwarmSpec[];
    readonly haltReason?: string;
    readonly blockedFeedbacks: readonly string[];
  }> {
    if (phaseSpecs.length === 0 || boundWorkNodeIds.length === 0) {
      return { specs: [...phaseSpecs], blockedFeedbacks: [] };
    }
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return { specs: [...phaseSpecs], blockedFeedbacks: [] };

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

    let rebound = rebindPhaseWorkNodeIds(phaseSpecs, boundWorkNodeIds, dagNodes);
    const readyIds = preferReadyWorkNodeIds(boundWorkNodeIds, dagNodes);
    if (readyIds.length === 0) return { specs: rebound, blockedFeedbacks: [] };

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
      const claim = await this.markWorkNodesRunning(
        newlyRunning,
        ownerExpertIdForWorkNodes(rebound),
        runId,
        signal,
      );
      if (claim.haltReason !== undefined) {
        return {
          specs: rebound,
          haltReason: claim.haltReason,
          blockedFeedbacks: claim.blockedFeedbacks,
        };
      }
      if (claim.claimedIds.length !== newlyRunning.length) {
        const allowed = new Set(claim.claimedIds);
        const refused = new Set(newlyRunning.filter((id) => !allowed.has(id)));
        rebound = rebound.map((spec) => ({
          ...spec,
          workNodeIds: spec.workNodeIds.filter((id) => !refused.has(id)),
        }));
      }
      return { specs: rebound, blockedFeedbacks: claim.blockedFeedbacks };
    }
    return { specs: rebound, blockedFeedbacks: [] };
  }

  async finishWorkNodes(
    nodeIds: readonly string[],
    results: readonly UltraSwarmRenderedResult[],
    teamName: string,
    signal: AbortSignal,
  ): Promise<{ readonly haltReason?: string; readonly blockedFeedbacks: readonly string[] }> {
    const outcome = workNodeOutcome(results);
    const owner = ownerResultForWorkNodes(results);
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    const allowedIds: string[] = [];
    const blockedFeedbacks: string[] = [];

    for (const id of nodeIds) {
      const existing = graph?.nodes.find((entry) => entry.id === id);
      if (existing !== undefined && SWARM_DAG_TERMINAL_STATUSES.has(existing.status)) {
        continue;
      }
      if (isTeamTaskCompletionStatus(outcome.status)) {
        const decision = await fireTaskCompleted(this.agent.hooks, {
          taskId: id,
          taskSubject: existing?.title ?? id,
          taskDescription: existing?.verificationSummary,
          teammateName: owner?.spec.expertName ?? owner?.spec.expertId,
          teamName,
          signal,
        });
        publishTeamHookDecision(this.agent, 'TaskCompleted', decision);
        if (decision.kind === 'halt') {
          return { haltReason: decision.reason, blockedFeedbacks };
        }
        if (decision.kind === 'block') {
          blockedFeedbacks.push(`[${id}] ${decision.feedback}`);
          this.agent.telemetry.track('ultra_swarm_task_completed_blocked', {
            task_id: id,
            feedback: decision.feedback.slice(0, 240),
          });
          continue;
        }
      }
      allowedIds.push(id);
    }

    if (allowedIds.length === 0) return { blockedFeedbacks };

    this.updateWorkNodes(allowedIds, (node) => {
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
    return { blockedFeedbacks };
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
