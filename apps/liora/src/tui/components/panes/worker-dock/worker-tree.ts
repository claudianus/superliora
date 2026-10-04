import type { DockWorker } from '#/tui/controllers/worker-dock/registry';

export type WorkerTreePhase = 'running' | 'queued' | 'idle' | 'completed' | 'error';
export interface WorkerTreeNode {
  readonly id: string;
  readonly parentAgentId?: string | null;
  readonly label: string;
  readonly role?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly recordId?: string;
  readonly phase: WorkerTreePhase;
  readonly reusable?: boolean;
  readonly attention?: 'question' | 'error';
}
export interface WorkerCoordinatorTotals {
  readonly total: number;
  readonly truncated: boolean;
  readonly counts: { readonly byStatus: Readonly<Record<string, number>>; readonly attention: number };
}
export interface WorkerDockTreeInput {
  readonly rootAgentId: string;
  readonly rootAgentRawId?: string;
  readonly sessionId?: string;
  readonly sessionLabel?: string;
  readonly nodes: readonly WorkerTreeNode[];
  readonly coordinatorTotals?: WorkerCoordinatorTotals;
}
export interface WorkerTreeRow {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: 'root' | 'worker' | 'group';
  readonly label: string;
  readonly role?: string;
  readonly phase?: WorkerTreePhase;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly depth: number;
  readonly connector: string;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly activeDescendants: number;
  readonly queuedDescendants: number;
  readonly liveActivity?: string;
  readonly attention: boolean;
  readonly attentionKind?: 'question' | 'error';
  readonly path: readonly string[];
}
export interface WorkerTreeProjection {
  readonly rows: readonly WorkerTreeRow[];
  readonly parents: ReadonlyMap<string, string>;
  readonly counts: Readonly<Record<WorkerTreePhase, number>>;
}
const GROUP_PREFIX = '\u0000worker-tree:';
const MAX_DEPTH = 48;
/**
 * Painted levels below the root: every node may sit under its own settled
 * group, and an orphan chain adds one more group. Traversals must use this,
 * not MAX_DEPTH, or a valid settled chain loses its tail.
 */
export const WORKER_TREE_MAX_LEVELS = MAX_DEPTH * 2 + 2;
interface Entry {
  id: string; parentId?: string; kind: WorkerTreeRow['kind']; label: string;
  node?: WorkerTreeNode; children: string[]; active: number; queued: number; attention: boolean;
  activity?: string; activityAt: number;
}
const isActive = (node: WorkerTreeNode): boolean => node.phase === 'running' || node.phase === 'queued';

