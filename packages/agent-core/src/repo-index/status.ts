/**
 * RepoIndex platform status — soft stub until W3 engine lands (Sovereign Reform §6).
 *
 * Symbol-only codemap (RepoQuery mode=symbol) is separate; this reports the
 * unified FTS/content index product surface.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getRepoIndexEngineWireStatus, type SqliteDriver } from './engine';

export type RepoIndexBackend = 'none' | 'sqlite-fts5' | 'ast-grep' | 'zoekt';

/** Soft engine selector while stub — env preview or live when wired. */
export type RepoIndexEngine = 'stub' | 'sqlite' | 'zoekt';

export const REPO_INDEX_ENGINE_ENV = 'SUPERLIORA_REPO_INDEX_ENGINE';

export interface RepoIndexStatus {
  readonly enabled: boolean;
  readonly backend: RepoIndexBackend;
  readonly engine: RepoIndexEngine;
  readonly wired: boolean;
  readonly driver: SqliteDriver | null;
  readonly wireReason: string | null;
  readonly tip: string;
  readonly ftsBackendTip: string;
}

export const REPO_INDEX_FTS_BACKEND_TIP =
  'FTS backends: SQLite FTS5 (1차, bundled) vs Zoekt sidecar (opt-in, high-perf content).';

export const REPO_INDEX_FUTURE_ENABLE_TIP =
  'Future: config [index] enable + backend (fts/ast-grep/zoekt) · warm on session start.';

/** Session-start codemap + sqlite FTS content warm — ON by default; opt-out SUPERLIORA_REPO_INDEX_WARM=0. */
export const REPO_INDEX_WARM_PARALLEL_TIP =
  'Codemap fire-and-forget ensureReady at session start (default ON) · sqlite FTS content index warm when engine=sqlite · opt-out: SUPERLIORA_REPO_INDEX_WARM=0.';

/** Sovereign Reform §6 — 1차 bundled FTS5; zoekt sidecar stays opt-in. */
export const REPO_INDEX_PREFERRED_ENGINE: RepoIndexEngine = 'sqlite';

/** Session (live) when {@link REPO_INDEX_ENGINE_ENV} unset — documents sqlite default and opt-outs. */
export const REPO_INDEX_PREFERRED_ENGINE_TIP =
  `RepoIndex engine: ${REPO_INDEX_PREFERRED_ENGINE} (default) — opt-out: ${REPO_INDEX_ENGINE_ENV}=stub|off|none · zoekt sidecar: ${REPO_INDEX_ENGINE_ENV}=zoekt.`;

const ENGINE_MODULE_CANDIDATES = ['engine.ts', 'content-index.ts', 'service.ts'] as const;

/** True when an engine module file exists beside status.ts. */
export function isRepoIndexEngineModulePresent(): boolean {
  const here = dirname(fileURLToPath(import.meta.url));
  return ENGINE_MODULE_CANDIDATES.some((name) => existsSync(join(here, name)));
}

/** Live hook — module present and selected engine has a soft-wired driver path. */
export function isRepoIndexEngineWired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isRepoIndexEngineModulePresent()) return false;
  const engine = parseRepoIndexEngineEnv(env[REPO_INDEX_ENGINE_ENV]);
  return getRepoIndexEngineWireStatus(engine).wired;
}

/** True when {@link REPO_INDEX_ENGINE_ENV} is unset or blank (engine resolves to sqlite default). */
export function isRepoIndexEngineEnvUnset(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[REPO_INDEX_ENGINE_ENV]?.trim();
  return raw === undefined || raw.length === 0;
}

/** Session (live) default-engine tip when {@link REPO_INDEX_ENGINE_ENV} unset. */
export function repoIndexPreferredEngineTipLine(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isRepoIndexEngineEnvUnset(env)) return null;
  return REPO_INDEX_PREFERRED_ENGINE_TIP;
}

