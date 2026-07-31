/**
 * RepoIndex content indexer — SQLite FTS5 workspace line index (v1 micro-slice).
 *
 * Indexes text files under a workspace root (git ls-files or directory walk),
 * one FTS row per line, capped for safety. Reuses node:sqlite / better-sqlite3
 * loading patterns from codemap/store.ts.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { resolveLioraHome } from '#/config/path';

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

export const CONTENT_INDEX_MAX_FILES = 500;
export const CONTENT_INDEX_MAX_BYTES = 2 * 1024 * 1024;

const CONTENT_INDEX_SCHEMA_VERSION = '1';

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.superliora',
  'dist',
  'build',
  '.next',
  'coverage',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.html',
  '.htm',
  '.sql',
  '.sh',
  '.toml',
  '.rs',
  '.go',
  '.py',
  '.rb',
  '.java',
  '.kt',
  '.swift',
  '.vue',
  '.svelte',
  '.graphql',
  '.proto',
]);

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS repo_content USING fts5(
  path UNINDEXED,
  line UNINDEXED,
  body
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function loadSqliteModule(): SqliteModule {
  const require = createRequire(import.meta.url);
  try {
    return require('node:sqlite') as SqliteModule;
  } catch (nodeError) {
    try {
      return require('better-sqlite3') as SqliteModule;
    } catch (betterError) {
      const nodeMsg = nodeError instanceof Error ? nodeError.message : String(nodeError);
      const betterMsg = betterError instanceof Error ? betterError.message : String(betterError);
      throw new Error(`no sqlite driver (node:sqlite: ${nodeMsg}; better-sqlite3: ${betterMsg})`, {
        cause: betterError,
      });
    }
  }
}

function isTextCandidate(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

function toRepoRelativePath(root: string, absPath: string): string {
  return relative(root, absPath).replaceAll(/\\/g, '/');
}

/** Quote a single FTS5 token for MATCH queries. */
export function escapeFts5Token(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[\w.-]+$/u.test(trimmed)) {
    return null;
  }
  return `"${trimmed.replaceAll(/"/g, '""')}"`;
}

export interface ContentIndexReport {
  readonly scanned: number;
  readonly indexed: number;
  readonly lines: number;
  readonly bytes: number;
  readonly ms: number;
}

export class ContentIndexStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new (loadSqliteModule().DatabaseSync)(dbPath);
    this.db.exec(FTS_SCHEMA);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 2000');
  }

  clearContent(): void {
    this.db.exec('DELETE FROM repo_content');
  }

  insertLine(path: string, line: number, body: string): void {
    this.db.prepare('INSERT INTO repo_content (path, line, body) VALUES (?, ?, ?)').run(path, line, body);
  }

  lineCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM repo_content').get();
    return Number(row?.['n'] ?? 0);
  }

  query(match: string, scope: string | undefined, limit: number): readonly string[] {
    let sql = 'SELECT path, line, body FROM repo_content WHERE repo_content MATCH ?';
    const params: (string | number)[] = [match];
    if (scope !== undefined && scope.length > 0) {
      sql += ' AND path LIKE ?';
      params.push(`%${scope.replaceAll(/%/g, '')}%`);
    }
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row) => {
      const path = String(row['path'] ?? '');
      const line = String(row['line'] ?? '');
      const body = String(row['body'] ?? '');
      return `${path}:L${line} ${body}`;
    });
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    const value = row?.['value'];
    return typeof value === 'string' ? value : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

