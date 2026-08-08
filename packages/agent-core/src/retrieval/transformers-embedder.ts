import { mkdirSync } from 'node:fs';
import { join } from 'pathe';

import { resolveLioraHome } from '../config/path';
import { l2Normalize } from './cosine';
import type { EmbeddingProvider } from './types';
import { DEFAULT_EMBED_DIM, DEFAULT_LOCAL_EMBED_MODEL } from './types';

type FeatureExtractionPipeline = (
  texts: string | string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] } | Float32Array>;

/**
 * Local ONNX embedder via `@huggingface/transformers` (lazy model download
 * under `~/.superliora/models`). Ultra-light Granite-97M multilingual by default.
 */
export async function createTransformersEmbedder(input?: {
  readonly modelId?: string;
  readonly dimensions?: number;
  readonly homeDir?: string;
}): Promise<EmbeddingProvider | undefined> {
  const modelId = input?.modelId ?? DEFAULT_LOCAL_EMBED_MODEL;
  const dimensions = input?.dimensions ?? DEFAULT_EMBED_DIM;
  const cacheDir = join(resolveLioraHome(input?.homeDir), 'models', 'transformers');
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

  let pipeline: FeatureExtractionPipeline;
  try {
    const transformers = await import('@huggingface/transformers');
    const { env, pipeline: createPipeline } = transformers as {
      env: { cacheDir?: string; allowLocalModels?: boolean };
      pipeline: (
        task: string,
        model: string,
        options?: { dtype?: string },
      ) => Promise<FeatureExtractionPipeline>;
    };
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    pipeline = await createPipeline('feature-extraction', modelId, { dtype: 'fp32' });
  } catch {
    return undefined;
  }

  return {
    modelId,
    dimensions,
    degraded: false,
    async embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly Float32Array[]> {
      if (signal?.aborted) throw new Error('Embedding aborted');
      if (texts.length === 0) return [];
      const raw = await pipeline([...texts], { pooling: 'mean', normalize: true });
      return splitPipelineOutput(raw, texts.length, dimensions);
    },
  };
}

function splitPipelineOutput(
  raw: { data: Float32Array | number[]; dims?: number[] } | Float32Array,
  count: number,
  dimensions: number,
): Float32Array[] {
  if (raw instanceof Float32Array) {
    if (count === 1) return [l2Normalize(truncateOrPad(raw, dimensions))];
    const out: Float32Array[] = [];
    const stride = Math.floor(raw.length / count);
    for (let i = 0; i < count; i += 1) {
      out.push(l2Normalize(truncateOrPad(raw.subarray(i * stride, (i + 1) * stride), dimensions)));
    }
    return out;
  }

  const data =
    raw.data instanceof Float32Array ? raw.data : Float32Array.from(raw.data ?? []);
  const dims = raw.dims;
  if (dims !== undefined && dims.length >= 2) {
    const rows = dims[0]!;
    const cols = dims[dims.length - 1]!;
    const out: Float32Array[] = [];
    for (let i = 0; i < rows; i += 1) {
      out.push(l2Normalize(truncateOrPad(data.subarray(i * cols, (i + 1) * cols), dimensions)));
    }
    return out;
  }

  if (count === 1) return [l2Normalize(truncateOrPad(data, dimensions))];
  const stride = Math.floor(data.length / count);
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(l2Normalize(truncateOrPad(data.subarray(i * stride, (i + 1) * stride), dimensions)));
  }
  return out;
}

function truncateOrPad(vector: Float32Array, dimensions: number): Float32Array {
  if (vector.length === dimensions) return vector;
  const out = new Float32Array(dimensions);
  out.set(vector.subarray(0, Math.min(vector.length, dimensions)));
  return out;
}
