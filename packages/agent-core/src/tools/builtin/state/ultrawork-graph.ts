import {
  workGraphNodeSchema,
  type WorkGraph,
  type WorkGraphNode,
} from '@superliora/protocol';
import { z } from 'zod';

import type { Agent } from '../../../agent';
import { maybeFinishUltraworkRun } from '../../../ultrawork/finish-run';
import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import {
  TODO_STORE_KEY,
  renderTodoList,
  type TodoItem,
  type TodoStatus,
} from './todo-list';
import DESCRIPTION from './ultrawork-graph.md?raw';

export const ULTRAWORK_GRAPH_TOOL_NAME = 'UltraworkGraph' as const;
export const ULTRAWORK_GRAPH_STORE_KEY = 'ultrawork_graph' as const;

declare module '../../store' {
  interface ToolStoreData {
    ultrawork_graph: WorkGraph;
  }
}

export const UltraworkGraphInputSchema = z
  .object({
    graph_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional WorkGraph id. Defaults to an existing graph id or `${run_id}:work_graph`.'),
    run_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Ultrawork run id. Required when replacing nodes.'),
    root_goal: z.string().trim().min(1).optional().describe('Optional root UltraGoal summary.'),
    nodes: z
      .array(workGraphNodeSchema)
      .optional()
      .describe('Full replacement WorkGraph node list. Omit to read the current graph.'),
    sync_todos: z
      .boolean()
      .optional()
      .describe('Whether to sync TodoList from the graph after replacement. Defaults to true.'),
  })
  .strict();

export type UltraworkGraphInput = z.infer<typeof UltraworkGraphInputSchema>;

export class UltraworkGraphTool implements BuiltinTool<UltraworkGraphInput> {
  readonly name = ULTRAWORK_GRAPH_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(UltraworkGraphInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: UltraworkGraphInput): ToolExecution {
    return {
      description: args.nodes === undefined ? 'Reading Ultrawork graph' : 'Updating Ultrawork graph',
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: UltraworkGraphInput): Promise<ExecutableToolResult> {
    if (args.nodes === undefined) {
      const graph = this.getGraph();
      return {
        isError: false,
        output: graph === undefined ? 'Ultrawork graph is empty.' : renderUltraworkGraph(graph),
      };
    }

    if (args.run_id === undefined) {
      return {
        isError: true,
        output: 'UltraworkGraph update requires run_id when nodes are provided.',
      };
    }

    const validation = validateWorkGraphNodes(args.nodes);
    if (validation !== undefined) {
      return { isError: true, output: validation };
    }

    const previous = this.getGraph();
    const now = new Date().toISOString();
    const graph = cloneWorkGraph({
      id: args.graph_id ?? previous?.id ?? `${args.run_id}:work_graph`,
      runId: args.run_id,
      rootGoal: args.root_goal ?? previous?.rootGoal,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      nodes: args.nodes,
    });

    this.store.set(ULTRAWORK_GRAPH_STORE_KEY, graph);
    const syncTodos = args.sync_todos !== false;
    if (syncTodos) {
      this.store.set(TODO_STORE_KEY, todosFromWorkGraph(graph));
    }
    this.emitChangedNodes(previous, graph);
    this.agent.ultrawork.syncWorkGraphFromStore();
    await maybeFinishUltraworkRun(this.agent);

    const changedCount = changedNodes(previous, graph).length;
    const todoLine = syncTodos ? `\n${renderTodoList(todosFromWorkGraph(graph), 'Synced TodoList:')}` : '';
    return {
      isError: false,
      output: `Ultrawork graph updated: ${String(graph.nodes.length)} nodes, ${String(changedCount)} task events.${todoLine}`,
    };
  }

  private getGraph(): WorkGraph | undefined {
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    return graph === undefined ? undefined : cloneWorkGraph(graph);
  }

  private emitChangedNodes(previous: WorkGraph | undefined, graph: WorkGraph): void {
    for (const node of changedNodes(previous, graph)) {
      this.agent.emitEvent({
        type: 'ultrawork.task.assigned',
        runId: graph.runId,
        task: node,
      });
    }
  }
}

export function renderUltraworkGraph(graph: WorkGraph): string {
  if (graph.nodes.length === 0) {
    return `Ultrawork graph ${graph.id} for ${graph.runId} has no nodes.`;
  }
  const lines = [
    `Ultrawork graph ${graph.id} for ${graph.runId}:`,
    ...(graph.rootGoal === undefined ? [] : [`Root goal: ${graph.rootGoal}`]),
  ];
  for (const node of graph.nodes) {
    const owner = node.ownerExpertId ?? node.ownerAgentId;
    const ownerText = owner === undefined ? '' : ` owner=${owner}`;
    const acText = node.acceptanceCriterionId === undefined ? '' : ` ac=${node.acceptanceCriterionId}`;
    const evidenceText =
      node.evidenceIds === undefined || node.evidenceIds.length === 0
        ? ''
        : ` evidence=${node.evidenceIds.join(',')}`;
    lines.push(`  [${node.status}] ${node.id}: ${node.title}${acText}${ownerText}${evidenceText}`);
  }
  return lines.join('\n');
}

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

function cloneWorkGraphNode(node: WorkGraphNode): WorkGraphNode {
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

function validateWorkGraphNodes(nodes: readonly WorkGraphNode[]): string | undefined {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return `Duplicate WorkGraph node id: ${node.id}`;
    ids.add(node.id);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (dependency === node.id) return `WorkGraph node ${node.id} cannot depend on itself.`;
      if (!ids.has(dependency)) {
        return `WorkGraph node ${node.id} depends on missing node ${dependency}.`;
      }
    }
  }
  return undefined;
}

function changedNodes(previous: WorkGraph | undefined, graph: WorkGraph): readonly WorkGraphNode[] {
  const previousById = new Map((previous?.nodes ?? []).map((node) => [node.id, node]));
  return graph.nodes.filter((node) => {
    const before = previousById.get(node.id);
    return before === undefined || taskEventRelevantFieldsChanged(before, node);
  });
}

function taskEventRelevantFieldsChanged(before: WorkGraphNode, after: WorkGraphNode): boolean {
  return (
    before.status !== after.status ||
    before.ownerExpertId !== after.ownerExpertId ||
    before.ownerAgentId !== after.ownerAgentId ||
    !sameStringList(before.evidenceIds, after.evidenceIds)
  );
}

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
