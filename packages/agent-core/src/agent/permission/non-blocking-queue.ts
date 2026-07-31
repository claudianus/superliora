export type QueuedPermissionItem = {
  id: string;
  toolName: string;
  rule: string;
  enqueuedAtMs: number;
  risk: 'low' | 'high';
};

let nextId = 1;

function createId(): string {
  const id = `perm-${nextId}`;
  nextId += 1;
  return id;
}

export interface PermissionQueueSnapshot {
  readonly count: number;
  readonly items: readonly QueuedPermissionItem[];
}

export class NonBlockingPermissionQueue {
  private readonly items = new Map<string, QueuedPermissionItem>();

  snapshot(): PermissionQueueSnapshot {
    const items = this.list();
    return { count: items.length, items };
  }

  /**
   * Drop queue entries older than `maxAgeMs`. Returns how many were removed.
   * Intended for orphaned entries when resolve failed to clear the queue — not
   * for in-flight RPC waiters (deleting while awaiting would desync UI vs host).
   */
  autoExpire(
    maxAgeMs: number,
    nowMs = Date.now(),
    options?: { readonly skipIds?: ReadonlySet<string> },
  ): number {
    let expired = 0;
    for (const [id, item] of this.items) {
      if (options?.skipIds?.has(id)) continue;
      if (nowMs - item.enqueuedAtMs >= maxAgeMs) {
        this.items.delete(id);
        expired += 1;
      }
    }
    return expired;
  }

  enqueue(item: Omit<QueuedPermissionItem, 'id' | 'enqueuedAtMs'>): QueuedPermissionItem {
    const queued: QueuedPermissionItem = {
      ...item,
      id: createId(),
      enqueuedAtMs: Date.now(),
    };
    this.items.set(queued.id, queued);
    return queued;
  }

  list(): readonly QueuedPermissionItem[] {
    return [...this.items.values()];
  }

  resolve(id: string, decision: 'approved' | 'denied'): QueuedPermissionItem | undefined {
    const item = this.items.get(id);
    if (item === undefined) return undefined;
    this.items.delete(id);
    return item;
  }

  pendingCount(): number {
    return this.items.size;
  }
}