/** Pure projection. Only explicit IDs define edges; malformed ancestry is visible, never guessed. */
export function projectWorkerTree(
  input: WorkerDockTreeInput,
  workers: readonly DockWorker[],
  expansion: ReadonlyMap<string, boolean>,
  selectedId?: string,
): WorkerTreeProjection {
  const entries = new Map<string, Entry>();
  const parents = new Map<string, string>();
  const counts: Record<WorkerTreePhase, number> = { running: 0, queued: 0, idle: 0, completed: 0, error: 0 };
  const telemetry = new Map(workers.map(worker => [worker.id, worker]));
  const rootId = input.rootAgentId;
  entries.set(rootId, { id: rootId, kind: 'root', label: input.sessionLabel ?? 'Session · Main', children: [], active: 0, queued: 0, attention: false, activityAt: 0 });
  const nodes = new Map<string, WorkerTreeNode>();
  for (const node of input.nodes) {
    if (node.id === rootId || node.id.startsWith(GROUP_PREFIX) || nodes.has(node.id)) continue;
    nodes.set(node.id, node.phase === 'idle' && node.reusable !== true ? { ...node, phase: 'completed' } : node);
  }
  // Unknown telemetry remains explicitly orphaned until its core metadata arrives.
  for (const worker of workers) {
    if (worker.id === rootId || nodes.has(worker.id) || worker.id.startsWith(GROUP_PREFIX)) continue;
    nodes.set(worker.id, { id: worker.id, label: worker.description ?? worker.name, phase: worker.status === 'failed' ? 'error' : worker.status === 'completed' ? 'completed' : 'running' });
  }
  for (const node of nodes.values()) {
    counts[node.phase]++;
    const worker = telemetry.get(node.id);
    entries.set(node.id, { id: node.id, kind: 'worker', label: node.label, node, children: [], active: isActive(node) ? 1 : 0, queued: node.phase === 'queued' ? 1 : 0, attention: node.phase === 'error' || node.attention !== undefined,
      activity: worker?.liveText || [worker?.lastTool, worker?.lastTarget].filter(Boolean).join(' · ') || undefined,
      activityAt: worker?.liveAtMs ?? worker?.lastActivityAtMs ?? 0 });
  }
  const group = (key: string, label: string, parentId: string): string => {
    const id = GROUP_PREFIX + key;
    if (!entries.has(id)) entries.set(id, { id, parentId, kind: 'group', label, children: [], active: 0, queued: 0, attention: false, activityAt: 0 });
    return id;
  };
  const cycles = new Set<string>();
  const tooDeep = new Set<string>();
  for (const node of nodes.values()) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let id: string | null | undefined = node.id;
    while (id !== undefined && id !== null && id !== rootId && nodes.has(id)) {
      const seen = positions.get(id);
      if (seen !== undefined) { for (const member of chain.slice(seen)) cycles.add(member); break; }
      if (chain.length >= MAX_DEPTH) { tooDeep.add(node.id); break; }
      positions.set(id, chain.length); chain.push(id); id = nodes.get(id)?.parentAgentId;
    }
  }
  for (const node of nodes.values()) {
    let parent = node.parentAgentId;
    if (cycles.has(node.id) || tooDeep.has(node.id)) parent = group('invalid', 'Ancestry fallback · cycle/depth', rootId);
    else if (parent === null || parent === rootId) parent = rootId;
    else if (parent === undefined || !nodes.has(parent)) parent = group('orphans', 'Orphans · parent unavailable', rootId);
    if ((node.phase === 'idle' || node.phase === 'completed') && node.attention === undefined) {
      parent = group(`settled:${parent}`, 'Idle / finished', parent);
    }
    entries.get(node.id)!.parentId = parent;
  }
  for (const entry of entries.values()) {
    if (entry.parentId === undefined) continue;
    entries.get(entry.parentId)?.children.push(entry.id);
    parents.set(entry.id, entry.parentId);
  }
  // Stable ID ordering does not change ancestry or the selected identity.
  const rank = (id: string): number => {
    const entry = entries.get(id)!;
    return entry.node?.phase === 'error' || entry.node?.attention !== undefined ? 0
      : entry.node?.phase === 'running' ? 1 : entry.node?.phase === 'queued' ? 2
        : entry.kind === 'worker' ? 3 : 4;
  };
  for (const entry of entries.values()) entry.children.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const visited = new Set<string>();
  const aggregate = (id: string, depth: number): void => {
    if (visited.has(id) || depth > WORKER_TREE_MAX_LEVELS) return;
    visited.add(id);
    const entry = entries.get(id)!;
    for (const childId of entry.children) {
      aggregate(childId, depth + 1);
      const child = entries.get(childId)!;
      entry.active += child.active; entry.queued += child.queued; entry.attention ||= child.attention;
      if (child.activity !== undefined && child.activityAt >= entry.activityAt) {
        entry.activity = child.activity; entry.activityAt = child.activityAt;
      }
    }
  };
  aggregate(rootId, 0);
  const selectedPath = new Set<string>();
  let selected = selectedId;
  for (let i = 0; selected !== undefined && i <= WORKER_TREE_MAX_LEVELS; i++) {
    selectedPath.add(selected); selected = parents.get(selected);
  }
  const rows: WorkerTreeRow[] = [];
  const paint = (id: string, depth: number, continuation: readonly boolean[], last: boolean, path: readonly string[]): void => {
    if (depth > WORKER_TREE_MAX_LEVELS) return;
    const entry = entries.get(id)!;
    const ownActive = entry.node !== undefined && isActive(entry.node) ? 1 : 0;
    const expandable = entry.children.length > 0;
    const explicit = expansion.get(id);
    const expanded = expandable && (explicit ?? (entry.kind === 'root' || entry.children.some(child => entries.get(child)?.attention) || (selectedPath.has(id) && id !== selectedId) || id === GROUP_PREFIX + 'orphans' || id === GROUP_PREFIX + 'invalid'));
    rows.push({ id, parentId: entry.parentId, kind: entry.kind, label: entry.label, role: entry.node?.role, agentId: entry.node?.agentId, sessionId: entry.node?.sessionId, phase: entry.node?.phase, depth,
      connector: depth === 0 ? '' : continuation.map(keep => keep ? '│ ' : '  ').join('') + (last ? '└─' : '├─'),
      expandable, expanded, activeDescendants: entry.active - ownActive, queuedDescendants: entry.queued - (entry.node?.phase === 'queued' ? 1 : 0), liveActivity: entry.activity,
      attention: entry.attention, attentionKind: entry.node?.attention, path: [...path, entry.label] });
    if (!expanded) return;
    entry.children.forEach((childId, index) => paint(childId, depth + 1, depth === 0 ? [] : [...continuation, !last], index === entry.children.length - 1, [...path, entry.label]));
  };
  paint(rootId, 0, [], true, []);
  return { rows, parents, counts };
}
