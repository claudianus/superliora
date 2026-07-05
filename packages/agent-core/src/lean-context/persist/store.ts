import type { Kaos } from '@superliora/kaos';

import type { Bm25IndexData, GraphIndexData, IndexManifest } from './types';
import { bm25Path, graphPath, manifestPath } from './paths';

export async function readJsonFile<T>(kaos: Kaos, path: string): Promise<T | undefined> {
  try {
    const text = await kaos.readText(path, { errors: 'strict' });
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(kaos: Kaos, path: string, value: unknown): Promise<void> {
  const slash = path.lastIndexOf('/');
  if (slash > 0) {
    await kaos.mkdir(path.slice(0, slash), { parents: true });
  }
  await kaos.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadManifest(kaos: Kaos, indexDir: string): Promise<IndexManifest | undefined> {
  return readJsonFile<IndexManifest>(kaos, manifestPath(indexDir));
}

export async function loadBm25Index(kaos: Kaos, indexDir: string): Promise<Bm25IndexData | undefined> {
  return readJsonFile<Bm25IndexData>(kaos, bm25Path(indexDir));
}

export async function loadGraphIndex(kaos: Kaos, indexDir: string): Promise<GraphIndexData | undefined> {
  return readJsonFile<GraphIndexData>(kaos, graphPath(indexDir));
}

export async function saveIndexArtifacts(
  kaos: Kaos,
  indexDir: string,
  manifest: IndexManifest,
  bm25: Bm25IndexData,
  graph: GraphIndexData,
): Promise<void> {
  await kaos.mkdir(indexDir, { parents: true });
  await writeJsonFile(kaos, manifestPath(indexDir), manifest);
  await writeJsonFile(kaos, bm25Path(indexDir), bm25);
  await writeJsonFile(kaos, graphPath(indexDir), graph);
}
