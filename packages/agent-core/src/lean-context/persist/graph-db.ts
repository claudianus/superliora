import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'pathe';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { GRAPH_META_VERSION, GRAPH_SCHEMA_STATEMENTS } from './graph-schema';
import { codegraphSqlitePath, workspaceIndexDir } from './paths';
import type {
  GraphBuildStats,
  GraphEdgeRecord,
  GraphFileRecord,
  GraphNodeRecord,
  GraphSearchHit,
  GraphTraversalHit,
} from '../graph/types';

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

const require = createRequire(import.meta.url);

function openSqlite(path: string): SqliteDatabase {
  const sqlite = require('node:sqlite') as SqliteModule;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  return new sqlite.DatabaseSync(path);
}

const testDatabases = new Map<string, GraphDatabase>();
const sessionDatabases = new Map<string, GraphDatabase>();

export function clearGraphDatabasesForTests(): void {
  for (const db of testDatabases.values()) db.close();
  for (const db of sessionDatabases.values()) db.close();
  testDatabases.clear();
  sessionDatabases.clear();
}

export function openGraphDatabase(workspace: WorkspaceConfig): GraphDatabase {
  const key = workspace.workspaceDir;
  if (process.env['VITEST'] === 'true') {
    const existing = testDatabases.get(key);
    if (existing !== undefined) return existing;
    const db = new GraphDatabase(':memory:', workspace);
    testDatabases.set(key, db);
    return db;
  }
  const existing = sessionDatabases.get(key);
  if (existing !== undefined) return existing;
  const indexDir = workspaceIndexDir(workspace);
  const db = new GraphDatabase(codegraphSqlitePath(indexDir), workspace);
  sessionDatabases.set(key, db);
  return db;
}

export function resetGraphDatabaseSession(workspace: WorkspaceConfig): void {
  const key = workspace.workspaceDir;
  const existing = sessionDatabases.get(key);
  if (existing !== undefined) {
    existing.close();
    sessionDatabases.delete(key);
  }
}

export class GraphDatabase {
  private readonly db: SqliteDatabase;

