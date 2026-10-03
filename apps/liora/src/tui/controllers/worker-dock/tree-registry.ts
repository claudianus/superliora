import { utf8Prefix, type Event } from '@superliora/sdk';
import type { WorkerDockTreeInput, WorkerTreeNode, WorkerTreePhase, WorkerCoordinatorTotals } from '#/tui/components/panes/worker-dock/worker-tree';

/** Structural subset of the host-owned WorkerAncestry protocol, not inferred UI lineage. */
export interface DockWorkerAncestry {
  readonly agentId: string;
  readonly sessionId: string;
  readonly parentAgentId: string | null;
  readonly parentSessionId: string | null;
  readonly rootAgentId: string | null;
  readonly rootSessionId: string | null;
  readonly status: 'root' | 'linked' | 'orphan';
  readonly coordinationId?: string;
}
export interface DockIndependentFact {
  readonly id: string;
  readonly sessionId?: string;
  readonly revision?: number;
  readonly status: string;
  readonly purpose?: string;
  readonly role?: string;
  readonly kind?: 'session' | 'pipeline';
  readonly verification?: { readonly status: string };
  readonly pipeline?: { readonly status: string };
  readonly reusable?: boolean;
  readonly ownerStatus?: string;
  readonly workerAncestry?: DockWorkerAncestry;
  readonly originAncestry?: DockWorkerAncestry;
  readonly parentSessionId?: string | null;
  readonly parentAgentId?: string | null;
  readonly coordinationId?: string;
}
export const dockAgentKey = (sessionId: string, agentId: string): string => `${sessionId}:${agentId}`;

/** Registry-side ancestry adapter. Event originals and user conversation routing are untouched. */
export class WorkerTreeRegistry {
  private readonly nodes = new Map<string, WorkerTreeNode>();
  private readonly revisions = new Map<string, number>();
  private readonly aliases = new Map<string, string>();
  private readonly totalsByConductor = new Map<string, WorkerCoordinatorTotals>();
  private readonly ownersByCoordination = new Map<string, { id: string; agentId: string }>();
  reset(): void { this.nodes.clear(); this.revisions.clear(); this.aliases.clear(); this.ownersByCoordination.clear(); this.totalsByConductor.clear(); }

