import { STAFFING_GOLD_SEED, meanNdcgAtK, ndcgAtK } from '../src/expert-agents/staffing-gold';
import { ExpertSearchEngine } from '../src/expert-agents/search';

const K = 10;
const engine = new ExpertSearchEngine();
await engine.initialize();

const scored: { rankedIds: readonly string[]; gold: (typeof STAFFING_GOLD_SEED)[number] }[] = [];
const weak: { id: string; score: number; top: string[]; gold: readonly string[] }[] = [];

for (const gold of STAFFING_GOLD_SEED) {
  if (gold.relevantIds.length === 0) continue;
  const hits = engine.search({ query: gold.query, topK: K, useEmbedding: false });
  const rankedIds = hits.map((h) => h.expert.id);
  const score = ndcgAtK(rankedIds, gold.relevantIds, K);
  scored.push({ rankedIds, gold });
  weak.push({ id: gold.id, score, top: rankedIds.slice(0, 5), gold: gold.relevantIds });
}

weak.sort((a, b) => a.score - b.score);
const mean = meanNdcgAtK(scored, K);
console.log(JSON.stringify({ cases: scored.length, meanNdcgAt10: mean, weakest: weak.slice(0, 12) }, null, 2));
