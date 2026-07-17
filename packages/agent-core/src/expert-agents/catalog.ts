// Compatibility facade over split expert catalog modules.
// Search/orchestration import catalog-meta only.
// Persona bodies live in catalog-personas and load only when an expert is hydrated.

import type { ExpertCatalogEntry } from './types';
import {
  EXPERT_CATALOG_META,
  EXPERT_CATALOG_META_BY_ID,
  EXPERT_CATALOG_SOURCE_COUNTS,
  EXPERT_DIVISIONS,
} from './catalog-meta';
import { loadExpertPersonaText } from './catalog-persona-loader';

export {
  EXPERT_CATALOG_META,
  EXPERT_CATALOG_META_BY_ID,
  EXPERT_CATALOG_SOURCE_COUNTS,
  EXPERT_DIVISIONS,
};

/** Meta-only catalog for search/indexing (personaText empty). */
export const EXPERT_CATALOG: readonly ExpertCatalogEntry[] = EXPERT_CATALOG_META;

/**
 * Minimal persona when catalog JSON is missing a body for a known meta id.
 * Keeps UltraSwarm spawn usable instead of running with a blank specialist prompt.
 */
export function fallbackExpertPersonaText(entry: ExpertCatalogEntry): string {
  const tags = entry.tags.length > 0 ? entry.tags.join(', ') : 'general';
  const capabilities =
    entry.capabilities.length > 0 ? entry.capabilities.join(', ') : entry.description;
  return [
    `# ${entry.name}`,
    '',
    `You are **${entry.name}** (${entry.divisionLabel}).`,
    entry.description,
    '',
    `## Focus`,
    `- Division: ${entry.division}`,
    `- Tags: ${tags}`,
    `- Capabilities: ${capabilities}`,
    entry.vibe.length > 0 ? `- Vibe: ${entry.vibe}` : '',
    '',
    'Stay inside this specialty. Prefer concrete evidence over generic advice.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

export function hydrateExpertCatalogEntry(
  entry: ExpertCatalogEntry | undefined,
): ExpertCatalogEntry | undefined {
  if (entry === undefined) return undefined;
  if (entry.personaText.length > 0) return entry;
  const personaText = loadExpertPersonaText(entry.id);
  if (personaText !== undefined && personaText.length > 0) {
    return { ...entry, personaText };
  }
  // Known catalog entry but missing JSON body — do not spawn blank.
  return { ...entry, personaText: fallbackExpertPersonaText(entry) };
}

/** Lazy-hydrating lookup used by spawn/resolution paths. */
export const EXPERT_CATALOG_BY_ID: Readonly<Record<string, ExpertCatalogEntry>> = new Proxy(
  EXPERT_CATALOG_META_BY_ID as Record<string, ExpertCatalogEntry>,
  {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      return hydrateExpertCatalogEntry(target[prop]);
    },
  },
);
