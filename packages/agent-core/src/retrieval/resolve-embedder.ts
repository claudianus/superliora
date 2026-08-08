import { createFeatureHashEmbedder } from './feature-hash-embedder';
import { createTransformersEmbedder } from './transformers-embedder';
import type { EmbeddingProvider } from './types';
import { DEFAULT_EMBED_DIM, DEFAULT_LOCAL_EMBED_MODEL } from './types';

let cached: Promise<EmbeddingProvider> | undefined;

/**
 * Prefer local Granite-97M ONNX via transformers.js; fall back to feature-hash
 * (degraded) so search never hard-fails offline.
 *
 * Force degraded: `SUPERLIORA_RETRIEVAL_EMBEDDER=hash`
 * Force model id: `SUPERLIORA_RETRIEVAL_MODEL=…`
 */
export function resolveEmbeddingProvider(input?: {
  readonly forceHash?: boolean;
  readonly homeDir?: string;
  readonly modelId?: string;
}): Promise<EmbeddingProvider> {
  // CI / explicit hash: keep tests and gates offline and fast (no model download).
  const envMode = process.env['SUPERLIORA_RETRIEVAL_EMBEDDER']?.trim().toLowerCase();
  const ci = process.env['CI'] === 'true' || process.env['CI'] === '1';
  if (input?.forceHash === true || envMode === 'hash' || (ci && envMode !== 'transformers')) {
    return Promise.resolve(createFeatureHashEmbedder(DEFAULT_EMBED_DIM));
  }

  if (cached === undefined || input?.modelId !== undefined || input?.homeDir !== undefined) {
    const pending = resolvePreferTransformers(input);
    if (input?.modelId === undefined && input?.homeDir === undefined) {
      cached = pending;
    }
    return pending;
  }
  return cached;
}

/** Test helper — drop process-wide cache. */
export function resetEmbeddingProviderCacheForTests(): void {
  cached = undefined;
}

async function resolvePreferTransformers(input?: {
  readonly homeDir?: string;
  readonly modelId?: string;
}): Promise<EmbeddingProvider> {
  const modelId =
    input?.modelId ??
    process.env['SUPERLIORA_RETRIEVAL_MODEL']?.trim() ??
    DEFAULT_LOCAL_EMBED_MODEL;
  const neural = await createTransformersEmbedder({
    modelId,
    dimensions: DEFAULT_EMBED_DIM,
    homeDir: input?.homeDir,
  });
  if (neural !== undefined) return neural;
  return createFeatureHashEmbedder(DEFAULT_EMBED_DIM);
}