  constructor(
    private readonly dbPath: string,
    private readonly workspace: WorkspaceConfig,
  ) {
    this.db = openSqlite(dbPath);
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    for (const statement of GRAPH_SCHEMA_STATEMENTS) {
      this.db.exec(statement);
    }
    this.setMeta('version', String(GRAPH_META_VERSION));
    this.setMeta('workspace_root', this.workspace.workspaceDir);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  getBuiltAt(): number {
    const raw = this.getMeta('built_at');
    return raw === undefined ? 0 : Number(raw);
  }

  listFiles(): GraphFileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files').all() as Array<{
      path: string;
      display_path: string;
      content_hash: string;
      mtime_ms: number;
      size: number;
      language: string;
    }>;
    return rows.map((row) => ({
      path: row.path,
      displayPath: row.display_path,
      contentHash: row.content_hash,
      mtimeMs: row.mtime_ms,
      size: row.size,
      language: row.language,
    }));
  }

  getStats(): { files: number; nodes: number; edges: number } {
    const files = this.db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number };
    const nodes = this.db.prepare('SELECT COUNT(*) AS count FROM nodes').get() as { count: number };
    const edges = this.db.prepare('SELECT COUNT(*) AS count FROM edges').get() as { count: number };
    return { files: files.count, nodes: nodes.count, edges: edges.count };
  }

  resolveAbsolutePath(displayPath: string): string | undefined {
    const row = this.db.prepare('SELECT path FROM files WHERE display_path = ?').get(displayPath) as
      | { path: string }
      | undefined;
    return row?.path;
  }

  deleteFile(displayPath: string): void {
    this.db
      .prepare('DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)')
      .run(displayPath);
    this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(displayPath);
    this.db.prepare('DELETE FROM files WHERE display_path = ?').run(displayPath);
  }

  upsertFile(file: GraphFileRecord): void {
    this.db
      .prepare(
        `INSERT INTO files(path, display_path, content_hash, mtime_ms, size, language)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           display_path = excluded.display_path,
           content_hash = excluded.content_hash,
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           language = excluded.language`,
      )
      .run(file.path, file.displayPath, file.contentHash, file.mtimeMs, file.size, file.language);
  }

  replaceFileGraph(
    displayPath: string,
    nodes: readonly GraphNodeRecord[],
    edges: readonly GraphEdgeRecord[],
  ): void {
    this.db
      .prepare('DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)')
      .run(displayPath);
    this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(displayPath);
    const insertNode = this.db.prepare(
      `INSERT INTO nodes(id, type, name, qualified_name, file_path, start_line, end_line, language, signature, body, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const node of nodes) {
      insertNode.run(
        node.id,
        node.type,
        node.name,
        node.qualifiedName,
        node.filePath,
        node.startLine,
        node.endLine,
        node.language,
        node.signature,
        node.body,
        node.isTest ? 1 : 0,
      );
    }
    const insertEdge = this.db.prepare(
      `INSERT INTO edges(source_id, target_id, target_specifier, type, line)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const edge of edges) {
      insertEdge.run(edge.sourceId, edge.targetId ?? null, edge.targetSpecifier ?? null, edge.type, edge.line);
    }
  }

  finishBuild(incremental: boolean, started: number): GraphBuildStats {
    const builtAt = Date.now();
    this.setMeta('built_at', String(builtAt));
    this.setMeta('incremental', incremental ? '1' : '0');
    const stats = this.getStats();
    return {
      filesIndexed: stats.files,
      nodesIndexed: stats.nodes,
      edgesIndexed: stats.edges,
      incremental,
      durationMs: Date.now() - started,
      engine: 'v2',
    };
  }

  searchNodes(query: string, limit = 20): GraphSearchHit[] {
    const terms = query
      .trim()
      .split(/\s+/u)
      .filter((term) => term.length > 0)
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
      .join(' ');
    if (terms.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT n.id, n.name, n.qualified_name, n.file_path, n.signature, n.start_line, n.end_line,
                bm25(fts_nodes) AS score
         FROM fts_nodes
         JOIN nodes n ON n.rowid = fts_nodes.rowid
         WHERE fts_nodes MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(terms, limit) as Array<{
      id: string;
      name: string;
      qualified_name: string;
      file_path: string;
      signature: string;
      start_line: number;
      end_line: number;
      score: number;
    }>;
    return rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      signature: row.signature,
      score: row.score,
      startLine: row.start_line,
      endLine: row.end_line,
    }));
  }

  searchNodesByBody(query: string, limit = 20): GraphSearchHit[] {
    const terms = query
      .trim()
      .split(/\s+/u)
      .filter((term) => term.length > 0);
    if (terms.length === 0) return [];
    const where = terms.map(() => 'body LIKE ?').join(' AND ');
    const params = terms.map((term) => `%${term}%`);
    const rows = this.db
      .prepare(
        `SELECT id, name, qualified_name, file_path, signature, start_line, end_line
         FROM nodes
         WHERE ${where}
         ORDER BY file_path, start_line
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      id: string;
      name: string;
      qualified_name: string;
      file_path: string;
      signature: string;
      start_line: number;
      end_line: number;
    }>;
    return rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      signature: row.signature,
      score: 0.5,
      startLine: row.start_line,
      endLine: row.end_line,
    }));
  }

  findNodesByName(name: string, limit = 20): GraphSearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, qualified_name, file_path, signature, start_line, end_line
         FROM nodes
         WHERE name = ?
         ORDER BY file_path, start_line
         LIMIT ?`,
      )
      .all(name, limit) as Array<{
      id: string;
      name: string;
      qualified_name: string;
      file_path: string;
      signature: string;
      start_line: number;
      end_line: number;
    }>;
    return rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      signature: row.signature,
      score: 1,
      startLine: row.start_line,
      endLine: row.end_line,
    }));
  }

  listImportEdges(displayPath: string, limit = 8): Array<{ line: number; specifier: string }> {
    const rows = this.db
      .prepare(
        `SELECT e.line, e.target_specifier AS specifier
         FROM edges e
         JOIN nodes n ON n.id = e.source_id
         WHERE e.type = 'import' AND n.file_path = ?
         ORDER BY e.line
         LIMIT ?`,
      )
      .all(displayPath, limit) as Array<{ line: number; specifier: string | null }>;
    return rows
      .filter((row) => row.specifier !== null && row.specifier.length > 0)
      .map((row) => ({ line: row.line, specifier: row.specifier as string }));
  }

  traverseCallers(symbol: string, depth = 2, limit = 40): GraphTraversalHit[] {
    return this.traverse(symbol, 'call', 'reverse', depth, limit);
  }

  traverseCallees(symbol: string, depth = 2, limit = 40): GraphTraversalHit[] {
    return this.traverse(symbol, 'call', 'forward', depth, limit);
  }

  graphNeighbors(displayPath: string, limit = 20): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT neighbor FROM (
           SELECT n2.file_path AS neighbor
           FROM nodes n1
           JOIN edges e ON e.source_id = n1.id
           JOIN nodes n2 ON n2.id = e.target_id
           WHERE n1.file_path = ?
           UNION
           SELECT n2.file_path AS neighbor
           FROM nodes n1
           JOIN edges e ON e.target_id = n1.id
           JOIN nodes n2 ON n2.id = e.source_id
           WHERE n1.file_path = ?
         )
         LIMIT ?`,
      )
      .all(displayPath, displayPath, limit) as Array<{ neighbor: string }>;
    return rows.map((row) => row.neighbor);
  }

  topSymbolsByConnectivity(limit = 12): GraphSearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.name, n.qualified_name, n.file_path, n.signature, n.start_line, n.end_line,
                COUNT(e.id) AS score
         FROM nodes n
         LEFT JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
         WHERE n.is_test = 0
         GROUP BY n.id
         ORDER BY score DESC, n.qualified_name
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      name: string;
      qualified_name: string;
      file_path: string;
      signature: string;
      start_line: number;
      end_line: number;
      score: number;
    }>;
    return rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      signature: row.signature,
      score: row.score,
      startLine: row.start_line,
      endLine: row.end_line,
    }));
  }

  private traverse(
    symbol: string,
    edgeType: string,
    direction: 'forward' | 'reverse',
    depth: number,
    limit: number,
  ): GraphTraversalHit[] {
    const anchor = this.findNodesByName(symbol, 5)[0];
    if (anchor === undefined) return [];
    const sourceJoin = direction === 'forward' ? 'e.source_id' : 'e.target_id';
    const targetJoin = direction === 'forward' ? 'e.target_id' : 'e.source_id';
    const rows = this.db
      .prepare(
        `WITH RECURSIVE walk(node_id, depth, line, edge_kind) AS (
           SELECT n.id, 0, 0, 'call'
           FROM nodes n
           WHERE n.id = ?
           UNION ALL
           SELECT n2.id, walk.depth + 1, e.line, e.type
           FROM walk
           JOIN edges e ON ${sourceJoin} = walk.node_id
           JOIN nodes n2 ON n2.id = ${targetJoin}
           WHERE walk.depth < ? AND e.type = ?
         )
         SELECT n.id, n.name, n.qualified_name, n.file_path, walk.edge_kind, walk.depth, walk.line
         FROM walk
         JOIN nodes n ON n.id = walk.node_id
         WHERE walk.depth > 0
         LIMIT ?`,
      )
      .all(anchor.nodeId, depth, edgeType, limit) as Array<{
      id: string;
      name: string;
      qualified_name: string;
      file_path: string;
      edge_kind: string;
      depth: number;
      line: number;
    }>;
    return rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      edgeKind: row.edge_kind as GraphTraversalHit['edgeKind'],
      depth: row.depth,
      line: row.line,
    }));
  }
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
