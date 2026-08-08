/**
 * Shared semantic retrieval contracts for SearchExpert / SearchSkill.
 * Local ultra-light embedders only — no cloud embedding APIs.
 */

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  /** True when this is a non-SOTA fallback (feature-hash, etc.). */
  readonly degraded?: boolean;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly Float32Array[]>;
}

export interface PassageRecord {
  readonly id: string;
  readonly text: string;
  readonly vector?: Float32Array | undefined;
}

export interface SparseHit {
  readonly id: string;
  readonly score: number;
}

export interface DenseHit {
  readonly id: string;
  readonly score: number;
}

export interface HybridHit {
  readonly id: string;
  readonly score: number;
  readonly matchReason: 'sparse' | 'dense' | 'rrf';
}

export interface HybridSearchInput {
  readonly query: string;
  readonly sparseHits: readonly SparseHit[];
  /** Full corpus texts (dense over all, or candidates when index vectors missing). */
  readonly passages: ReadonlyMap<string, string>;
  /** Optional precomputed vectors keyed by id (same dim as embedder). */
  readonly vectors?: ReadonlyMap<string, Float32Array> | undefined;
  readonly topK?: number;
  /** When vectors missing, embed at most this many sparse candidates for dense. */
  readonly denseCandidateLimit?: number;
  readonly signal?: AbortSignal;
}

export interface HybridSearchResult {
  readonly hits: readonly HybridHit[];
  readonly degraded: boolean;
  readonly modelId: string;
}

export const RETRIEVAL_SCHEMA_VERSION = 1 as const;
/** Default local ultra-light multilingual model (ONNX via transformers.js). */
export const DEFAULT_LOCAL_EMBED_MODEL =
  'onnx-community/granite-embedding-97m-multilingual-r2-ONNX' as const;
export const DEFAULT_EMBED_DIM = 384 as const;
