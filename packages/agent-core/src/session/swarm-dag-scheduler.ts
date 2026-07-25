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
