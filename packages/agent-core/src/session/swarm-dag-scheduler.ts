/**
 * Pure DAG ready-set scheduler for WorkGraph-style nodes.
 *
 * A node is **ready** when:
 * - its own status is not terminal (`done` / `succeeded` / `failed` / `blocked`)
 * - every id in `dependsOn` refers to a node whose status is done/succeeded
 *   (or the dependency id is unknown — treated as not satisfied)
 *
 * No side effects; safe to call from ultra-swarm phase assignment later.
 */

export type SwarmDagNodeStatus =
  | 'queued'
  | 'ready'
  | 'running'
  | 'done'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | (string & {});

export interface SwarmDagNode {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly status: SwarmDagNodeStatus;
}

/** Statuses that count as a satisfied dependency. */
export const SWARM_DAG_DONE_STATUSES: ReadonlySet<string> = new Set(['done', 'succeeded']);

/** Statuses that mean the node itself is not schedulable. */
export const SWARM_DAG_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
]);

/**
 * Return ids of nodes that are ready to run given the current graph.
 * Order is stable: input order among ready nodes.
 */
export function readyNodeIds(nodes: readonly SwarmDagNode[]): readonly string[] {
  const byId = new Map<string, SwarmDagNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const ready: string[] = [];
  for (const node of nodes) {
    if (SWARM_DAG_TERMINAL_STATUSES.has(node.status)) continue;
    if (node.status === 'running') continue;

    const deps = node.dependsOn ?? [];
    const depsSatisfied = deps.every((depId) => {
      const dep = byId.get(depId);
      if (dep === undefined) return false;
      return SWARM_DAG_DONE_STATUSES.has(dep.status);
    });
    if (depsSatisfied) ready.push(node.id);
  }
  return ready;
}

/**
 * True when every dependency is done/succeeded (same rules as ready-set).
 */
export function areDependenciesSatisfied(
  node: SwarmDagNode,
  nodesById: ReadonlyMap<string, SwarmDagNode>,
): boolean {
  const deps = node.dependsOn ?? [];
  return deps.every((depId) => {
    const dep = nodesById.get(depId);
    if (dep === undefined) return false;
    return SWARM_DAG_DONE_STATUSES.has(dep.status);
  });
}

/**
 * Partition bound work-node ids into ready vs still-blocked (deps not done).
 * Order of each list follows `nodes` input order.
 */
export function partitionReadyWorkNodeIds(nodes: readonly SwarmDagNode[]): {
  readonly readyIds: readonly string[];
  readonly blockedIds: readonly string[];
} {
  const readySet = new Set(readyNodeIds(nodes));
  const readyIds: string[] = [];
  const blockedIds: string[] = [];
  for (const node of nodes) {
    if (SWARM_DAG_TERMINAL_STATUSES.has(node.status)) continue;
    if (node.status === 'running') continue;
    if (readySet.has(node.id)) readyIds.push(node.id);
    else blockedIds.push(node.id);
  }
  return { readyIds, blockedIds };
}

/**
 * Prefer ready node ids for expert binding / selection. When none are ready
 * (e.g. all still blocked on unknown deps), fall back to the original list so
 * callers do not starve.
 */
export function preferReadyWorkNodeIds(
  boundIds: readonly string[],
  nodes: readonly SwarmDagNode[],
): readonly string[] {
  if (boundIds.length === 0) return boundIds;
  const boundSet = new Set(boundIds);
  const ready = readyNodeIds(nodes).filter((id) => boundSet.has(id));
  return ready.length > 0 ? ready : boundIds;
}
