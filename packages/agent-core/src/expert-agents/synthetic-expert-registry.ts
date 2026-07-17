import type { ExpertCatalogEntry } from './types';

/**
 * Session-scoped synthetic experts created by LLM fallback when the static
 * catalog has no suitable match. Looked up by {@link resolveExpertCatalogEntry}
 * so UltraSwarm can spawn them like catalog experts.
 */
const syntheticExpertsById = new Map<string, ExpertCatalogEntry>();

export function registerSyntheticExpert(expert: ExpertCatalogEntry): void {
  syntheticExpertsById.set(expert.id, expert);
}

export function getSyntheticExpert(id: string): ExpertCatalogEntry | undefined {
  return syntheticExpertsById.get(id);
}

export function listSyntheticExperts(): readonly ExpertCatalogEntry[] {
  return [...syntheticExpertsById.values()];
}

/** Test helper — clear all synthetic experts. */
export function clearSyntheticExpertsForTests(): void {
  syntheticExpertsById.clear();
}
