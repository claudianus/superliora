import type { GraphDatabase } from '../persist/graph-db';
import type { GraphSearchHit } from './types';

export function searchGraph(db: GraphDatabase, query: string, limit = 20): readonly GraphSearchHit[] {
  const hits = db.searchNodes(query, limit);
  if (hits.length > 0) return hits;
  const terms = query.trim().split(/\s+/u).filter((term) => term.length > 0);
  const merged: GraphSearchHit[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    for (const hit of db.findNodesByName(term, limit)) {
      if (seen.has(hit.nodeId)) continue;
      seen.add(hit.nodeId);
      merged.push(hit);
    }
  }
  if (merged.length > 0) return merged.slice(0, limit);
  return db.searchNodesByBody(query, limit);
}

export function topIndexedPaths(db: GraphDatabase, query: string, limit = 20): readonly string[] {
  const hits = searchGraph(db, query, limit * 2);
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const absolute = db.resolveAbsolutePath(hit.filePath) ?? hit.filePath;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    paths.push(absolute);
    if (paths.length >= limit) break;
  }
  return paths;
}
