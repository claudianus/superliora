import { rankByCosine } from './cosine';
import { fuseSparseDenseRrf } from './rrf';
import type {
  DenseHit,
  EmbeddingProvider,
  HybridSearchInput,
  HybridSearchResult,
} from './types';

const DEFAULT_TOP_K = 5;
const DEFAULT_DENSE_CANDIDATES = 48;

/**
 * Fuse MiniSearch sparse hits with local dense cosine (precomputed vectors or
 * on-the-fly embed of sparse candidates).
 */
export class HybridRetriever {
  constructor(private readonly embedder: EmbeddingProvider) {}

  get modelId(): string {
    return this.embedder.modelId;
  }

  get degraded(): boolean {
    return this.embedder.degraded === true;
  }

  async search(input: HybridSearchInput): Promise<HybridSearchResult> {
    const topK = input.topK ?? DEFAULT_TOP_K;
    const candidateLimit = input.denseCandidateLimit ?? DEFAULT_DENSE_CANDIDATES;
    const sparse = input.sparseHits;

    let dense: DenseHit[] = [];
    try {
      dense = await this.denseRank(input, candidateLimit, Math.max(topK * 3, candidateLimit));
    } catch {
      dense = [];
    }

    if (dense.length === 0) {
      return {
        hits: sparse.slice(0, topK).map((h) => ({
          id: h.id,
          score: h.score,
          matchReason: 'sparse' as const,
        })),
        degraded: true,
        modelId: this.embedder.modelId,
      };
    }

    const fused = fuseSparseDenseRrf(sparse, dense, topK);
    return {
      hits: fused,
      degraded: this.embedder.degraded === true,
      modelId: this.embedder.modelId,
    };
  }

  private async denseRank(
    input: HybridSearchInput,
    candidateLimit: number,
    topK: number,
  ): Promise<DenseHit[]> {
    const [queryVector] = await this.embedder.embed([input.query], input.signal);
    if (queryVector === undefined) return [];

    const precomputed = input.vectors;
    if (precomputed !== undefined && precomputed.size > 0) {
      return rankByCosine(queryVector, precomputed, topK);
    }

    // No full index: embed sparse candidates (+ any leftover passage ids) on the fly.
    const candidateIds: string[] = [];
    const seen = new Set<string>();
    for (const hit of input.sparseHits) {
      if (seen.has(hit.id)) continue;
      if (!input.passages.has(hit.id)) continue;
      seen.add(hit.id);
      candidateIds.push(hit.id);
      if (candidateIds.length >= candidateLimit) break;
    }
    if (candidateIds.length === 0) {
      for (const id of input.passages.keys()) {
        if (seen.has(id)) continue;
        seen.add(id);
        candidateIds.push(id);
        if (candidateIds.length >= candidateLimit) break;
      }
    }
    if (candidateIds.length === 0) return [];

    const texts = candidateIds.map((id) => input.passages.get(id) ?? '');
    const vectors = await this.embedder.embed(texts, input.signal);
    const map = new Map<string, Float32Array>();
    for (let i = 0; i < candidateIds.length; i += 1) {
      const vector = vectors[i];
      if (vector !== undefined) map.set(candidateIds[i]!, vector);
    }
    return rankByCosine(queryVector, map, topK);
  }
}
