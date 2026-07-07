import type { GraphDatabase } from '../persist/graph-db';
import type { CallgraphResult } from '../../tools/builtin/context/context-callgraph';

export function buildIndexedCallgraph(
  db: GraphDatabase,
  symbol: string,
  direction: 'callers' | 'callees' | 'both',
): CallgraphResult {
  const definitions = db.findNodesByName(symbol, 20).map((hit) => ({
    symbol,
    file: hit.filePath,
    line: hit.startLine,
  }));
  const references = [];
  if (direction === 'callers' || direction === 'both') {
    for (const hit of db.traverseCallers(symbol, 2, 40)) {
      references.push({
        from: hit.qualifiedName,
        to: symbol,
        kind: 'call' as const,
        file: hit.filePath,
        line: hit.line,
      });
    }
  }
  if (direction === 'callees' || direction === 'both') {
    for (const hit of db.traverseCallees(symbol, 2, 40)) {
      references.push({
        from: symbol,
        to: hit.qualifiedName,
        kind: 'call' as const,
        file: hit.filePath,
        line: hit.line,
      });
    }
  }
  return {
    symbol,
    definitions,
    references: references.slice(0, 40),
    imports: [],
  };
}
