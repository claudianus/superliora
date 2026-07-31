import type { UltraworkObjectiveProfile } from './objective-profile-llm';

/**
 * Maximum number of cached profiles. Prevents unbounded memory growth in
 * long-running sessions with many distinct objectives. Evicts oldest entry.
 */
const MAX_CACHE_SIZE = 16;

/**
 * Per-agent cache of the latest LLM objective profile so sync injectors
 * (Premium Quality density) can reuse the classify result without re-calling the model.
 */
export class UltraworkObjectiveProfileCache {
  private readonly byObjective = new Map<string, UltraworkObjectiveProfile>();

  set(objective: string, profile: UltraworkObjectiveProfile): void {
    const key = normalizeObjectiveKey(objective);
    if (key.length === 0) return;
    // Evict oldest entry when at capacity (Map iterates in insertion order).
    if (this.byObjective.size >= MAX_CACHE_SIZE && !this.byObjective.has(key)) {
      const oldest = this.byObjective.keys().next().value;
      if (oldest !== undefined) this.byObjective.delete(oldest);
    }
    this.byObjective.set(key, profile);
  }

  get(objective: string | undefined | null): UltraworkObjectiveProfile | undefined {
    const key = normalizeObjectiveKey(objective ?? '');
    if (key.length === 0) return undefined;
    return this.byObjective.get(key);
  }

  clear(): void {
    this.byObjective.clear();
  }
}

function normalizeObjectiveKey(objective: string): string {
  return objective.trim().replace(/\s+/gu, ' ').toLowerCase();
}
