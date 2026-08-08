import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'pathe';

import { resolveLioraHome } from '../config/path';
import type { EmbeddingProvider } from './types';
import { DEFAULT_EMBED_DIM, RETRIEVAL_SCHEMA_VERSION } from './types';

export interface PassageIndexFile {
  readonly schema: typeof RETRIEVAL_SCHEMA_VERSION;
  readonly modelId: string;
  readonly dimensions: number;
  readonly contentHash: string;
  readonly updatedAt: string;
  /** id → base64 float32 little-endian */
  readonly vectors: Record<string, string>;
}

export interface LoadedPassageIndex {
  readonly modelId: string;
  readonly dimensions: number;
  readonly contentHash: string;
  readonly vectors: ReadonlyMap<string, Float32Array>;
}

export function resolvePassageIndexPath(
  kind: 'expert' | 'skill',
  homeDir?: string,
): string {
  return join(resolveLioraHome(homeDir), 'retrieval', `${kind}-passages.v${String(RETRIEVAL_SCHEMA_VERSION)}.json`);
}

export function hashPassageCorpus(passages: ReadonlyMap<string, string>): string {
  // FNV-ish over sorted id+text — good enough for cache invalidation.
  let hash = 0x811c9dc5;
  const ids = [...passages.keys()].toSorted();
  for (const id of ids) {
    const text = passages.get(id) ?? '';
    const chunk = `${id}\0${text}\n`;
    for (let i = 0; i < chunk.length; i += 1) {
      hash ^= chunk.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function buildPassageIndex(
  passages: ReadonlyMap<string, string>,
  embedder: EmbeddingProvider,
  signal?: AbortSignal,
): Promise<LoadedPassageIndex> {
  const ids = [...passages.keys()];
  const texts = ids.map((id) => passages.get(id) ?? '');
  const batchSize = 32;
  const vectors = new Map<string, Float32Array>();
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    if (signal?.aborted) throw new Error('Passage index build aborted');
    const sliceTexts = texts.slice(offset, offset + batchSize);
    const sliceIds = ids.slice(offset, offset + batchSize);
    const embedded = await embedder.embed(sliceTexts, signal);
    for (let i = 0; i < sliceIds.length; i += 1) {
      const vector = embedded[i];
      if (vector !== undefined) vectors.set(sliceIds[i]!, vector);
    }
  }
  return {
    modelId: embedder.modelId,
    dimensions: embedder.dimensions,
    contentHash: hashPassageCorpus(passages),
    vectors,
  };
}

export function savePassageIndex(path: string, index: LoadedPassageIndex): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const vectors: Record<string, string> = {};
  for (const [id, vector] of index.vectors) {
    vectors[id] = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString(
      'base64',
    );
  }
  const file: PassageIndexFile = {
    schema: RETRIEVAL_SCHEMA_VERSION,
    modelId: index.modelId,
    dimensions: index.dimensions,
    contentHash: index.contentHash,
    updatedAt: new Date().toISOString(),
    vectors,
  };
  writeFileSync(path, `${JSON.stringify(file)}\n`, 'utf8');
}

export function loadPassageIndex(path: string): LoadedPassageIndex | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PassageIndexFile;
    if (parsed.schema !== RETRIEVAL_SCHEMA_VERSION) return undefined;
    const dimensions = parsed.dimensions ?? DEFAULT_EMBED_DIM;
    const vectors = new Map<string, Float32Array>();
    for (const [id, b64] of Object.entries(parsed.vectors ?? {})) {
      const buf = Buffer.from(b64, 'base64');
      const vector = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        Math.floor(buf.byteLength / Float32Array.BYTES_PER_ELEMENT),
      );
      if (vector.length === dimensions) vectors.set(id, vector);
    }
    return {
      modelId: parsed.modelId,
      dimensions,
      contentHash: parsed.contentHash,
      vectors,
    };
  } catch {
    return undefined;
  }
}

export function expertPassageText(input: {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly tags?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly vibe?: string;
}): string {
  return [
    input.name,
    input.description,
    input.whenToUse ?? '',
    (input.tags ?? []).join(' '),
    (input.capabilities ?? []).join(' '),
    input.vibe ?? '',
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

export function skillPassageText(input: {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly headings?: string;
}): string {
  return [input.name, input.description, input.whenToUse ?? '', input.headings ?? '']
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

/** Stable cache key for catalog skills (absolute SKILL.md paths are machine-local). */
export function skillCatalogPassageId(entry: {
  readonly catalogId?: string | undefined;
  readonly relDir: string;
  readonly name: string;
}): string {
  const catalogId = entry.catalogId?.trim();
  if (catalogId !== undefined && catalogId.length > 0) return catalogId;
  return `rel:${entry.relDir}:${entry.name}`;
}

export function skillDefinitionPassageId(skill: {
  readonly name: string;
  readonly metadata: Record<string, unknown>;
  readonly dir?: string | undefined;
}): string | undefined {
  const catalogId = skill.metadata['catalogId'];
  if (typeof catalogId === 'string' && catalogId.trim().length > 0) return catalogId.trim();
  const relDir = skill.metadata['catalogRelDir'];
  if (typeof relDir === 'string' && relDir.trim().length > 0) {
    return skillCatalogPassageId({ relDir: relDir.trim(), name: skill.name });
  }
  return undefined;
}
