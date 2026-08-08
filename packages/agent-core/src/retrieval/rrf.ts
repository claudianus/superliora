import type { DenseHit, HybridHit, SparseHit } from './types';

/**
 * Reciprocal rank fusion of sparse + dense lists.
 * Sparse keeps a mild score blend (MiniSearch magnitude); dense is rank-only.
 */
export function fuseSparseDenseRrf(
  sparse: readonly SparseHit[],
  dense: readonly DenseHit[],
  topK: number,
  k = 60,
): HybridHit[] {
  const scores = new Map<string, number>();
  const reasons = new Map<string, HybridHit['matchReason']>();

  const maxSparse = sparse.length > 0 ? Math.max(...sparse.map((h) => h.score), 1e-9) : 1;

  for (let i = 0; i < sparse.length; i += 1) {
    const hit = sparse[i]!;
    const rankScore = 1 / (k + i + 1);
    const norm = hit.score / maxSparse;
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + rankScore * 0.6 + norm * 0.4);
    reasons.set(hit.id, 'sparse');
  }

  for (let i = 0; i < dense.length; i += 1) {
    const hit = dense[i]!;
    const rankScore = 1 / (k + i + 1);
    const prev = scores.get(hit.id);
    // Dense cosine (already in [0,1]) carries real semantic weight — not rank-only.
    scores.set(hit.id, (prev ?? 0) + rankScore * 0.45 + hit.score * 0.55);
    reasons.set(hit.id, prev === undefined ? 'dense' : 'rrf');
  }

  return [...scores.entries()]
    .map(([id, score]) => ({
      id,
      score,
      matchReason: reasons.get(id) ?? 'rrf',
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, topK);
}
