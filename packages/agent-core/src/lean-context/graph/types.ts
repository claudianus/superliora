export const LEAN_CODEGRAPH_VERSION = 2;

export type GraphNodeKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'module';

export type GraphEdgeKind = 'call' | 'import' | 'inherit';

export interface GraphNodeRecord {
  readonly id: string;
  readonly type: GraphNodeKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language: string;
  readonly signature: string;
  readonly body: string;
  readonly isTest: boolean;
}

export interface GraphEdgeRecord {
  readonly sourceId: string;
  readonly targetId?: string | undefined;
  readonly type: GraphEdgeKind;
  readonly line: number;
  readonly targetSpecifier?: string | undefined;
}

export interface GraphFileRecord {
  readonly path: string;
  readonly displayPath: string;
  readonly contentHash: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly language: string;
}

export interface GraphBuildStats {
  readonly filesIndexed: number;
  readonly nodesIndexed: number;
  readonly edgesIndexed: number;
  readonly incremental: boolean;
  readonly durationMs: number;
  readonly engine: 'v2';
}

export interface GraphSearchHit {
  readonly nodeId: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly signature: string;
  readonly score: number;
  readonly startLine: number;
  readonly endLine: number;
}

export interface GraphTraversalHit {
  readonly nodeId: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly edgeKind: GraphEdgeKind;
  readonly depth: number;
  readonly line: number;
}
