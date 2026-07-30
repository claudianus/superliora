import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'pathe';

import type { WebSearchResult } from '../builtin/web/web-search';

import {
  asRecord,
  buildResult,
  hasUsableUrl,
  prefixedSnippet,
  stringValue,
} from './local-web-search-shared';

interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

interface SearchCacheRow {
  readonly results_json: string;
  readonly created_at: number;
  readonly ttl_ms: number;
}

export class LocalResearchCache {
  private readonly db: SqliteDatabase;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const require = createRequire(import.meta.url);
    const sqlite = require('node:sqlite') as SqliteModule;
    this.db = new sqlite.DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS local_research_search_cache (
        key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        results_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      );
    `);
  }

  get(
    key: string,
    now: number,
    options: { readonly allowStale: boolean; readonly mark?: string },
  ): WebSearchResult[] | undefined {
    const row = this.db
      .prepare('SELECT results_json, created_at, ttl_ms FROM local_research_search_cache WHERE key = ?')
      .get(key);
    if (!isSearchCacheRow(row)) return undefined;
    const expired = row.created_at + row.ttl_ms < now;
    if (expired && !options.allowStale) return undefined;
    const parsed = parseCachedResults(row.results_json);
    if (parsed === undefined) return undefined;
    const mark = options.mark;
    if (mark === undefined) return parsed;
    return parsed.map((result) => buildResult({
      title: result.title,
      url: result.url,
      snippet: prefixedSnippet(mark, result.snippet),
      date: result.date,
      content: result.content,
    }));
  }

  set(
    key: string,
    query: string,
    results: readonly WebSearchResult[],
    ttlMs: number,
    now: number,
  ): void {
    this.db
      .prepare(`
        INSERT INTO local_research_search_cache (key, query, results_json, created_at, ttl_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          query = excluded.query,
          results_json = excluded.results_json,
          created_at = excluded.created_at,
          ttl_ms = excluded.ttl_ms
      `)
      .run(key, query, JSON.stringify(results), now, ttlMs);
  }
}

function isSearchCacheRow(value: unknown): value is SearchCacheRow {
  const row = asRecord(value);
  return (
    row !== undefined &&
    typeof row['results_json'] === 'string' &&
    typeof row['created_at'] === 'number' &&
    typeof row['ttl_ms'] === 'number'
  );
}

function parseCachedResults(value: string): WebSearchResult[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
      .map((entry) => buildResult({
        title: stringValue(entry['title']) ?? '',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
        date: stringValue(entry['date']),
        content: stringValue(entry['content']),
      }))
      .filter(hasUsableUrl);
  } catch {
    return undefined;
  }
}
