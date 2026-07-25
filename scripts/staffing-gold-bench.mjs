#!/usr/bin/env node
/**
 * Offline staffing gold nDCG@k report.
 *
 *   pnpm exec tsx scripts/staffing-gold-bench.mjs
 *   pnpm exec tsx scripts/staffing-gold-bench.mjs --k 5 --min-mean 0.05
 *
 * Exit 1 when mean nDCG@k is below threshold.
 */

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseArgs(argv) {
  let k = 5;
  let minMean = 0.05;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--k' && argv[i + 1] !== undefined) k = Number(argv[++i]);
    else if (a === '--min-mean' && argv[i + 1] !== undefined) minMean = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: pnpm exec tsx scripts/staffing-gold-bench.mjs [--k 5] [--min-mean 0.05]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(k) || k < 1) throw new Error(`invalid --k: ${String(k)}`);
  if (!Number.isFinite(minMean) || minMean < 0) throw new Error(`invalid --min-mean: ${String(minMean)}`);
  return { k, minMean };
}

async function main() {
  const { k, minMean } = parseArgs(process.argv.slice(2));

  const goldMod = await import(
    pathToFileURL(join(root, 'packages/agent-core/src/expert-agents/staffing-gold.ts')).href
  );
  const searchMod = await import(
    pathToFileURL(join(root, 'packages/agent-core/src/expert-agents/search.ts')).href
  );

  const { STAFFING_GOLD_SEED, ndcgAtK, meanNdcgAtK } = goldMod;
  const { globalExpertSearchEngine } = searchMod;

  await globalExpertSearchEngine.initialize();

  const rows = [];
  for (const gold of STAFFING_GOLD_SEED) {
    const hits = globalExpertSearchEngine.search({ query: gold.query, topK: k });
    const rankedIds = hits.map((h) => h.expert.id);
    const score = ndcgAtK(rankedIds, gold.relevantIds, k);
    rows.push({
      id: gold.id,
      query: gold.query,
      ndcg: score,
      rankedIds,
      relevantIds: [...gold.relevantIds],
    });
  }

  const mean = meanNdcgAtK(
    rows.map((r) => ({
      rankedIds: r.rankedIds,
      gold: { id: r.id, query: r.query, relevantIds: r.relevantIds },
    })),
    k,
  );

  console.log(JSON.stringify({ k, meanNdcg: mean, minMean, cases: rows }, null, 2));
  console.error(`\nmean nDCG@${k} = ${mean.toFixed(4)} (threshold ${minMean})`);

  if (mean < minMean) {
    console.error(`FAIL: mean nDCG@${k} ${mean.toFixed(4)} < ${minMean}`);
    process.exit(1);
  }
  console.error(`PASS: mean nDCG@${k} ${mean.toFixed(4)} >= ${minMean}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
