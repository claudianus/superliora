// Code indexer — incremental coordinator (T5-1).
// Walks the file set (explicit list or `git ls-files`), content-hashes each file,
// and re-extracts only what changed. Single-threaded v1; worker parallelism is a
// documented follow-up if the cold budget (<2s on this repo) is ever exceeded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { extractSymbols } from '#/codemap/extract';
import { SymbolIndexStore, type SymbolHit } from '#/codemap/store';

export interface CodeIndexerOptions {
  /** Repository root; git traversal runs here and relative paths resolve against it. */
  readonly root: string;
  /** SQLite path, or ':memory:' for tests. */
  readonly dbPath: string;
  /** Explicit file list (absolute or root-relative). Omit to traverse `git ls-files '*.ts' '*.tsx'`. */
  readonly files?: readonly string[];
}

export interface IndexReport {
  readonly scanned: number;
  readonly indexed: number;
  readonly skipped: number;
  readonly removed: number;
  readonly symbols: number;
  readonly parseErrors: number;
  readonly ms: number;
}

export function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Bump to force a full re-index of every persisted db on next open. */
const CODEMAP_SCHEMA_VERSION = '1';

export class CodeIndexer {
  private readonly store: SymbolIndexStore;

  constructor(private readonly options: CodeIndexerOptions) {
    this.store = new SymbolIndexStore(options.dbPath);
    // A persistent db can outlive a schema revision or — via a digest-scheme
    // change — point at another repo; wipe instead of serving stale rows.
    if (options.dbPath !== ':memory:') {
      if (
        this.store.getMeta('schema_version') !== CODEMAP_SCHEMA_VERSION ||
        this.store.getMeta('workspace_root') !== options.root
      ) {
        this.store.clearAll();
        this.store.setMeta('schema_version', CODEMAP_SCHEMA_VERSION);
        this.store.setMeta('workspace_root', options.root);
      }
    }
  }

  update(): IndexReport {
    const started = Date.now();
    const files = this.resolveFiles();
    const present = new Set<string>();
    let indexed = 0;
    let skipped = 0;
    let symbols = 0;
    let parseErrors = 0;
    for (const file of files) {
      present.add(file);
      const source = readFileSync(file, 'utf8');
      const hash = hashSource(source);
      if (this.store.getFileHash(file) === hash) {
        skipped++;
        continue;
      }
      const result = extractSymbols(file, source);
      parseErrors += result.parseErrorCount;
      this.store.upsertFile(file, hash, result.symbols);
      indexed++;
      symbols += result.symbols.length;
    }
    const removed = this.store.removeAbsentFiles(present);
    return { scanned: files.length, indexed, skipped, removed, symbols, parseErrors, ms: Date.now() - started };
  }

  find(name: string): SymbolHit[] {
    return this.store.findByName(name);
  }

  fileCount(): number {
    return this.store.fileCount();
  }

  symbolCount(): number {
    return this.store.symbolCount();
  }

  close(): void {
    this.store.close();
  }

  private resolveFiles(): string[] {
    const { files, root } = this.options;
    if (files) {
      return files.map((f) => (isAbsolute(f) ? f : join(root, f)));
    }
    const result = spawnSync('git', ['ls-files', '*.ts', '*.tsx'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`git ls-files failed in ${root}: ${result.stderr.trim()}`);
    }
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => join(root, line));
  }
}
