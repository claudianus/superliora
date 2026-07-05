export const LEAN_CONTEXT_INDEX_VERSION = 1;

export interface IndexFileState {
  readonly mtimeMs: number;
  readonly size: number;
}

export interface IndexManifest {
  readonly version: number;
  readonly workspaceRoot: string;
  readonly builtAt: number;
  readonly files: Readonly<Record<string, IndexFileState>>;
}

export interface Bm25ChunkRecord {
  readonly id: string;
  readonly path: string;
  readonly displayPath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly length: number;
}

export interface Bm25IndexData {
  readonly version: number;
  readonly avgChunkLength: number;
  readonly chunkCount: number;
  readonly chunks: readonly Bm25ChunkRecord[];
  readonly inverted: Readonly<Record<string, readonly number[]>>;
  readonly chunkTerms: readonly Readonly<Record<string, number>>[];
}

export interface ImportGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly line: number;
}

export interface GraphIndexData {
  readonly version: number;
  readonly edges: readonly ImportGraphEdge[];
}

export interface IndexBuildStats {
  readonly filesIndexed: number;
  readonly chunksIndexed: number;
  readonly edgesIndexed: number;
  readonly incremental: boolean;
  readonly durationMs: number;
}

export interface IndexStatus {
  readonly ready: boolean;
  readonly stale: boolean;
  readonly manifest?: IndexManifest | undefined;
  readonly chunkCount: number;
  readonly edgeCount: number;
  readonly indexDir: string;
}

export interface Bm25SearchHit {
  readonly chunk: Bm25ChunkRecord;
  readonly score: number;
}
