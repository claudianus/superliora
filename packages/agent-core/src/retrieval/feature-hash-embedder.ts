import { l2Normalize } from './cosine';
import type { EmbeddingProvider } from './types';
import { DEFAULT_EMBED_DIM } from './types';

/**
 * Deterministic bag-of-char-ngrams → fixed-dim vector.
 * Not a neural model — used for tests and degraded offline when ONNX is unavailable.
 */
export function createFeatureHashEmbedder(
  dimensions: number = DEFAULT_EMBED_DIM,
): EmbeddingProvider {
  return {
    modelId: `feature-hash-v1@${String(dimensions)}`,
    dimensions,
    degraded: true,
    async embed(texts: readonly string[]): Promise<readonly Float32Array[]> {
      return texts.map((text) => embedOne(text, dimensions));
    },
  };
}

function embedOne(text: string, dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions);
  const normalized = text.toLowerCase().normalize('NFKC');
  if (normalized.length === 0) return vec;

  for (let i = 0; i < normalized.length; i += 1) {
    const tri =
      normalized.slice(i, i + 3) ||
      normalized.slice(i, i + 2) ||
      normalized.slice(i, i + 1);
    const h = fnv1a(tri);
    const idx = h % dimensions;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign;
  }

  // Light token boost for alphanumeric words (helps English keyword overlap).
  for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3) continue;
    const h = fnv1a(word);
    const idx = h % dimensions;
    vec[idx] = (vec[idx] ?? 0) + 2;
  }

  return l2Normalize(vec);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
