/** L2-normalize in place (or copy) and return cosine similarity. */

export function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i]!;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (norm <= 0 || !Number.isFinite(norm)) {
    return new Float32Array(vector.length);
  }
  const out = new Float32Array(vector.length);
  const inv = 1 / norm;
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = vector[i]! * inv;
  }
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank corpus vectors by cosine vs query; scores clipped to [0, 1] via (sim+1)/2. */
export function rankByCosine(
  query: Float32Array,
  vectors: ReadonlyMap<string, Float32Array>,
  topK: number,
): { readonly id: string; readonly score: number }[] {
  const scored: { id: string; score: number }[] = [];
  for (const [id, vector] of vectors) {
    if (vector.length !== query.length) continue;
    const sim = cosineSimilarity(query, vector);
    scored.push({ id, score: (sim + 1) / 2 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
