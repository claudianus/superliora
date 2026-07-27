// Code indexer — SQLite symbol store (T5-1).
// Compact rows only (extract -> persist -> discard); no AST retention.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { IndexedSymbol, IndexedSymbolKind } from '#/indexer/extract';

interface SqliteRunResult {
  readonly changes: number;
}
interface SqliteStatement {
  run(...params: readonly (string | number | null)[]): SqliteRunResult;
  get(...params: readonly (string | number | null)[]): Record<string, string | number | null> | undefined;
  all(...params: readonly (string | number | null)[]): Array<Record<string, string | number | null>>;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

function loadSqlite(): SqliteModule {
  try {
    const require = createRequire(import.meta.url);
    return require('node:sqlite') as SqliteModule;
  } catch (error) {
    throw new Error(`node:sqlite is unavailable (Node >=22.5 required): ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

export interface SymbolHit {
  readonly path: string;
  readonly name: string;
  readonly kind: IndexedSymbolKind;
  readonly line: number;
  readonly exported: boolean;
  readonly defaultExport: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL,
  default_export INTEGER NOT NULL,
  PRIMARY KEY (path, name, line)
);
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
`;

export class SymbolIndexStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new (loadSqlite().DatabaseSync)(dbPath);
    this.db.exec(SCHEMA);
  }

  getFileHash(path: string): string | undefined {
    const row = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(path);
    const hash = row?.['hash'];
    return typeof hash === 'string' ? hash : undefined;
  }

  upsertFile(path: string, hash: string, symbols: readonly IndexedSymbol[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM symbols WHERE path = ?').run(path);
      const insertSymbol = this.db.prepare(
        'INSERT INTO symbols (path, name, kind, line, exported, default_export) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const s of symbols) {
        insertSymbol.run(path, s.name, s.kind, s.line, s.exported ? 1 : 0, s.defaultExport ? 1 : 0);
      }
      this.db.prepare('INSERT OR REPLACE INTO files (path, hash, indexed_at) VALUES (?, ?, ?)').run(path, hash, Date.now());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  removeFile(path: string): boolean {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM symbols WHERE path = ?').run(path);
      const result = this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
      this.db.exec('COMMIT');
      return result.changes > 0;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Remove every file row (and its symbols) whose path is not in `present`. */
  removeAbsentFiles(present: ReadonlySet<string>): number {
    let removed = 0;
    for (const row of this.db.prepare('SELECT path FROM files').all()) {
      const path = row['path'];
      if (typeof path === 'string' && !present.has(path)) {
        if (this.removeFile(path)) removed++;
      }
    }
    return removed;
  }

  findByName(name: string): SymbolHit[] {
    const rows = this.db
      .prepare('SELECT path, name, kind, line, exported, default_export FROM symbols WHERE name = ? ORDER BY path, line')
      .all(name);
    return rows.map((row) => ({
      path: String(row['path']),
      name: String(row['name']),
      kind: String(row['kind']) as IndexedSymbolKind,
      line: Number(row['line']),
      exported: Number(row['exported']) === 1,
      defaultExport: Number(row['default_export']) === 1,
    }));
  }

  fileCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM files').get();
    return Number(row?.['n'] ?? 0);
  }

  symbolCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM symbols').get();
    return Number(row?.['n'] ?? 0);
  }

  close(): void {
    this.db.close();
  }
}
