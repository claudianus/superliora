import type { Kaos } from '@superliora/kaos';

import type {
  ContextFile,
  MatchEntry,
  RankedFile,
  RelationshipEntry,
  SymbolEntry,
  TestHintEntry,
} from '../../tools/builtin/context/context-types';
import type { WorkspaceConfig } from '../../tools/support/workspace';
import type { GraphDatabase } from '../persist/graph-db';
import type { GraphSearchHit } from '../graph/types';
import { searchGraph } from '../graph/search';

export interface AssembleContextInput {
  readonly kaos: Kaos;
  readonly workspace: WorkspaceConfig;
  readonly db: GraphDatabase;
  readonly query: string;
  readonly maxFiles?: number | undefined;
  readonly maxSymbolsPerFile?: number | undefined;
}

export interface AssembleContextResult {
  readonly ranked: readonly RankedFile[];
  readonly allFiles: readonly ContextFile[];
  readonly indexUsed: boolean;
  readonly topSymbols: readonly GraphSearchHit[];
}

export async function assembleContextPacket(
  input: AssembleContextInput,
): Promise<AssembleContextResult> {
  const maxFiles = input.maxFiles ?? 8;
  const maxSymbolsPerFile = input.maxSymbolsPerFile ?? 8;
  const hits = searchGraph(input.db, input.query, maxFiles * 4);
  const indexUsed = hits.length > 0;
  const topSymbols = input.db.topSymbolsByConnectivity(8);

  const fileHits = groupHitsByFile(hits);
  const ranked: RankedFile[] = [];
  const allFiles: ContextFile[] = [];

  for (const [displayPath, fileHitsForPath] of fileHits.entries()) {
    if (ranked.length >= maxFiles) break;
    const absolutePath = resolveAbsolutePath(input.workspace, displayPath);
    let content = '';
    try {
      content = await input.kaos.readText(absolutePath, { errors: 'strict' });
    } catch {
      continue;
    }
    const contextFile: ContextFile = {
      path: absolutePath,
      displayPath,
      content,
      lineCount: content.split(/\r?\n/).length,
    };
    allFiles.push(contextFile);

    const symbols: SymbolEntry[] = fileHitsForPath.slice(0, maxSymbolsPerFile).map((hit) => ({
      line: hit.startLine,
      kind: 'symbol',
      name: hit.qualifiedName,
      signature: hit.signature,
    }));

    const matches: MatchEntry[] = findQueryMatches(content, input.query, 6);
    const relationships = buildRelationships(input.db, displayPath, fileHitsForPath[0]);
    const score =
      fileHitsForPath.reduce((sum, hit) => sum + Math.abs(hit.score), 0) +
      input.db.graphNeighbors(displayPath, 10).length;

    ranked.push({
      file: contextFile,
      score,
      symbols,
      matches,
      relationships,
      testHints: inferTestHints(displayPath),
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.file.displayPath.localeCompare(b.file.displayPath));

  return {
    ranked: ranked.slice(0, maxFiles),
    allFiles,
    indexUsed,
    topSymbols,
  };
}

function groupHitsByFile(hits: readonly GraphSearchHit[]): Map<string, GraphSearchHit[]> {
  const grouped = new Map<string, GraphSearchHit[]>();
  for (const hit of hits) {
    const bucket = grouped.get(hit.filePath) ?? [];
    bucket.push(hit);
    grouped.set(hit.filePath, bucket);
  }
  return grouped;
}

function resolveAbsolutePath(workspace: WorkspaceConfig, displayPath: string): string {
  if (displayPath === '.') return workspace.workspaceDir;
  return `${workspace.workspaceDir}/${displayPath}`;
}

function findQueryMatches(content: string, query: string, limit: number): MatchEntry[] {
  const terms = query
    .trim()
    .split(/\s+/u)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];
  const matches: MatchEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    if (!terms.some((term) => lower.includes(term))) continue;
    matches.push({ line: index + 1, text: line.trim().slice(0, 160) });
    if (matches.length >= limit) break;
  }
  return matches;
}

function buildRelationships(
  db: GraphDatabase,
  displayPath: string,
  anchor: GraphSearchHit | undefined,
): RelationshipEntry[] {
  const relationships: RelationshipEntry[] = [];
  for (const edge of db.listImportEdges(displayPath, 8)) {
    relationships.push({
      line: edge.line,
      kind: 'import',
      target: edge.specifier,
      confidence: 'EXTRACTED',
      text: `import ${edge.specifier}`,
    });
  }
  const neighbors = db.graphNeighbors(displayPath, 8);
  for (const neighbor of neighbors) {
    relationships.push({
      line: anchor?.startLine ?? 1,
      kind: 'import',
      target: neighbor,
      confidence: 'EXTRACTED',
      text: `graph neighbor ${neighbor}`,
    });
  }
  if (anchor !== undefined) {
    for (const caller of db.traverseCallers(anchor.name, 1, 4)) {
      relationships.push({
        line: caller.line,
        kind: 'export',
        target: `${caller.filePath}::${caller.qualifiedName}`,
        confidence: 'EXTRACTED',
        text: `caller ${caller.qualifiedName}`,
      });
    }
    for (const callee of db.traverseCallees(anchor.name, 1, 4)) {
      relationships.push({
        line: callee.line,
        kind: 'export',
        target: `${callee.filePath}::${callee.qualifiedName}`,
        confidence: 'EXTRACTED',
        text: `callee ${callee.qualifiedName}`,
      });
    }
  }
  return relationships.slice(0, 8);
}

function inferTestHints(displayPath: string): TestHintEntry[] {
  const base = displayPath.replace(/\.[^./]+$/u, '');
  const candidates = [
    `${base}.test.ts`,
    `${base}.spec.ts`,
    `${base}.test.tsx`,
    `${base}.spec.tsx`,
    displayPath.replace('/src/', '/test/').replace(/\.[^./]+$/u, '.test.ts'),
  ];
  return candidates.slice(0, 2).map((path) => ({
    confidence: 'INFERRED',
    path,
    reason: 'name/path convention',
  }));
}

export function renderTierHints(topSymbols: readonly GraphSearchHit[]): string[] {
  if (topSymbols.length === 0) return ['tier0: (no indexed symbols yet)'];
  return [
    'tier0: project hubs',
    ...topSymbols.slice(0, 6).map((symbol) => `- ${symbol.qualifiedName} @ ${symbol.filePath}`),
  ];
}