export interface ContentIndexerOptions {
  readonly root: string;
  readonly dbPath: string;
  readonly files?: readonly string[] | undefined;
  readonly maxFiles?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export class ContentIndexer {
  private readonly store: ContentIndexStore;
  private readonly maxFiles: number;
  private readonly maxBytes: number;

  constructor(private readonly options: ContentIndexerOptions) {
    this.store = new ContentIndexStore(options.dbPath);
    this.maxFiles = options.maxFiles ?? CONTENT_INDEX_MAX_FILES;
    this.maxBytes = options.maxBytes ?? CONTENT_INDEX_MAX_BYTES;
    if (options.dbPath !== ':memory:') {
      if (
        this.store.getMeta('schema_version') !== CONTENT_INDEX_SCHEMA_VERSION ||
        this.store.getMeta('workspace_root') !== options.root
      ) {
        this.store.clearContent();
        this.store.setMeta('schema_version', CONTENT_INDEX_SCHEMA_VERSION);
        this.store.setMeta('workspace_root', options.root);
      }
    }
  }

  update(): ContentIndexReport {
    const started = Date.now();
    const files = this.resolveFiles();
    this.store.clearContent();

    let indexed = 0;
    let lines = 0;
    let bytes = 0;

    for (const absPath of files) {
      if (indexed >= this.maxFiles) break;
      let source: string;
      try {
        const buf = readFileSync(absPath);
        if (buf.includes(0)) continue;
        if (bytes + buf.length > this.maxBytes) break;
        source = buf.toString('utf8');
        bytes += buf.length;
      } catch {
        continue;
      }

      const relPath = toRepoRelativePath(this.options.root, absPath);
      const lineBodies = source.split('\n');
      for (let i = 0; i < lineBodies.length; i++) {
        this.store.insertLine(relPath, i + 1, lineBodies[i] ?? '');
        lines++;
      }
      indexed++;
    }

    return {
      scanned: files.length,
      indexed,
      lines,
      bytes,
      ms: Date.now() - started,
    };
  }

  query(inputQuery: string, scope: string | undefined, limit: number): readonly string[] {
    const match = escapeFts5Token(inputQuery);
    if (match === null) {
      return [];
    }
    return this.store.query(match, scope, limit);
  }

  lineCount(): number {
    return this.store.lineCount();
  }

  close(): void {
    this.store.close();
  }

  private resolveFiles(): string[] {
    const { files, root } = this.options;
    if (files !== undefined) {
      return files.map((file) => (isAbsolute(file) ? file : join(root, file)));
    }
    const gitFiles = tryGitLsFiles(root);
    if (gitFiles !== null) {
      return gitFiles.slice(0, this.maxFiles);
    }
    return walkTextFiles(root, this.maxFiles);
  }
}

function tryGitLsFiles(root: string): string[] | null {
  const result = spawnSync('git', ['ls-files'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => isTextCandidate(line))
    .map((line) => join(root, line));
}

function walkTextFiles(root: string, maxFiles: number): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length < maxFiles) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) {
          stack.push(full);
        }
      } else if (entry.isFile() && isTextCandidate(entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

class WorkspaceContentIndex {
  private indexer: ContentIndexer | undefined;
  private ready = false;
  private unusable = false;

  constructor(
    private readonly root: string,
    private readonly dbPath: string,
  ) {}

  ensureReady(): boolean {
    if (this.ready) return true;
    if (this.unusable) return false;
    try {
      const indexer = new ContentIndexer({ root: this.root, dbPath: this.dbPath });
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

  query(inputQuery: string, scope: string | undefined, limit: number): readonly string[] {
    if (this.indexer === undefined) return [];
    try {
      return this.indexer.query(inputQuery, scope, limit);
    } catch {
      return [];
    }
  }

  lineCount(): number {
    return this.indexer?.lineCount() ?? 0;
  }

  close(): void {
    try {
      this.indexer?.close();
    } catch {
      /* disposable */
    }
    this.indexer = undefined;
    this.ready = false;
  }

  /** Clear FTS rows and rebuild from workspace files. Never throws. */
  rebuild(): { readonly ok: boolean; readonly report: ContentIndexReport | null } {
    this.close();
    this.unusable = false;
    try {
      const indexer = new ContentIndexer({ root: this.root, dbPath: this.dbPath });
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

const workspaceIndexes = new Map<string, WorkspaceContentIndex>();

/** @internal Vitest override for db path resolution. */
let contentIndexDbPathOverride: ((workspaceDir: string) => string) | null = null;

/** @internal */
export function setContentIndexDbPathOverrideForTests(
  resolver: ((workspaceDir: string) => string) | null,
): void {
  contentIndexDbPathOverride = resolver;
  resetContentIndexForTests();
}

/** Persistent sqlite path for a workspace (creates home/repo-index dir when writable). */
export function resolveContentIndexDbPath(workspaceDir: string): string {
  const digest = createHash('sha256').update(workspaceDir).digest('hex').slice(0, 16);
  const fileName = `${digest}.sqlite`;
  try {
    const dir = join(resolveLioraHome(), 'repo-index');
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return join(dir, fileName);
  } catch {
    return join(tmpdir(), 'superliora-repo-index', fileName);
  }
}

function resolveDbPathForWorkspace(workspaceDir: string): string {
  if (contentIndexDbPathOverride !== null) {
    return contentIndexDbPathOverride(workspaceDir);
  }
  return resolveContentIndexDbPath(workspaceDir);
}

/** Process-level singleton per workspace — lazy FTS build on first query or warm. */
export function getContentIndexForWorkspace(workspaceDir: string): WorkspaceContentIndex {
  const existing = workspaceIndexes.get(workspaceDir);
  if (existing !== undefined) return existing;
  const index = new WorkspaceContentIndex(workspaceDir, resolveDbPathForWorkspace(workspaceDir));
  workspaceIndexes.set(workspaceDir, index);
  return index;
}

/** @internal Close and drop all workspace content indexes (Vitest isolation). */
export function resetContentIndexForTests(): void {
  for (const index of workspaceIndexes.values()) {
    index.close();
  }
  workspaceIndexes.clear();
}

/** @internal Close and drop one workspace content index singleton. */
export function resetContentIndexForWorkspace(workspaceDir: string): void {
  const existing = workspaceIndexes.get(workspaceDir);
  existing?.close();
  workspaceIndexes.delete(workspaceDir);
}
