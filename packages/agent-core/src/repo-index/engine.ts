/**
 * RepoIndex engine soft stub — SQLite FTS5 path (W3 preview).
 *
 * Reports driver availability and serves synthetic FTS5 hits (in-memory probe
 * rows) until the full workspace indexer lands.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import type { RepoQueryIndexStatus } from '#/tools/builtin/file/repo-query-core';

import type { RepoIndexEngine } from './status';

export type SqliteDriver = 'node:sqlite' | 'better-sqlite3';

/** Known token seeded in the synthetic FTS5 table — stable for unit tests. */
export const REPO_INDEX_SYNTHETIC_PROBE_TOKEN = 'RepoIndex';

interface SqliteStatement {
  run(...params: readonly (string | number | null)[]): unknown;
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

const SYNTHETIC_FTS_ROWS = [
  {
    path: 'src/repo-index/engine.ts',
    line: 1,
    body: `${REPO_INDEX_SYNTHETIC_PROBE_TOKEN} synthetic FTS5 probe row for sqlite engine preview.`,
  },
  {
    path: 'packages/agent-core/README.md',
    line: 42,
    body: 'SUPERLIORA_REPO_INDEX_PROBE secondary synthetic preview row.',
  },
] as const;

const SYNTHETIC_FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS repo_content USING fts5(
  path UNINDEXED,
  line UNINDEXED,
  body
);
`;

let syntheticFtsDb: SqliteDatabase | null = null;

export interface SqliteDriverProbe {
  readonly available: boolean;
  readonly driver: SqliteDriver | null;
  readonly reason: string | null;
}

export interface RepoIndexEngineWireStatus {
  readonly wired: boolean;
  readonly driver: SqliteDriver | null;
  readonly reason: string | null;
}

export interface RepoIndexContentQueryInput {
  readonly query: string;
  readonly path?: string | undefined;
  readonly limit?: number | undefined;
}

export interface RepoIndexContentQueryResult {
  readonly results: readonly string[];
  readonly index_status: RepoQueryIndexStatus;
  readonly hint: string;
  readonly next_step: string;
}

export const REPO_INDEX_CONTENT_STUB_HINT =
  'SQLite FTS5 synthetic preview — probe rows only; workspace indexer not shipped yet.';

export const REPO_INDEX_CONTENT_STUB_NEXT_STEP =
  'Use RepoQuery mode=content (Grep fallback) for real workspace search until FTS warm path ships.';

export const REPO_INDEX_ZOEKT_STUB_HINT =
  'Zoekt sidecar soft stub — HTTP probe only; workspace content indexer not shipped yet.';

export const REPO_INDEX_ZOEKT_STUB_NEXT_STEP =
  'Use RepoQuery mode=content (Grep fallback) for real workspace search until Zoekt index ships.';

export const REPO_INDEX_ZOEKT_URL_ENV = 'SUPERLIORA_ZOEKT_URL';

const ZOEKT_HTTP_PROBE_TIMEOUT_MS = 2_500;

/** Zoekt sidecar binaries probed on PATH (first match wins). */
export const REPO_INDEX_ZOEKT_BINARY_CANDIDATES = ['zoekt-webserver', 'zoekt'] as const;

export type ZoektSidecarSource = 'binary' | 'url';

export interface ZoektSidecarProbe {
  readonly available: boolean;
  readonly source: ZoektSidecarSource | null;
  readonly detail: string | null;
  readonly reason: string | null;
}

/** @internal Vitest override for driver-unavailable branches. */
let sqliteDriverProbeOverride: (() => SqliteDriverProbe) | null = null;

/** @internal Vitest override for zoekt sidecar probe branches. */
let zoektSidecarProbeOverride: ((env: NodeJS.ProcessEnv) => ZoektSidecarProbe) | null = null;

/** @internal Vitest override for zoekt HTTP probe fetch. */
let zoektFetchOverride: typeof fetch | null = null;

export interface QueryRepoIndexContentAsyncOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/** @internal */
export function setSqliteDriverProbeOverrideForTests(
  override: (() => SqliteDriverProbe) | null,
): void {
  sqliteDriverProbeOverride = override;
}

/** @internal */
export function resetSqliteDriverProbeOverride(): void {
  sqliteDriverProbeOverride = null;
}

/** @internal */
export function setZoektSidecarProbeOverrideForTests(
  override: ((env: NodeJS.ProcessEnv) => ZoektSidecarProbe) | null,
): void {
  zoektSidecarProbeOverride = override;
}

/** @internal */
export function resetZoektSidecarProbeOverride(): void {
  zoektSidecarProbeOverride = null;
}

/** @internal */
export function setZoektFetchOverrideForTests(fetchImpl: typeof fetch | null): void {
  zoektFetchOverride = fetchImpl;
}

/** @internal */
export function resetZoektFetchOverride(): void {
  zoektFetchOverride = null;
}

/** @internal Close and drop the in-memory synthetic FTS database (Vitest isolation). */
export function resetRepoIndexSyntheticFtsForTests(): void {
  syntheticFtsDb?.close();
  syntheticFtsDb = null;
}

function loadNodeSqliteModule(): SqliteModule {
  const require = createRequire(import.meta.url);
  return require('node:sqlite') as SqliteModule;
}

function getSyntheticFtsDb(): SqliteDatabase {
  if (syntheticFtsDb !== null) {
    return syntheticFtsDb;
  }
  const db = new (loadNodeSqliteModule().DatabaseSync)(':memory:');
  db.exec(SYNTHETIC_FTS_SCHEMA);
  const insert = db.prepare('INSERT INTO repo_content (path, line, body) VALUES (?, ?, ?)');
  for (const row of SYNTHETIC_FTS_ROWS) {
    insert.run(row.path, row.line, row.body);
  }
  syntheticFtsDb = db;
  return db;
}

/** Quote a single FTS5 token for the synthetic preview matcher. */
function escapeFts5Token(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[\w.-]+$/u.test(trimmed)) {
    return null;
  }
  return `"${trimmed.replace(/"/g, '""')}"`;
}

