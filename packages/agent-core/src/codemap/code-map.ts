// Code map — workspace facade over the oxc-based codemap index.
// Lazy, failure-tolerant entry point for the Liora* context tools: builds the
// symbol index on first use (git workspaces only), degrades to "not ready"
// instead of throwing, and offers a live per-file outline that needs no index.
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractSymbols } from '#/codemap/extract';
import { CodeIndexer, type IndexReport } from '#/codemap/indexer';
import { SymbolIndexStore, type SymbolHit } from '#/codemap/store';
import { resolveLioraHome } from '#/config/path';
import type { MemoryLink } from '#/memory';

export interface CodeMapHit {
  readonly filePath: string;
  readonly startLine: number;
  readonly kind: string;
  readonly signature: string;
  readonly exported: boolean;
}

/** Deterministic, derived provenance edge; never canonical memory itself. */
export function codeMapHitToMemoryLink(hit: CodeMapHit): MemoryLink {
  const targetKind = hit.kind === 'function' || hit.kind === 'class' || hit.kind === 'method' ? 'symbol' : 'file';
  return {
    targetKind,
    targetId: `${hit.filePath}#L${String(hit.startLine)}`,
    relation: 'derived:codemap',
    confidence: 0.95,
    source: { kind: 'system', excerpt: hit.signature },
  };
}

export function codeMapHitsToMemoryLinks(hits: readonly CodeMapHit[]): readonly MemoryLink[] {
  return hits.map(codeMapHitToMemoryLink);
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

  /** Drop persisted rows and rebuild the symbol index from scratch. Never throws. */
  rebuild(): { readonly ok: boolean; readonly report: IndexReport | null } {
    this.close();
    this.unusable = false;
    try {
      const store = new SymbolIndexStore(this.dbPath);
      try {
        store.clearAll();
      } finally {
        store.close();
      }
    } catch {
      this.unusable = true;
      return { ok: false, report: null };
    }
    try {
      const indexer = new CodeIndexer({ root: this.root, dbPath: this.dbPath });
      const report = indexer.update();
      this.indexer = indexer;
      this.ready = true;
      return { ok: true, report };
    } catch {
      this.unusable = true;
      this.indexer = undefined;
      this.ready = false;
      return { ok: false, report: null };
    }
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

/**
 * Process-level singleton per workspace. The sqlite file persists under the
 * Liora home (`<home>/codemap/<digest>.sqlite`) so later sessions warm-start
 * from the previous index; it falls back to tmpdir when the home is not
 * writable.
 */
export function getCodeMapForWorkspace(workspaceDir: string): CodeMap {
  const existing = workspaceMaps.get(workspaceDir);
  if (existing !== undefined) return existing;
  const codemap = new CodeMap(workspaceDir, resolveCodemapDbPath(workspaceDir));
  workspaceMaps.set(workspaceDir, codemap);
  return codemap;
}

/** @internal Close and drop a workspace codemap singleton (Vitest isolation). */
export function resetCodeMapForWorkspace(workspaceDir: string): void {
  const existing = workspaceMaps.get(workspaceDir);
  existing?.close();
  workspaceMaps.delete(workspaceDir);
}

/** Persistent sqlite path for a workspace (creates home/codemap dir when writable). */
export function resolveCodemapDbPath(workspaceDir: string): string {
  const digest = createHash('sha256').update(workspaceDir).digest('hex').slice(0, 16);
  const fileName = `${digest}.sqlite`;
  try {
    const dir = join(resolveLioraHome(), 'codemap');
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return join(dir, fileName);
  } catch {
    return join(tmpdir(), 'superliora-codemap', fileName);
  }
}
