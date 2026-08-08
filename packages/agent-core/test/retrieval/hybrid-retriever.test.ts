import { describe, expect, it } from 'vitest';

import {
  createFeatureHashEmbedder,
  fuseSparseDenseRrf,
  HybridRetriever,
  l2Normalize,
} from '../../src/retrieval';

describe('HybridRetriever', () => {
  it('ranks precomputed vectors by cosine against the query embedding', async () => {
    const queryLike = Float32Array.from([1, 0, 0, 0]);
    const stub = {
      modelId: 'stub',
      dimensions: 4,
      degraded: true as const,
      async embed(): Promise<readonly Float32Array[]> {
        return [queryLike];
      },
    };
    const result = await new HybridRetriever(stub).search({
      query: 'keyboard focus',
      sparseHits: [
        { id: 'sales', score: 2 },
        { id: 'a11y', score: 2 },
      ],
      passages: new Map([
        ['a11y', 'accessibility'],
        ['sales', 'sales'],
      ]),
      vectors: new Map([
        ['a11y', queryLike],
        ['sales', Float32Array.from([0, 1, 0, 0])],
      ]),
      topK: 2,
    });

    expect(result.hits[0]?.id).toBe('a11y');
    expect(result.hits.map((h) => h.id)).toContain('sales');
  });

  it('rrf marks ids present in both lists as rrf', () => {
    const fused = fuseSparseDenseRrf(
      [
        { id: 'a', score: 10 },
        { id: 'b', score: 5 },
      ],
      [
        { id: 'b', score: 0.9 },
        { id: 'c', score: 0.8 },
      ],
      5,
    );
    expect(fused.find((h) => h.id === 'b')?.matchReason).toBe('rrf');
    expect(fused.find((h) => h.id === 'c')?.matchReason).toBe('dense');
  });

  it('l2Normalize yields unit vectors', () => {
    const v = l2Normalize(Float32Array.from([3, 4]));
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1, 5);
  });
});