function querySyntheticFts(
  input: RepoIndexContentQueryInput,
  limit: number,
): readonly string[] {
  const match = escapeFts5Token(input.query);
  if (match === null) {
    return [];
  }

  const db = getSyntheticFtsDb();
  const scope = input.path?.trim();
  let sql = 'SELECT path, line, body FROM repo_content WHERE repo_content MATCH ?';
  const params: (string | number)[] = [match];
  if (scope !== undefined && scope.length > 0) {
    sql += ' AND path LIKE ?';
    params.push(`%${scope.replace(/%/g, '')}%`);
  }
  sql += ' LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => {
    const path = String(row['path'] ?? '');
    const line = String(row['line'] ?? '');
    const body = String(row['body'] ?? '');
    return `${path}:L${line} ${body}`;
  });
}

/** Probe node:sqlite first (bundled on Node >=22.5), then optional better-sqlite3. */
export function probeSqliteDriver(): SqliteDriverProbe {
  if (sqliteDriverProbeOverride !== null) {
    return sqliteDriverProbeOverride();
  }
  return probeSqliteDriverLive();
}

function isExecutableOnPath(name: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [name], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function probeZoektBinaryOnPath(): { found: boolean; binary: string | null } {
  for (const candidate of REPO_INDEX_ZOEKT_BINARY_CANDIDATES) {
    if (isExecutableOnPath(candidate)) {
      return { found: true, binary: candidate };
    }
  }
  return { found: false, binary: null };
}

function parseZoektSidecarUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/** Probe zoekt sidecar via SUPERLIORA_ZOEKT_URL or a zoekt binary on PATH. */
export function probeZoektSidecar(env: NodeJS.ProcessEnv = process.env): ZoektSidecarProbe {
  if (zoektSidecarProbeOverride !== null) {
    return zoektSidecarProbeOverride(env);
  }
  return probeZoektSidecarLive(env);
}

function probeZoektSidecarLive(env: NodeJS.ProcessEnv): ZoektSidecarProbe {
  const url = parseZoektSidecarUrl(env[REPO_INDEX_ZOEKT_URL_ENV]);
  if (url !== null) {
    return {
      available: true,
      source: 'url',
      detail: url,
      reason: null,
    };
  }

  const binary = probeZoektBinaryOnPath();
  if (binary.found && binary.binary !== null) {
    return {
      available: true,
      source: 'binary',
      detail: binary.binary,
      reason: null,
    };
  }

  const rawUrl = env[REPO_INDEX_ZOEKT_URL_ENV]?.trim();
  if (rawUrl !== undefined && rawUrl.length > 0) {
    return {
      available: false,
      source: null,
      detail: null,
      reason: `${REPO_INDEX_ZOEKT_URL_ENV} is set but not a valid http(s) URL`,
    };
  }

  return {
    available: false,
    source: null,
    detail: null,
    reason: `no zoekt sidecar — set ${REPO_INDEX_ZOEKT_URL_ENV} or install zoekt on PATH (${REPO_INDEX_ZOEKT_BINARY_CANDIDATES.join('|')})`,
  };
}

function probeSqliteDriverLive(): SqliteDriverProbe {
  const require = createRequire(import.meta.url);
  try {
    require('node:sqlite');
    return { available: true, driver: 'node:sqlite', reason: null };
  } catch (nodeError) {
    try {
      require('better-sqlite3');
      return { available: true, driver: 'better-sqlite3', reason: null };
    } catch (betterError) {
      const nodeMsg = nodeError instanceof Error ? nodeError.message : String(nodeError);
      const betterMsg = betterError instanceof Error ? betterError.message : String(betterError);
      return {
        available: false,
        driver: null,
        reason: `no sqlite driver (node:sqlite: ${nodeMsg}; better-sqlite3: ${betterMsg})`,
      };
    }
  }
}

/** Soft wire — sqlite engine is live only when a sqlite driver is available. */
export function getRepoIndexEngineWireStatus(engine: RepoIndexEngine): RepoIndexEngineWireStatus {
  if (engine === 'sqlite') {
    const probe = probeSqliteDriver();
    if (probe.available && probe.driver !== null) {
      return { wired: true, driver: probe.driver, reason: null };
    }
    return {
      wired: false,
      driver: null,
      reason: probe.reason ?? 'sqlite driver unavailable',
    };
  }
  if (engine === 'zoekt') {
    const probe = probeZoektSidecar();
    if (probe.available) {
      return { wired: true, driver: null, reason: null };
    }
    return {
      wired: false,
      driver: null,
      reason: probe.reason ?? 'zoekt sidecar unavailable',
    };
  }
  return {
    wired: false,
    driver: null,
    reason: 'engine=stub — set SUPERLIORA_REPO_INDEX_ENGINE=sqlite or zoekt',
  };
}

async function probeZoektSidecarHttp(
  sidecarUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ readonly reachable: boolean; readonly detail: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ZOEKT_HTTP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(sidecarUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: '*/*' },
    });
    return { reachable: true, detail: `HTTP ${String(response.status)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reachable: false, detail: message };
  } finally {
    clearTimeout(timeout);
  }
}

function queryZoektSidecarStubSync(
  input: RepoIndexContentQueryInput,
  env: NodeJS.ProcessEnv,
): RepoIndexContentQueryResult {
  const wire = getRepoIndexEngineWireStatus('zoekt');
  const probe = probeZoektSidecar(env);
  const scope = input.path?.trim();
  const scopeNote = scope !== undefined && scope.length > 0 ? ` scope=${scope}` : '';

  if (!wire.wired) {
    return {
      results: [],
      index_status: 'cold',
      hint: wire.reason ?? 'zoekt sidecar unavailable',
      next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
    };
  }

  if (probe.source === 'binary') {
    return {
      results: [],
      index_status: 'cold',
      hint: `${REPO_INDEX_ZOEKT_STUB_HINT}${scopeNote} · binary=${probe.detail ?? 'zoekt'}`,
      next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
    };
  }

  return {
    results: [],
    index_status: 'cold',
    hint: `${REPO_INDEX_ZOEKT_STUB_HINT}${scopeNote} · sidecar=${probe.detail ?? 'unknown'}`,
    next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
  };
}

async function queryZoektSidecarStubAsync(
  input: RepoIndexContentQueryInput,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<RepoIndexContentQueryResult> {
  const sync = queryZoektSidecarStubSync(input, env);
  const probe = probeZoektSidecar(env);
  if (!probe.available || probe.source !== 'url' || probe.detail === null) {
    return sync;
  }

  const http = await probeZoektSidecarHttp(probe.detail, fetchImpl);
  const scope = input.path?.trim();
  const scopeNote = scope !== undefined && scope.length > 0 ? ` scope=${scope}` : '';
  const probeNote = http.reachable
    ? ` · probe=${http.detail}`
    : ` · probe failed (${http.detail})`;

  return {
    results: [],
    index_status: 'cold',
    hint: `${REPO_INDEX_ZOEKT_STUB_HINT}${scopeNote} · sidecar=${probe.detail}${probeNote}`,
    next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
  };
}

/**
 * Async content query — zoekt HTTP soft stub when sidecar URL is wired; sqlite stays sync inside.
 */
export async function queryRepoIndexContentAsync(
  input: RepoIndexContentQueryInput,
  engine: RepoIndexEngine,
  options: QueryRepoIndexContentAsyncOptions = {},
): Promise<RepoIndexContentQueryResult> {
  if (engine === 'sqlite') {
    return queryRepoIndexContent(input, engine);
  }
  if (engine === 'zoekt') {
    const env = options.env ?? process.env;
    const fetchImpl = options.fetchImpl ?? zoektFetchOverride ?? fetch;
    return queryZoektSidecarStubAsync(input, env, fetchImpl);
  }
  return queryRepoIndexContent(input, engine);
}

/**
 * Content query — synthetic FTS5 preview when node:sqlite is wired; never throws.
 */
export function queryRepoIndexContent(
  input: RepoIndexContentQueryInput,
  engine: RepoIndexEngine,
): RepoIndexContentQueryResult {
  const wire = getRepoIndexEngineWireStatus(engine);
  const scope = input.path?.trim();
  const scopeNote = scope !== undefined && scope.length > 0 ? ` scope=${scope}` : '';
  const limit = input.limit ?? 50;

  if (engine === 'zoekt') {
    return queryZoektSidecarStubSync(input, process.env);
  }

  if (engine !== 'sqlite') {
    return {
      results: [],
      index_status: 'cold',
      hint: `RepoIndex content query not wired for engine=${engine}.`,
      next_step: 'Set SUPERLIORA_REPO_INDEX_ENGINE=sqlite or use RepoQuery Grep fallback.',
    };
  }

  if (!wire.wired) {
    return {
      results: [],
      index_status: 'cold',
      hint: wire.reason ?? 'sqlite driver unavailable',
      next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
    };
  }

  if (wire.driver !== 'node:sqlite') {
    return {
      results: [],
      index_status: 'cold',
      hint: `${REPO_INDEX_CONTENT_STUB_HINT}${scopeNote} · driver=${wire.driver ?? 'unknown'} (FTS preview requires node:sqlite)`,
      next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
    };
  }

  const results = querySyntheticFts(input, limit);
  if (results.length > 0) {
    return {
      results,
      index_status: 'partial',
      hint: `${REPO_INDEX_CONTENT_STUB_HINT}${scopeNote} · driver=${wire.driver}`,
      next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
    };
  }

  return {
    results: [],
    index_status: 'cold',
    hint: `${REPO_INDEX_CONTENT_STUB_HINT}${scopeNote} · driver=${wire.driver ?? 'unknown'} · no synthetic hits`,
    next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
  };
}