export function parseRepoIndexEngineEnv(raw: string | undefined): RepoIndexEngine {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return 'sqlite';
  }
  switch (normalized) {
    case 'stub':
    case 'off':
    case 'none':
      return 'stub';
    case 'sqlite':
    case 'sqlite-fts5':
    case 'fts':
    case 'fts5':
      return 'sqlite';
    case 'zoekt':
      return 'zoekt';
    default:
      return 'stub';
  }
}

function engineToBackend(engine: RepoIndexEngine): RepoIndexBackend {
  switch (engine) {
    case 'sqlite':
      return 'sqlite-fts5';
    case 'zoekt':
      return 'zoekt';
    default:
      return 'none';
  }
}

/** Read-only status — env preview when stub; live backend when engine soft-wires. */
export function getRepoIndexStatus(env: NodeJS.ProcessEnv = process.env): RepoIndexStatus {
  const engine = parseRepoIndexEngineEnv(env[REPO_INDEX_ENGINE_ENV]);
  const modulePresent = isRepoIndexEngineModulePresent();
  const wire = modulePresent
    ? getRepoIndexEngineWireStatus(engine)
    : { wired: false, driver: null, reason: 'engine module missing' as const };
  const wired = wire.wired;
  const backend = wired ? engineToBackend(engine) : engine === 'stub' ? 'none' : engineToBackend(engine);

  return {
    enabled: wired,
    backend,
    engine,
    wired,
    driver: wire.driver,
    wireReason: wire.reason,
    tip: wired ? REPO_INDEX_CONTENT_STUB_TIP : REPO_INDEX_FUTURE_ENABLE_TIP,
    ftsBackendTip: REPO_INDEX_FTS_BACKEND_TIP,
  };
}

const REPO_INDEX_CONTENT_STUB_TIP =
  'SQLite FTS5 workspace content index — real indexed lines (capped v1).';

/** Compact backend line for Settings → Index and Ops glances. */
export function formatRepoIndexBackendLine(status: RepoIndexStatus): string {
  if (status.enabled) {
    const driver = status.driver !== null ? ` · driver=${status.driver}` : '';
    return `FTS backend: ${status.backend} (live${driver})`;
  }
  if (status.engine === 'stub') {
    return (
      'FTS backend: not wired yet · planned SQLite FTS5 or Zoekt sidecar · ' +
      `engine=stub (${REPO_INDEX_ENGINE_ENV}=stub|off|none)`
    );
  }
  const reason =
    status.wireReason !== null && status.wireReason.length > 0 ? ` · ${status.wireReason}` : '';
  return (
    `FTS backend: not wired yet · env target ${engineToBackend(status.engine)} · ` +
    `engine=${status.engine} (${REPO_INDEX_ENGINE_ENV}=${status.engine})${reason}`
  );
}

/** Engine enablement line — distinct from RepoQuery tool registration. */
export function formatRepoIndexEngineLine(status: RepoIndexStatus): string {
  if (status.enabled) {
    const driver = status.driver !== null ? ` · driver=${status.driver}` : '';
    return `RepoIndex engine: enabled (${status.backend} · engine=${status.engine}${driver})`;
  }
  const reason =
    status.wireReason !== null && status.wireReason.length > 0 ? ` · ${status.wireReason}` : '';
  return (
    'RepoIndex engine: disabled (stub — symbol codemap only via RepoQuery) · ' +
    `engine=${status.engine}${reason}`
  );
}

/** Live wire probe — engine selector, driver, and wired flag from getRepoIndexStatus. */
export function formatRepoIndexWiredLine(status: RepoIndexStatus): string {
  const driver = status.driver !== null ? ` · driver=${status.driver}` : '';
  const reason =
    !status.wired && status.wireReason !== null && status.wireReason.length > 0
      ? ` · ${status.wireReason}`
      : '';
  return `RepoIndex wire: ${status.wired ? 'live' : 'not live'} · engine=${status.engine}${driver}${reason}`;
}
