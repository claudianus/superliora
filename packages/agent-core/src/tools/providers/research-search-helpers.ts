import type { ResearchSearchProviderKind } from '#/config/schema';
import type { WebSearchResult } from '../builtin/web/web-search';
import { canonicalizeSearchUrl } from './research-search-fusion';
import type { ProviderSlot } from './research-search-slots';

/** Lower = preferred in cost-aware cascade. Free is always last. */
export const PROVIDER_COST_RANK: Readonly<Record<ResearchSearchProviderKind, number>> = {
  brave: 10,
  serper: 20,
  searxng: 25,
  moonshot: 30,
  tavily: 40,
  exa: 50,
  duckduckgo: 100,
};

export function orderByCost(slots: readonly ProviderSlot[]): ProviderSlot[] {
  return slots.toSorted((a, b) => {
    const cost = (PROVIDER_COST_RANK[a.kind] ?? 50) - (PROVIDER_COST_RANK[b.kind] ?? 50);
    if (cost !== 0) return cost;
    return a.useCount - b.useCount;
  });
}

export function truncateResultContent(result: WebSearchResult, maxChars: number): WebSearchResult {
  if (result.content === undefined || result.content.length <= maxChars) return result;
  return {
    ...result,
    content: `${result.content.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n\n[...truncated]`,
  };
}

export function rankAndDedupe(results: readonly WebSearchResult[], query: string): WebSearchResult[] {
  const seen = new Set<string>();
  const scored = results
    .map((result) => ({ ...result, url: canonicalizeSearchUrl(result.url) }))
    .filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    })
    .map((result) => ({ result, score: scoreResult(result, query) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.result);
}

function scoreResult(result: WebSearchResult, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const hay = `${result.title} ${result.snippet}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
  }
  if (result.content !== undefined && result.content.length > 0) score += 0.5;
  return score;
}

export async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  if (jobs.length === 0) return [];
  const results: T[] = Array.from({ length: jobs.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      results[index] = await jobs[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}
