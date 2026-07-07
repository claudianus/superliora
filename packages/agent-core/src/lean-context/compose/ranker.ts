import type { Kaos } from '@superliora/kaos';

import { collectContextFiles } from '../../tools/builtin/context/context-discovery';
import type { RankedFile } from '../../tools/builtin/context/context-types';
import { rankContextFiles } from '../../tools/builtin/context/context-symbols';
import type { WorkspaceConfig } from '../../tools/support/workspace';
import { isLeanCodegraphV2Enabled } from '../graph/enabled';
import { getGraphDatabase } from '../graph/pipeline';
import { topIndexedPaths } from '../graph/search';
import { ensureWorkspaceIndex } from '../index/ensure';
import { searchBm25 } from '../index/bm25';
import {
  graphNeighbors,
  loadWorkspaceBm25,
  loadWorkspaceGraph,
  queryIndexedPathsFromBm25,
} from '../index/builder';
import { assembleContextPacket } from './assembler';

export interface ComposeRankInput {
  readonly kaos: Kaos;
  readonly workspace: WorkspaceConfig;
  readonly query: string;
  readonly maxFiles?: number | undefined;
  readonly maxSymbolsPerFile?: number | undefined;
}

export interface ComposeRankResult {
  readonly ranked: readonly RankedFile[];
  readonly allFiles: readonly { path: string; displayPath: string; content: string; lineCount: number }[];
  readonly indexUsed: boolean;
  readonly indexStaleHint?: string | undefined;
  readonly strategy?: string | undefined;
}

export async function composeRankContext(input: ComposeRankInput): Promise<ComposeRankResult> {
  if (isLeanCodegraphV2Enabled()) {
    return composeRankContextV2(input);
  }
  return composeRankContextV1(input);
}

async function composeRankContextV2(input: ComposeRankInput): Promise<ComposeRankResult> {
  const ensured = await ensureWorkspaceIndex(input.kaos, input.workspace);
  const db = getGraphDatabase(input.workspace);
  const assembled = await assembleContextPacket({
    kaos: input.kaos,
    workspace: input.workspace,
    db,
    query: input.query,
    maxFiles: input.maxFiles,
    maxSymbolsPerFile: input.maxSymbolsPerFile,
  });
  if (assembled.ranked.length === 0) {
    return composeRankContextV1(input);
  }
  return {
    ranked: assembled.ranked,
    allFiles: assembled.allFiles,
    indexUsed: assembled.indexUsed,
    indexStaleHint:
      ensured.ready || assembled.ranked.length > 0
        ? ensured.built
          ? 'index_auto_built'
          : undefined
        : 'index_unavailable — LioraIndex action=build may be required',
    strategy: 'lean-codegraph-v2',
  };
}

async function composeRankContextV1(input: ComposeRankInput): Promise<ComposeRankResult> {
  const ensured = await ensureWorkspaceIndex(input.kaos, input.workspace);
  const bm25 = await loadWorkspaceBm25(input.kaos, input.workspace);
  const graph = await loadWorkspaceGraph(input.kaos, input.workspace);
  const indexedPaths = queryIndexedPathsFromBm25(bm25, input.query, 40);
  const indexUsed = indexedPaths.length > 0;

  const files =
    indexedPaths.length > 0
      ? await collectContextFiles({
          kaos: input.kaos,
          workspace: input.workspace,
          explicitPaths: indexedPaths,
          query: input.query,
        })
      : await collectContextFiles({
          kaos: input.kaos,
          workspace: input.workspace,
          query: input.query,
        });

  let ranked = rankContextFiles(files, {
    query: input.query,
    max_files: input.maxFiles,
    max_symbols_per_file: input.maxSymbolsPerFile,
  });

  if (bm25 !== undefined && bm25.chunkCount > 0) {
    const hits = searchBm25(bm25, input.query, 40);
    const scoreBoost = new Map<string, number>();
    for (const hit of hits) scoreBoost.set(hit.chunk.path, hit.score);
    ranked = ranked
      .map((item) => ({
        ...item,
        score: item.score + (scoreBoost.get(item.file.path) ?? 0) * 10,
      }))
      .toSorted((a, b) => b.score - a.score || a.file.displayPath.localeCompare(b.file.displayPath));
  }

  if (graph !== undefined) {
    ranked = ranked
      .map((item) => {
        const neighbors = graphNeighbors(graph, item.file.displayPath);
        const neighborBoost = neighbors.length > 0 ? Math.min(neighbors.length, 5) : 0;
        return { ...item, score: item.score + neighborBoost };
      })
      .toSorted((a, b) => b.score - a.score || a.file.displayPath.localeCompare(b.file.displayPath));
  }

  const maxFiles = input.maxFiles ?? 8;
  ranked = ranked.slice(0, maxFiles);

  return {
    ranked,
    allFiles: files,
    indexUsed,
    indexStaleHint:
      ensured.ready && (indexUsed || files.length > 0)
        ? ensured.built
          ? 'index_auto_built'
          : undefined
        : 'index_unavailable — LioraIndex action=build may be required',
    strategy: 'lean-codegraph',
  };
}

export function queryGraphIndexedPaths(workspace: WorkspaceConfig, query: string, limit = 20): readonly string[] {
  return topIndexedPaths(getGraphDatabase(workspace), query, limit);
}
