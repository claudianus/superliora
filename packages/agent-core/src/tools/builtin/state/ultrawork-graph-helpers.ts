import type { WorkGraph, WorkGraphNode } from '@superliora/protocol';

import type { TodoItem, TodoStatus } from './todo-list-store-key';

export function todosFromWorkGraph(graph: WorkGraph): readonly TodoItem[] {
  return graph.nodes.map((node) => ({
    title: `[${node.id}] ${node.title}`,
    status: todoStatusFromNode(node.status),
  }));
}

export function cloneWorkGraph(graph: WorkGraph): WorkGraph {
  return {
    id: graph.id,
    runId: graph.runId,
    rootGoal: graph.rootGoal,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    nodes: graph.nodes.map(cloneWorkGraphNode),
  };
}

export function cloneWorkGraphNode(node: WorkGraphNode): WorkGraphNode {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    stage: node.stage,
    parentId: node.parentId,
    acceptanceCriterionId: node.acceptanceCriterionId,
    laneId: node.laneId,
    ownerExpertId: node.ownerExpertId,
    ownerAgentId: node.ownerAgentId,
    status: node.status,
    dependsOn: cloneArray(node.dependsOn),
    evidenceIds: cloneArray(node.evidenceIds),
    requiredEvidence: cloneArray(node.requiredEvidence),
    verificationStatus: node.verificationStatus,
    verificationSummary: node.verificationSummary,
  };
}

function cloneArray(values: readonly string[] | undefined): readonly string[] | undefined {
  return values === undefined ? undefined : [...values];
}

function todoStatusFromNode(status: WorkGraphNode['status']): TodoStatus {
  if (status === 'running' || status === 'needs_integration') return 'in_progress';
  if (status === 'done') return 'done';
  return 'pending';
}
