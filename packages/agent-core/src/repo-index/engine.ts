/**
 * RepoIndex engine — SQLite FTS5 workspace content search (v1 micro-slice).
 *
 * When SUPERLIORA_REPO_INDEX_ENGINE=sqlite and a driver is available, builds
 * and queries a real FTS5 line index via content-indexer.ts.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import type { RepoQueryIndexStatus } from '#/tools/builtin/file/repo-query-core';
import type { MemoryLink } from '#/memory';

import {
  getContentIndexForWorkspace,
  resetContentIndexForTests,
  setContentIndexDbPathOverrideForTests,
} from './content-indexer';
import type { RepoIndexEngine } from './status';

export type SqliteDriver = 'node:sqlite' | 'better-sqlite3';

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
  readonly workspaceDir?: string | undefined;
}

export interface RepoIndexContentQueryResult {
  readonly results: readonly string[];
  readonly derived_links?: readonly MemoryLink[] | undefined;
  readonly index_status: RepoQueryIndexStatus;
  readonly hint: string;
  readonly next_step: string;
}

export const REPO_INDEX_CONTENT_STUB_HINT =
  'SQLite FTS5 workspace content index — real indexed lines (capped v1).';

export const REPO_INDEX_CONTENT_STUB_NEXT_STEP =
  'Use RepoQuery mode=content (Grep fallback) for paths outside the index cap or uncaptured files.';

export const REPO_INDEX_ZOEKT_STUB_HINT =
  'Zoekt sidecar — binary on PATH only; set SUPERLIORA_ZOEKT_URL for live HTTP search.';

export const REPO_INDEX_ZOEKT_LIVE_HINT =
  'Zoekt sidecar HTTP search — live results from indexed workspace.';

export const REPO_INDEX_ZOEKT_STUB_NEXT_STEP =
  'Use RepoQuery mode=content (Grep fallback) for workspace paths not yet indexed.';

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

/** @internal Close and drop workspace content indexes (Vitest isolation). */
export function resetRepoIndexSyntheticFtsForTests(): void {
  resetContentIndexForTests();
}

export {
  resetContentIndexForTests,
  setContentIndexDbPathOverrideForTests,
} from './content-indexer';

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
    reason: 'engine=stub — sqlite is default; set SUPERLIORA_REPO_INDEX_ENGINE=stub|off|none to opt out',
  };
}

function resolveWorkspaceDir(input: RepoIndexContentQueryInput): string {
  const fromInput = input.workspaceDir?.trim();
  if (fromInput !== undefined && fromInput.length > 0) {
    return fromInput;
  }
  return process.cwd();
}

function querySqliteContentIndex(
  input: RepoIndexContentQueryInput,
  limit: number,
): { readonly results: readonly string[]; readonly derivedLinks: readonly MemoryLink[] } {
  const workspaceDir = resolveWorkspaceDir(input);
  const index = getContentIndexForWorkspace(workspaceDir);
  if (!index.ensureReady()) return { results: [], derivedLinks: [] };
  const scope = input.path?.trim();
  const hits = index.queryHits(input.query, scope, limit);
  return {
    results: hits.map((hit) => `${hit.path}:L${String(hit.line)} ${hit.body}`),
    derivedLinks: hits.map((hit) => ({
      targetKind: 'file' as const,
      targetId: `${hit.path}#L${String(hit.line)}`,
      relation: 'derived:repo-index',
      confidence: 0.9,
      source: { kind: 'system' as const, excerpt: hit.body.slice(0, 240) },
    })),
  };
}

interface ZoektFragmentJson {
  readonly Pre?: string | undefined;
  readonly Match?: string | undefined;
  readonly Post?: string | undefined;
}

interface ZoektMatchJson {
  readonly LineNum?: number | undefined;
  readonly lineNum?: number | undefined;
  readonly LineNumber?: number | undefined;
  readonly Fragments?: readonly ZoektFragmentJson[] | undefined;
  readonly Before?: string | undefined;
  readonly After?: string | undefined;
  readonly Line?: string | undefined;
  readonly line?: string | undefined;
}

