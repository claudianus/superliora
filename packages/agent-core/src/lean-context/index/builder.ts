import type { Kaos } from '@superliora/kaos';

import { collectContextFiles } from '../../tools/builtin/context/context-discovery';
import type { WorkspaceConfig } from '../../tools/support/workspace';
import { isLeanCodegraphV2Enabled } from '../graph/enabled';
import { buildGraphIndex, getGraphIndexStatus, isGraphIndexStale } from '../graph/pipeline';
import { workspaceIndexDir } from '../persist/paths';
import { loadBm25Index, loadGraphIndex, loadManifest, saveIndexArtifacts } from '../persist/store';
import type {
  GraphIndexData,
  ImportGraphEdge,
  IndexBuildStats,
  IndexFileState,
  IndexManifest,
  IndexStatus,
} from '../persist/types';
import { LEAN_CONTEXT_INDEX_VERSION } from '../persist/types';
import { buildBm25Index } from './bm25';
import { chunkFileContent, extractImportEdges } from './chunk';

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

interface BuildWorkspaceIndexOptions {
  readonly kaos: Kaos;
  readonly workspace: WorkspaceConfig;
  readonly incremental?: boolean | undefined;
}

export async function buildWorkspaceIndex({
  kaos,
  workspace,
  incremental = true,
}: BuildWorkspaceIndexOptions): Promise<IndexBuildStats> {
  if (isLeanCodegraphV2Enabled()) {
    const stats = await buildGraphIndex({ kaos, workspace, incremental, full: !incremental });
    return {
      filesIndexed: stats.filesIndexed,
      chunksIndexed: stats.nodesIndexed,
      edgesIndexed: stats.edgesIndexed,
      incremental: stats.incremental,
      durationMs: stats.durationMs,
    };
  }
  return buildWorkspaceIndexV1({ kaos, workspace, incremental });
}

async function buildWorkspaceIndexV1({
  kaos,
  workspace,
  incremental = true,
}: BuildWorkspaceIndexOptions): Promise<IndexBuildStats> {
  const started = Date.now();
  const indexDir = workspaceIndexDir(workspace);
  const previousManifest = incremental ? await loadManifest(kaos, indexDir) : undefined;
  const previousBm25 = incremental ? await loadBm25Index(kaos, indexDir) : undefined;
  const previousGraph = incremental ? await loadGraphIndex(kaos, indexDir) : undefined;

  const discovered = await collectContextFiles({ kaos, workspace });
  const nextFiles: Record<string, IndexFileState> = {};
  const changedPaths: string[] = [];

  for (const file of discovered) {
    const stat = await kaos.stat(file.path);
    const state: IndexFileState = { mtimeMs: stat.stMtime, size: stat.stSize };
    nextFiles[file.path] = state;
    const previous = previousManifest?.files[file.path];
    if (
      previous === undefined ||
      previous.mtimeMs !== state.mtimeMs ||
      previous.size !== state.size
    ) {
      changedPaths.push(file.path);
    }
  }

  const retainedChunks =
    incremental && previousBm25 !== undefined
      ? previousBm25.chunks.filter((chunk) => {
          const state = nextFiles[chunk.path];
          return state !== undefined && !changedPaths.includes(chunk.path);
        })
      : [];

  const retainedEdges =
    incremental && previousGraph !== undefined
      ? previousGraph.edges.filter((edge) => {
          const file = discovered.find((item) => item.displayPath === edge.from);
          return file !== undefined && !changedPaths.includes(file.path);
        })
      : [];

  const newChunks = [];
  const newEdges: ImportGraphEdge[] = [];
  for (const file of discovered) {
    if (incremental && previousManifest !== undefined && !changedPaths.includes(file.path)) continue;
    newChunks.push(...chunkFileContent(file.path, file.displayPath, file.content));
    for (const edge of extractImportEdges(file.displayPath, file.content)) {
      newEdges.push(edge);
    }
  }

  const chunks = [...retainedChunks, ...newChunks];
  const edges = [...retainedEdges, ...newEdges];
  const bm25 = buildBm25Index(chunks);
  const graph: GraphIndexData = { version: LEAN_CONTEXT_INDEX_VERSION, edges };
  const manifest: IndexManifest = {
    version: LEAN_CONTEXT_INDEX_VERSION,
    workspaceRoot: workspace.workspaceDir,
    builtAt: Date.now(),
    files: nextFiles,
  };

  await saveIndexArtifacts(kaos, indexDir, manifest, bm25, graph);
  return {
    filesIndexed: discovered.length,
    chunksIndexed: chunks.length,
    edgesIndexed: edges.length,
    incremental: incremental && previousManifest !== undefined,
    durationMs: Date.now() - started,
  };
}

export async function getIndexStatus(kaos: Kaos, workspace: WorkspaceConfig): Promise<IndexStatus> {
  if (isLeanCodegraphV2Enabled()) {
    const stale = await isGraphIndexStale(kaos, workspace);
    const status = getGraphIndexStatus(workspace, stale);
    return {
      ready: status.ready,
      stale: status.stale,
      manifest: undefined,
      chunkCount: status.nodes,
      edgeCount: status.edges,
      indexDir: workspaceIndexDir(workspace),
    };
  }
  const indexDir = workspaceIndexDir(workspace);
  const manifest = await loadManifest(kaos, indexDir);
  const bm25 = await loadBm25Index(kaos, indexDir);
  const graph = await loadGraphIndex(kaos, indexDir);
  const stale = manifest === undefined ? true : await isManifestStale(kaos, workspace, manifest);
  return {
    ready: manifest !== undefined && bm25 !== undefined,
    stale,
    manifest,
    chunkCount: bm25?.chunkCount ?? 0,
    edgeCount: graph?.edges.length ?? 0,
    indexDir,
  };
}

async function isManifestStale(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  manifest: IndexManifest,
): Promise<boolean> {
  if (manifest.workspaceRoot !== workspace.workspaceDir) return true;
  let checked = 0;
  for (const [path, state] of Object.entries(manifest.files)) {
    if (checked >= 32) break;
    checked += 1;
    try {
      const stat = await kaos.stat(path);
      if (!isRegularFile(stat.stMode)) return true;
      if (stat.stMtime !== state.mtimeMs || stat.stSize !== state.size) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function isRegularFile(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFREG;
}
