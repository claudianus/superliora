import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { GraphDatabase, hashContent, openGraphDatabase } from '../persist/graph-db';
import { detectLanguage } from './parser';
import { discoverIndexableFiles, GRAPH_PIPELINE_CONCURRENCY, mapWithConcurrency } from './discovery';
import { extractFileGraph } from './extractor';
import { parseSource } from './parser';
import type { GraphBuildStats } from './types';

interface BuildGraphIndexOptions {
  readonly kaos: Kaos;
  readonly workspace: WorkspaceConfig;
  readonly incremental?: boolean | undefined;
  readonly full?: boolean | undefined;
}

export async function buildGraphIndex({
  kaos,
  workspace,
  incremental = true,
  full = false,
}: BuildGraphIndexOptions): Promise<GraphBuildStats> {
  const started = Date.now();
  const db = openGraphDatabase(workspace);
  if (full) {
    for (const file of db.listFiles()) {
      db.deleteFile(file.displayPath);
    }
  }

  const discovered = await discoverIndexableFiles(kaos, workspace);
  const previous = new Map(db.listFiles().map((file) => [file.path, file]));
  const discoveredPaths = new Set(discovered.map((file) => file.path));

  for (const [path, file] of previous) {
    if (!discoveredPaths.has(path)) {
      db.deleteFile(file.displayPath);
    }
  }

  const toProcess = discovered.filter((file) => {
    if (!incremental || full) return true;
    const prev = previous.get(file.path);
    if (prev === undefined) return true;
    return prev.mtimeMs !== file.mtimeMs || prev.size !== file.size;
  });

  await mapWithConcurrency(toProcess, GRAPH_PIPELINE_CONCURRENCY, async (file) => {
    const content = await kaos.readText(file.path, { errors: 'strict' });
    const contentHash = hashContent(content);
    const prev = previous.get(file.path);
    if (prev !== undefined && prev.contentHash === contentHash && incremental && !full) {
      db.upsertFile({
        path: file.path,
        displayPath: file.displayPath,
        contentHash,
        mtimeMs: file.mtimeMs,
        size: file.size,
        language: detectLanguage(file.displayPath),
      });
      return;
    }
    const tree = await parseSource(file.displayPath, content);
    const graph = extractFileGraph({
      path: file.path,
      displayPath: file.displayPath,
      content,
      tree,
    });
    db.upsertFile({
      path: file.path,
      displayPath: file.displayPath,
      contentHash,
      mtimeMs: file.mtimeMs,
      size: file.size,
      language: detectLanguage(file.displayPath),
    });
    db.replaceFileGraph(file.displayPath, graph.nodes, graph.edges);
  });

  return db.finishBuild(incremental && !full && previous.size > 0, started);
}

export function getGraphIndexStatus(
  workspace: WorkspaceConfig,
  stale = false,
): {
  readonly ready: boolean;
  readonly stale: boolean;
  readonly builtAt: number;
  readonly files: number;
  readonly nodes: number;
  readonly edges: number;
} {
  const db = openGraphDatabase(workspace);
  const stats = db.getStats();
  const builtAt = db.getBuiltAt();
  const workspaceRoot = db.getMeta('workspace_root');
  const rootMismatch = workspaceRoot !== undefined && workspaceRoot !== workspace.workspaceDir;
  return {
    ready: stats.files > 0 && builtAt > 0,
    stale: stale || rootMismatch,
    builtAt,
    files: stats.files,
    nodes: stats.nodes,
    edges: stats.edges,
  };
}

export async function isGraphIndexStale(kaos: Kaos, workspace: WorkspaceConfig): Promise<boolean> {
  const db = openGraphDatabase(workspace);
  const status = getGraphIndexStatus(workspace);
  if (!status.ready) return true;
  const previous = new Map(db.listFiles().map((file) => [file.path, file]));
  const discovered = await discoverIndexableFiles(kaos, workspace);
  if (discovered.length !== previous.size) return true;
  for (const file of discovered) {
    const prev = previous.get(file.path);
    if (prev === undefined) return true;
    if (prev.mtimeMs !== file.mtimeMs || prev.size !== file.size) return true;
  }
  return false;
}

export function getGraphBuiltAt(workspace: WorkspaceConfig): number {
  return openGraphDatabase(workspace).getBuiltAt();
}

export function getGraphDatabase(workspace: WorkspaceConfig): GraphDatabase {
  return openGraphDatabase(workspace);
}