interface ZoektLineJson {
  readonly LineNumber?: number | undefined;
  readonly lineNumber?: number | undefined;
  readonly Line?: string | undefined;
  readonly line?: string | undefined;
}

interface ZoektFileMatchJson {
  readonly FileName?: string | undefined;
  readonly fileName?: string | undefined;
  readonly filename?: string | undefined;
  readonly Matches?: readonly ZoektMatchJson[] | undefined;
  readonly matches?: readonly ZoektMatchJson[] | undefined;
  readonly Lines?: readonly ZoektLineJson[] | undefined;
  readonly lines?: readonly ZoektLineJson[] | undefined;
}

interface ZoektSearchHttpOutcome {
  readonly ok: boolean;
  readonly results: readonly string[];
  readonly detail: string;
}

function normalizeZoektSidecarBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Append a zoekt `file:` scope when RepoQuery path is set. */
function buildZoektSearchQuery(query: string, scope: string | undefined): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (scope === undefined || scope.length === 0) {
    return trimmed;
  }
  const escapedScope = scope.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${trimmed} file:${escapedScope}`;
}

function buildZoektSearchUrl(
  sidecarUrl: string,
  input: RepoIndexContentQueryInput,
  limit: number,
): string | null {
  const scope = input.path?.trim();
  const query = buildZoektSearchQuery(input.query, scope);
  if (query === null) {
    return null;
  }
  const base = normalizeZoektSidecarBaseUrl(sidecarUrl);
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('num', String(limit));
  params.set('format', 'json');
  return `${base}/search?${params.toString()}`;
}

function zoektPathMatchesScope(fileName: string, scope: string | undefined): boolean {
  if (scope === undefined || scope.length === 0) {
    return true;
  }
  const normalizedScope = scope.replaceAll(/\\/g, '/').replace(/^\.\//, '').replaceAll(/%/g, '');
  const normalizedFile = fileName.replaceAll(/\\/g, '/');
  return normalizedFile.includes(normalizedScope);
}

function zoektMatchLineNum(match: ZoektMatchJson): number {
  return match.LineNum ?? match.lineNum ?? match.LineNumber ?? 0;
}

function zoektMatchBody(match: ZoektMatchJson): string {
  const fragments = match.Fragments ?? [];
  if (fragments.length > 0) {
    return fragments.map((fragment) => `${fragment.Pre ?? ''}${fragment.Match ?? ''}${fragment.Post ?? ''}`).join('');
  }
  if (match.Line !== undefined) {
    return match.Line;
  }
  if (match.line !== undefined) {
    return match.line;
  }
  const before = match.Before ?? '';
  const after = match.After ?? '';
  if (before.length > 0 || after.length > 0) {
    return `${before}${after}`.trim();
  }
  return '';
}

function zoektLineNum(line: ZoektLineJson): number {
  return line.LineNumber ?? line.lineNumber ?? 0;
}

function zoektLineBody(line: ZoektLineJson): string {
  return line.Line ?? line.line ?? '';
}

function extractZoektFileMatches(payload: unknown): readonly ZoektFileMatchJson[] {
  if (payload === null || typeof payload !== 'object') {
    return [];
  }
  const root = payload as Record<string, unknown>;
  const result = root['result'] ?? root['Result'];
  if (result !== null && typeof result === 'object') {
    const nested = result as Record<string, unknown>;
    const nestedMatches =
      nested['FileMatches'] ?? nested['fileMatches'] ?? nested['Files'] ?? nested['files'];
    if (Array.isArray(nestedMatches)) {
      return nestedMatches as ZoektFileMatchJson[];
    }
  }
  const topLevel = root['FileMatches'] ?? root['fileMatches'];
  if (Array.isArray(topLevel)) {
    return topLevel as ZoektFileMatchJson[];
  }
  return [];
}

function parseZoektSearchJson(
  payload: unknown,
  scope: string | undefined,
  limit: number,
): readonly string[] {
  const hits: string[] = [];
  for (const fileMatch of extractZoektFileMatches(payload)) {
    const fileName = fileMatch.FileName ?? fileMatch.fileName ?? fileMatch.filename ?? '';
    if (fileName.length === 0 || !zoektPathMatchesScope(fileName, scope)) {
      continue;
    }

    const matches = fileMatch.Matches ?? fileMatch.matches ?? [];
    for (const match of matches) {
      const body = zoektMatchBody(match);
      if (body.length === 0) {
        continue;
      }
      hits.push(`${fileName}:L${String(zoektMatchLineNum(match))} ${body}`);
      if (hits.length >= limit) {
        return hits;
      }
    }

    const lines = fileMatch.Lines ?? fileMatch.lines ?? [];
    for (const line of lines) {
      const body = zoektLineBody(line);
      if (body.length === 0) {
        continue;
      }
      hits.push(`${fileName}:L${String(zoektLineNum(line))} ${body}`);
      if (hits.length >= limit) {
        return hits;
      }
    }
  }
  return hits;
}

async function searchZoektSidecarHttp(
  sidecarUrl: string,
  input: RepoIndexContentQueryInput,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<ZoektSearchHttpOutcome> {
  const searchUrl = buildZoektSearchUrl(sidecarUrl, input, limit);
  if (searchUrl === null) {
    return { ok: true, results: [], detail: 'empty query' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() =>{  controller.abort(); }, ZOEKT_HTTP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        ok: false,
        results: [],
        detail: `HTTP ${String(response.status)}`,
      };
    }
    const payload: unknown = await response.json();
    const scope = input.path?.trim();
    const results = parseZoektSearchJson(payload, scope, limit);
    return {
      ok: true,
      results,
      detail: results.length > 0 ? `${String(results.length)} hit(s)` : 'no hits',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, results: [], detail: message };
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

  const scope = input.path?.trim();
  const scopeNote = scope !== undefined && scope.length > 0 ? ` scope=${scope}` : '';
  const limit = input.limit ?? 50;
  const search = await searchZoektSidecarHttp(probe.detail, input, limit, fetchImpl);

  if (search.ok) {
    if (search.results.length > 0) {
      return {
        results: search.results,
        index_status: 'partial',
        hint: `${REPO_INDEX_ZOEKT_LIVE_HINT}${scopeNote} · sidecar=${probe.detail} · ${search.detail}`,
        next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
      };
    }
    return {
      results: [],
      index_status: 'cold',
      hint: `${REPO_INDEX_ZOEKT_LIVE_HINT}${scopeNote} · sidecar=${probe.detail} · ${search.detail}`,
      next_step: REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
    };
  }

  return {
    results: [],
    index_status: 'cold',
    hint: `${REPO_INDEX_ZOEKT_LIVE_HINT}${scopeNote} · sidecar=${probe.detail} · search failed (${search.detail})`,
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
 * Content query — SQLite FTS5 workspace index when engine=sqlite; never throws.
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

  const indexed = querySqliteContentIndex(input, limit);
  if (indexed.results.length > 0) {
    return {
      results: indexed.results,
      derived_links: indexed.derivedLinks,
      index_status: 'partial',
      hint: `${REPO_INDEX_CONTENT_STUB_HINT}${scopeNote} · driver=${wire.driver ?? 'unknown'} · ${String(indexed.results.length)} hit(s)`,
      next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
    };
  }

  return {
    results: [],
    index_status: 'cold',
    hint: `${REPO_INDEX_CONTENT_STUB_HINT}${scopeNote} · driver=${wire.driver ?? 'unknown'} · no indexed hits`,
    next_step: REPO_INDEX_CONTENT_STUB_NEXT_STEP,
  };
}
