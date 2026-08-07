/**
 * Goal/Job-scoped objective → premium density profile cache (LRU).
 * Replaces the deleted Ultrawork objective-profile map.
 */

import type { ObjectiveProfile } from './ui-surface';

const DEFAULT_CAPACITY = 16;

export class ObjectiveProfileCache {
  private readonly order: string[] = [];
  private readonly map = new Map<string, ObjectiveProfile>();

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  get(objective: string | undefined | null): ObjectiveProfile | undefined {
    const key = normalizeKey(objective);
    if (key === undefined) return undefined;
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    this.touch(key);
    return hit;
  }

  set(objective: string | undefined | null, profile: ObjectiveProfile): void {
    const key = normalizeKey(objective);
    if (key === undefined) return;
    if (this.map.has(key)) {
      this.map.set(key, profile);
      this.touch(key);
      return;
    }
    this.map.set(key, profile);
    this.order.push(key);
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.map.delete(evicted);
    }
  }

  private touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(key);
  }
}

function normalizeKey(objective: string | undefined | null): string | undefined {
  const text = objective?.trim();
  if (text === undefined || text.length === 0) return undefined;
  return text.length > 512 ? text.slice(0, 512) : text;
}
