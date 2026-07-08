import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { GraphDatabase, hashContent, openGraphDatabase } from '../persist/graph-db';
import { bm25Path, graphPath, manifestPath, workspaceIndexDir } from '../persist/paths';
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

  // Discovery is read-only filesystem work; keep it out of the write
  // transaction so the connection isn't holding a write lock while we walk
  // and parse (which is where most of the wall time goes).
  const discovered = await discoverIndexableFiles(kaos, workspace);
  const previous = new Map(db.listFiles().map((file) => [file.path, file]));
  const discoveredPaths = new Set(discovered.map((file) => file.path));

  // Determine what changed before opening the transaction.
  const toProcess = discovered.filter((file) => {
    if (!incremental || full) return true;
    const prev = previous.get(file.path);
    if (prev === undefined) return true;
    return prev.mtimeMs !== file.mtimeMs || prev.size !== file.size;
  });

  // Parse the changed files outside the transaction too — tree-sitter is
  // CPU-bound and has no DB dependency, so we only enter the transaction to
  // apply the parsed results.
  const parsed = await mapWithConcurrency(toProcess, GRAPH_PIPELINE_CONCURRENCY, async (file) => {
    const content = await kaos.readText(file.path, { errors: 'strict' });
    const contentHash = hashContent(content);
    const prev = previous.get(file.path);
    if (prev !== undefined && prev.contentHash === contentHash && incremental && !full) {
      return {
        file,
        contentHash,
        upsertOnly: true as const,
        language: detectLanguage(file.displayPath),
      };
    }
    const tree = await parseSource(file.displayPath, content);
    const graph = extractFileGraph({
      path: file.path,
      displayPath: file.displayPath,
      content,
      tree,
    });
    return {
      file,
      contentHash,
      upsertOnly: false as const,
      language: detectLanguage(file.displayPath),
      graph,
    };
  });

  // All DB mutations happen inside one transaction so the FTS5 shadow writes
  // and node/edge inserts commit (and fsync) once. If anything throws, we
  // ROLLBACK and the previous committed state is preserved — this is what
  // breaks the "empty index → full rebuild → interrupted → empty index" loop.
  db.beginTransaction();
  try {
    if (full) {
      for (const file of db.listFiles()) {
        db.deleteFile(file.displayPath);
      }
    }
    for (const [path, file] of previous) {
      if (!discoveredPaths.has(path)) {
        db.deleteFile(file.displayPath);
      }
    }
    for (const entry of parsed) {
      db.upsertFile({
        path: entry.file.path,
        displayPath: entry.file.displayPath,
        contentHash: entry.contentHash,
        mtimeMs: entry.file.mtimeMs,
        size: entry.file.size,
        language: entry.language,
      });
      if (!entry.upsertOnly) {
        db.replaceFileGraph(entry.file.displayPath, entry.graph.nodes, entry.graph.edges);
      }
    }
    const stats = db.finishBuild(incremental && !full && previous.size > 0, started);
    db.commitTransaction();
    // The V2 engine stores everything in SQLite; the legacy V1 JSON artifacts
    // (bm25.json alone can be tens of MB) are now dead weight and are still
    // parsed by the V1 fallback path if left around. Remove them once the V2
    // index has rows so subsequent loads don't pay for stale data.
    if (stats.filesIndexed > 0) {
      const indexDir = workspaceIndexDir(workspace);
      await Promise.allSettled([
        kaos.unlink(bm25Path(indexDir)),
        kaos.unlink(graphPath(indexDir)),
        kaos.unlink(manifestPath(indexDir)),
      ]);
    }
    return stats;
  } catch (error) {
    try {
      db.rollbackTransaction();
    } catch {
      // Swallow rollback failure so the original error surfaces cleanly.
    }
    throw error;
  }
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

const STALENESS_SAMPLE_LIMIT = 128;

export async function isGraphIndexStale(kaos: Kaos, workspace: WorkspaceConfig): Promise<boolean> {
  const db = openGraphDatabase(workspace);
  const status = getGraphIndexStatus(workspace);
  if (!status.ready) return true;
  // Cheap path: stat a bounded sample of indexed files and compare mtime/size.
  // A full re-walk on every status check made ensureWorkspaceIndex walk the
  // whole tree up to three times per call, which is where callers saw the
  // bulk of the latency even on an up-to-date index. The real build still
  // walks everything, so a missed change here gets corrected on the next
  // build that is actually triggered.
  const previous = db.listFiles();
  if (previous.length === 0) return true;
  const sample = previous.length <= STALENESS_SAMPLE_LIMIT
    ? previous
    : sampleSubset(previous, STALENESS_SAMPLE_LIMIT);
  for (const file of sample) {
    try {
      const stat = await kaos.stat(file.path);
      if (stat.stMtime !== file.mtimeMs || stat.stSize !== file.size) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function getGraphBuiltAt(workspace: WorkspaceConfig): number {
  return openGraphDatabase(workspace).getBuiltAt();
}

export function getGraphDatabase(workspace: WorkspaceConfig): GraphDatabase {
  return openGraphDatabase(workspace);
}

/**
 * Pick `count` items from `items` via a partial Fisher-Yates shuffle. Unlike
 * `.sort(() => Math.random() - 0.5)` (which is engine-dependent and biased),
 * this yields a uniformly random subset without shuffling the whole array.
 */
function sampleSubset<T>(items: readonly T[], count: number): T[] {
  const pool = items.slice();
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const picked = pool[j];
    if (picked !== undefined) {
      pool[j] = pool[i];
      pool[i] = picked;
    }
  }
  return pool.slice(0, n);
}
