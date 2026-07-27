// Code map — workspace facade over the oxc-based codemap index.
// Lazy, failure-tolerant entry point for the Liora* context tools: builds the
// symbol index on first use (git workspaces only), degrades to "not ready"
// instead of throwing, and offers a live per-file outline that needs no index.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractSymbols } from '#/codemap/extract';
import { CodeIndexer } from '#/codemap/indexer';
import type { SymbolHit } from '#/codemap/store';

export interface CodeMapHit {
  readonly filePath: string;
  readonly startLine: number;
  readonly kind: string;
  readonly signature: string;
  readonly exported: boolean;
}

export class CodeMap {
  private indexer: CodeIndexer | undefined;
  private ready = false;
  private unusable = false;

  constructor(
    private readonly root: string,
    private readonly dbPath: string,
  ) {}

  /**
   * Build (or reuse) the workspace symbol index on first call. Returns false
   * and marks the map unusable when indexing fails (e.g. not a git repo);
   * never throws.
   */
  ensureReady(): boolean {
    if (this.ready) return true;
    if (this.unusable) return false;
    try {
      const indexer = new CodeIndexer({ root: this.root, dbPath: this.dbPath });
      indexer.update();
      this.indexer = indexer;
      this.ready = true;
      return true;
    } catch {
      this.unusable = true;
      this.indexer = undefined;
      return false;
    }
  }

  findSymbol(name: string, maxResults: number): CodeMapHit[] {
    if (this.indexer === undefined) return [];
    try {
      return this.indexer
        .find(name)
        .slice(0, Math.max(0, maxResults))
        .map(toCodeMapHit);
    } catch {
      return [];
    }
  }

  /**
   * Live-parse ONE file into top-level declarations. Needs no index, so it
   * works in any workspace; returns [] on read/parse failure.
   */
  outlineFile(absPath: string): CodeMapHit[] {
    try {
      const source = readFileSync(absPath, 'utf8');
      return extractSymbols(absPath, source).symbols.map((symbol) => ({
        filePath: absPath,
        startLine: symbol.line,
        kind: symbol.kind,
        signature: `${symbol.kind} ${symbol.name}`,
        exported: symbol.exported,
      }));
    } catch {
      return [];
    }
  }

  close(): void {
    try {
      this.indexer?.close();
    } catch {
      // Closing a broken handle must not surface; the map is disposable.
    }
    this.indexer = undefined;
    this.ready = false;
  }
}

function toCodeMapHit(hit: SymbolHit): CodeMapHit {
  return {
    filePath: hit.path,
    startLine: hit.line,
    kind: hit.kind,
    signature: `${hit.kind} ${hit.name}`,
    exported: hit.exported,
  };
}

const workspaceMaps = new Map<string, CodeMap>();

/** Process-level singleton per workspace; the sqlite file lives under tmpdir. */
export function getCodeMapForWorkspace(workspaceDir: string): CodeMap {
  const existing = workspaceMaps.get(workspaceDir);
  if (existing !== undefined) return existing;
  const digest = createHash('sha256').update(workspaceDir).digest('hex').slice(0, 16);
  const dbPath = join(tmpdir(), 'superliora-codemap', `${digest}.sqlite`);
  const codemap = new CodeMap(workspaceDir, dbPath);
  workspaceMaps.set(workspaceDir, codemap);
  return codemap;
}
