/**
 * Staffing gold-set bench (MVP): offline nDCG-style scoring for expert retrieval.
 *
 * Not a full IR benchmark harness — small pure helpers so CI/scripts can score
 * ranked id lists against labeled gold without network.
 */

export interface StaffingGoldCase {
  readonly id: string;
  readonly query: string;
  /** Ordered preferred expert ids (rank 1 first). */
  readonly relevantIds: readonly string[];
}

export function dcgAtK(rankedIds: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  let score = 0;
  const limit = Math.min(k, rankedIds.length);
  for (let i = 0; i < limit; i += 1) {
    const id = rankedIds[i];
    if (id === undefined || !relevant.has(id)) continue;
    // graded relevance: higher if earlier in gold list — binary for MVP
    const rel = 1;
    score += rel / Math.log2(i + 2);
  }
  return score;
}

export function ndcgAtK(
  rankedIds: readonly string[],
  goldRelevantOrdered: readonly string[],
  k: number,
): number {
  const relevant = new Set(goldRelevantOrdered);
  if (relevant.size === 0) return 0;
  const actual = dcgAtK(rankedIds, relevant, k);
  const ideal = dcgAtK(goldRelevantOrdered, relevant, k);
  if (ideal <= 0) return 0;
  return actual / ideal;
}

export function meanNdcgAtK(
  cases: readonly { rankedIds: readonly string[]; gold: StaffingGoldCase }[],
  k: number,
): number {
  if (cases.length === 0) return 0;
  let sum = 0;
  for (const item of cases) {
    sum += ndcgAtK(item.rankedIds, item.gold.relevantIds, k);
  }
  return sum / cases.length;
}

/** Tiny seed gold set for regression (expand later). */
export const STAFFING_GOLD_SEED: readonly StaffingGoldCase[] = [
  {
    id: 'tui-terminal',
    query: 'terminal TUI renderer component typescript',
    relevantIds: ['engineering-terminal-ui-engineer'],
  },
  {
    id: 'security-auth',
    query: 'oauth auth security threat model credentials',
    relevantIds: [], // fill when catalog ids known; empty → nDCG 0 baseline
  },
];
