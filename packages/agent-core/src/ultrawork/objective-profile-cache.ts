import type { UltraworkObjectiveProfile } from './objective-profile-llm';

/**
 * Per-agent cache of the latest LLM objective profile so sync injectors
 * (Premium Quality density) can reuse the classify result without re-calling the model.
 */
export class UltraworkObjectiveProfileCache {
  private readonly byObjective = new Map<string, UltraworkObjectiveProfile>();

  set(objective: string, profile: UltraworkObjectiveProfile): void {
    const key = normalizeObjectiveKey(objective);
    if (key.length === 0) return;
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