  applyFacts(conductorSessionId: string, records: readonly DockIndependentFact[], totals?: WorkerCoordinatorTotals): boolean {
    let changed = false;
    if (totals !== undefined) {
      const previous = this.totalsByConductor.get(conductorSessionId);
      changed = previous?.total !== totals.total || previous.truncated !== totals.truncated || previous.counts.attention !== totals.counts.attention ||
        JSON.stringify(previous.counts.byStatus) !== JSON.stringify(totals.counts.byStatus);
      if (changed) this.totalsByConductor.set(conductorSessionId, { ...totals, counts: { ...totals.counts, byStatus: { ...totals.counts.byStatus } } });
    }
    for (const record of records) changed = this.applyFact(conductorSessionId, record) || changed;
    return changed;
  }
  applyFact(conductorSessionId: string, record: DockIndependentFact): boolean {
    const revisionKey = `${conductorSessionId}:${record.id}`;
    const prevRevision = this.revisions.get(revisionKey);
    if (record.revision !== undefined && prevRevision !== undefined && record.revision < prevRevision) return false;
    if (record.revision !== undefined) this.revisions.set(revisionKey, record.revision);
    // Pipeline execution is an operation, not the caller's Session worker.
    // Ignore legacy caller-origin metadata until core supplies the explicit operation subject.
    const ancestry = record.kind === 'pipeline' ? undefined : record.workerAncestry;
    const operationParent = record.kind === 'pipeline' && record.parentSessionId != null && record.parentAgentId != null ? dockAgentKey(record.parentSessionId, record.parentAgentId) : undefined;
    // A durable record without ancestry is an explicit unresolved owner, not a guessed main child.
    const key = `record:${conductorSessionId}:${record.id}`;
    let aliasChanged = false;
    if (ancestry !== undefined && record.kind !== 'pipeline') {
      this.ownersByCoordination.set(ancestry.coordinationId ?? record.id, { id: key, agentId: ancestry.agentId });
      const actual = dockAgentKey(ancestry.sessionId, ancestry.agentId);
      aliasChanged = this.aliases.get(actual) !== key;
      this.aliases.set(actual, key);
      // Transfer an already-observed actual node, preserving one semantic owner.
      if (actual !== key) {
        const observed = this.nodes.get(actual);
        if (observed !== undefined && !this.nodes.has(key)) this.nodes.set(key, { ...observed, id: key });
        this.nodes.delete(actual);
      }
    }
    const queued = record.status === 'accepted' || record.status === 'admitting' || record.status === 'queued' || record.status === 'starting';
    const settled = record.status === 'idle' || record.status === 'yielded' || record.status === 'parked';
    const phase: WorkerTreePhase = record.status === 'failed' || record.status === 'error' || record.status === 'interrupted' || record.ownerStatus === 'error' || record.ownerStatus === 'interrupted' ? 'error'
      : queued ? 'queued'
        : record.status === 'cancel_requested' || record.ownerStatus === 'settling' ? 'running'
          : settled ? record.reusable === true ? 'idle' : 'completed'
          : record.status === 'finished' || record.status === 'completed' ? 'completed'
            : record.status === 'running' || record.status === 'cancel_requested' || record.ownerStatus === 'active' || record.ownerStatus === 'settling' ? 'running' : 'completed';
    const attention = ['failed', 'stale', 'source_changed', 'interrupted'].includes(record.verification?.status ?? '') || ['failed', 'blocked', 'interrupted'].includes(record.pipeline?.status ?? '') || phase === 'error' ? 'error' as const : undefined;
    return this.put(key, ancestry, { attention, label: record.purpose?.trim() || 'Independent worker', role: record.role ?? (record.kind === 'pipeline' ? 'pipeline' : 'worker'), phase, reusable: record.reusable, recordId: record.id }, operationParent) || aliasChanged;
  }
  applyEvent(event: Event, fallback?: DockIndependentFact): { readonly event: Event; readonly changed: boolean } {
    const subject = 'subagentId' in event && typeof event.subagentId === 'string' ? event.subagentId : event.agentId;
    const direct = (event as Event & { workerAncestry?: DockWorkerAncestry }).workerAncestry;
    const ownerFallback = fallback?.workerAncestry;
    const ownerSubject = subject === ownerFallback?.agentId && event.sessionId === ownerFallback?.sessionId;
    const unresolved: DockWorkerAncestry | undefined = fallback !== undefined ? { agentId: subject, sessionId: event.sessionId, parentAgentId: null, parentSessionId: null, rootAgentId: null, rootSessionId: null, status: 'orphan' } : undefined;
    const ancestry = direct ?? (ownerSubject ? ownerFallback : unresolved);
    if (ancestry === undefined) return { event, changed: false };
    const actual = dockAgentKey(ancestry.sessionId, ancestry.agentId);
    const correlation = ancestry.coordinationId === undefined ? undefined : this.ownersByCoordination.get(ancestry.coordinationId);
    const owner = correlation?.agentId === ancestry.agentId ? correlation : undefined;
    let aliasChanged = false;
    if (owner !== undefined) {
      aliasChanged = this.aliases.get(actual) !== owner.id;
      this.aliases.set(actual, owner.id);
      if (actual !== owner.id) {
        const observed = this.nodes.get(actual);
        const retained = this.nodes.get(owner.id);
        if (observed?.attention !== undefined && retained !== undefined && retained.attention === undefined) this.nodes.set(owner.id, { ...retained, attention: observed.attention });
        this.nodes.delete(actual);
      }
    }
    const id = this.aliases.get(actual) ?? actual;
    const existing = this.nodes.get(id);
    let phase = existing?.phase ?? 'running';
    if (event.type === 'subagent.completed') phase = existing?.reusable === true ? 'idle' : 'completed';
    else if (event.type === 'subagent.failed') phase = 'error';
    else if (event.type === 'subagent.started' || event.type === 'turn.started') phase = 'running';
    const purpose = 'description' in event && typeof event.description === 'string' ? event.description : undefined;
    const name = 'subagentName' in event && typeof event.subagentName === 'string' ? event.subagentName : undefined;
    const changed = this.put(id, ancestry, { label: purpose ?? existing?.label ?? (ownerSubject ? fallback?.purpose : undefined) ?? name ?? 'Worker', role: existing?.role ?? (ownerSubject ? fallback?.role : undefined), recordId: existing?.recordId ?? ancestry.coordinationId, phase, reusable: existing?.reusable ?? (ownerSubject ? fallback?.reusable : undefined) });
    const normalized = { ...event, agentId: id, ...('subagentId' in event ? { subagentId: id } : {}) } as Event;
    return { event: normalized, changed: changed || aliasChanged };
  }
  setAttention(sessionId: string, agentId: string, attention: 'question' | 'error' | undefined): boolean {
    const id = this.resolveIdentity(dockAgentKey(sessionId, agentId));
    const previous = this.nodes.get(id);
    if (previous === undefined) {
      if (attention === undefined) return false;
      this.nodes.set(id, { id, label: 'Worker needing attention', phase: attention === 'error' ? 'error' : 'running', attention });
      return true;
    }
    if (previous.attention === attention) return false;
    this.nodes.set(id, { ...previous, attention }); return true;
  }
  getNode(id: string): WorkerTreeNode | undefined { return this.nodes.get(id); }
  resolveIdentity(id: string): string { return this.aliases.get(id) ?? id; }
  snapshot(conductorSessionId: string, rootAgentId: string): WorkerDockTreeInput {
    return { rootAgentId: dockAgentKey(conductorSessionId, rootAgentId), rootAgentRawId: rootAgentId, sessionId: conductorSessionId,
      sessionLabel: 'Session · Main', coordinatorTotals: this.totalsByConductor.get(conductorSessionId), nodes: [...this.nodes.values()].map(node => ({ ...node, parentAgentId: node.parentAgentId == null ? node.parentAgentId : this.aliases.get(node.parentAgentId) ?? node.parentAgentId })) };
  }
  private put(id: string, ancestry: DockWorkerAncestry | undefined, data: Omit<WorkerTreeNode, 'id' | 'parentAgentId'>, operationParent?: string): boolean {
    const parentAgentId = operationParent ?? ( ancestry?.status === 'root' ? null : ancestry?.status === 'linked' && ancestry.parentSessionId != null && ancestry.parentAgentId != null
      ? dockAgentKey(ancestry.parentSessionId, ancestry.parentAgentId) : undefined);
    const next: WorkerTreeNode = { id, parentAgentId, ...data, label: utf8Prefix(data.label, 160).split('\n', 1)[0]?.trim() || 'Worker', role: data.role === undefined ? undefined : utf8Prefix(data.role, 64), attention: data.attention ?? (data.phase === 'error' ? 'error' : this.nodes.get(id)?.attention === 'error' && this.nodes.get(id)?.phase === 'error' ? undefined : this.nodes.get(id)?.attention), agentId: ancestry?.agentId, sessionId: ancestry?.sessionId };
    const prev = this.nodes.get(id);
    if (prev !== undefined && prev.parentAgentId === next.parentAgentId && prev.label === next.label && prev.role === next.role && prev.phase === next.phase && prev.reusable === next.reusable && prev.agentId === next.agentId && prev.sessionId === next.sessionId && prev.recordId === next.recordId && prev.attention === next.attention) return false;
    this.nodes.set(id, next); return true;
  }
}
