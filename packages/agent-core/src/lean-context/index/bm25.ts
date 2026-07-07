import type { Bm25ChunkRecord, Bm25IndexData, Bm25SearchHit } from '../persist/types';
import { termFrequency, tokenize } from './tokenize';

const K1 = 1.2;
const B = 0.75;

export function buildBm25Index(chunks: readonly Bm25ChunkRecord[]): Bm25IndexData {
  const chunkTerms: Record<string, number>[] = [];
  // Null-prototype map: tokens like "constructor" must not collide with Object.prototype.
  const inverted: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  let totalLength = 0;

  for (const [index, chunk] of chunks.entries()) {
    const tf = termFrequency(tokenize(`${chunk.displayPath} ${chunk.text}`));
    chunkTerms.push(tf);
    totalLength += chunk.length;
    for (const term of Object.keys(tf)) {
      const bucket = inverted[term] ?? [];
      bucket.push(index);
      inverted[term] = bucket;
    }
  }

  return {
    version: 1,
    avgChunkLength: chunks.length === 0 ? 0 : totalLength / chunks.length,
    chunkCount: chunks.length,
    chunks,
    inverted,
    chunkTerms,
  };
}

export function searchBm25(index: Bm25IndexData, query: string, limit = 20): readonly Bm25SearchHit[] {
  if (index.chunkCount === 0) return [];
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const scores = new Map<number, number>();
  const N = index.chunkCount;
  const avgdl = index.avgChunkLength || 1;

  for (const term of terms) {
    if (!Object.hasOwn(index.inverted, term)) continue;
    const postings = index.inverted[term];
    if (postings === undefined) continue;
    const df = postings.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const chunkIndex of postings) {
      const chunk = index.chunks[chunkIndex];
      const tfMap = index.chunkTerms[chunkIndex];
      if (chunk === undefined || tfMap === undefined) continue;
      const tf = tfMap[term] ?? 0;
      const denom = tf + K1 * (1 - B + (B * chunk.length) / avgdl);
      const score = idf * ((tf * (K1 + 1)) / denom);
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + score);
    }
  }

  return [...scores.entries()]
    .map(([chunkIndex, score]) => {
      const chunk = index.chunks[chunkIndex];
      return chunk === undefined ? undefined : { chunk, score };
    })
    .filter((hit): hit is Bm25SearchHit => hit !== undefined)
    .toSorted((a, b) => b.score - a.score || a.chunk.displayPath.localeCompare(b.chunk.displayPath))
    .slice(0, limit);
}

export function topPathsFromHits(hits: readonly Bm25SearchHit[], limit = 20): readonly string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.chunk.path)) continue;
    seen.add(hit.chunk.path);
    paths.push(hit.chunk.path);
    if (paths.length >= limit) break;
  }
  return paths;
}
