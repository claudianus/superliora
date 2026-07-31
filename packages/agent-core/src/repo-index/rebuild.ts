/**
 * RepoIndex rebuild — clear + ensureReady for symbol codemap and sqlite FTS content.
 */
import { getCodeMapForWorkspace } from '#/codemap/code-map';
import { getCodemapStatus, isCodemapGitWorkspace, type CodemapWarmth } from '#/codemap/status';

import { getContentIndexForWorkspace } from './content-indexer';
import { getRepoIndexEngineWireStatus } from './engine';
import { parseRepoIndexEngineEnv, REPO_INDEX_ENGINE_ENV } from './status';

export interface RepoIndexRebuildResult {
  readonly ok: boolean;
  readonly ms: number;
  readonly warmth: CodemapWarmth;
  readonly codemapFiles: number | null;
  readonly codemapSymbols: number | null;
  readonly contentFiles: number | null;
  readonly contentLines: number | null;
  readonly contentMs: number | null;
  readonly contentSkipped: boolean;
  readonly contentSkipReason: string | null;
  readonly note: string | null;
}

export interface RebuildRepoIndexOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/** Clear and rebuild symbol codemap; sqlite FTS content when engine=sqlite and wired. */
export function rebuildRepoIndex(
  workDir: string,
  options: RebuildRepoIndexOptions = {},
): RepoIndexRebuildResult {
  const env = options.env ?? process.env;
  const started = Date.now();
  const trimmed = workDir.trim();
  if (trimmed.length === 0) {
    return emptyFailure(started, 'unavailable', 'workspace directory is empty');
  }

  if (!isCodemapGitWorkspace(trimmed)) {
    return emptyFailure(
      started,
      'unavailable',
      'not a git repo — symbol index requires a git workspace',
    );
  }

  const engine = parseRepoIndexEngineEnv(env[REPO_INDEX_ENGINE_ENV]);
  const codemapResult = getCodeMapForWorkspace(trimmed).rebuild();
  if (!codemapResult.ok) {
    return {
      ok: false,
      ms: Date.now() - started,
      warmth: 'cold',
      codemapFiles: null,
      codemapSymbols: null,
      contentFiles: null,
      contentLines: null,
      contentMs: null,
      contentSkipped: true,
      contentSkipReason: 'symbol index rebuild failed',
      note: 'symbol index rebuild failed',
    };
  }

  let contentFiles: number | null = null;
  let contentLines: number | null = null;
  let contentMs: number | null = null;
  let contentSkipped = true;
  let contentSkipReason: string | null = null;

  if (engine === 'sqlite') {
    const wire = getRepoIndexEngineWireStatus('sqlite');
    if (wire.wired) {
      const contentResult = getContentIndexForWorkspace(trimmed).rebuild();
      contentSkipped = false;
      if (contentResult.ok && contentResult.report !== null) {
        contentFiles = contentResult.report.indexed;
        contentLines = contentResult.report.lines;
        contentMs = contentResult.report.ms;
      } else {
        contentSkipReason = 'sqlite FTS content rebuild failed';
      }
    } else {
      contentSkipReason = wire.reason ?? 'sqlite driver unavailable';
    }
  } else if (engine === 'zoekt') {
    contentSkipReason = 'zoekt sidecar manages its own index';
  } else {
    contentSkipReason = `engine=${engine} — FTS content index disabled`;
  }

  const status = getCodemapStatus(trimmed);
  const codemapReport = codemapResult.report;

  return {
    ok: true,
    ms: Date.now() - started,
    warmth: status.warmth,
    codemapFiles: status.fileCount ?? codemapReport?.indexed ?? null,
    codemapSymbols: status.symbolCount ?? codemapReport?.symbols ?? null,
    contentFiles,
    contentLines,
    contentMs,
    contentSkipped,
    contentSkipReason,
    note: status.note,
  };
}

function emptyFailure(
  started: number,
  warmth: CodemapWarmth,
  note: string,
): RepoIndexRebuildResult {
  return {
    ok: false,
    ms: Date.now() - started,
    warmth,
    codemapFiles: null,
    codemapSymbols: null,
    contentFiles: null,
    contentLines: null,
    contentMs: null,
    contentSkipped: true,
    contentSkipReason: null,
    note,
  };
}

/** Compact rebuild outcome for Settings → Index. */
export function formatRepoIndexRebuildResultLine(result: RepoIndexRebuildResult): string {
  if (!result.ok) {
    return `Last rebuild: failed · ${result.note ?? 'unknown error'} · ${String(result.ms)}ms`;
  }

  const warmth =
    result.warmth === 'warm'
      ? 'warm'
      : result.warmth === 'cold'
        ? 'cold'
        : 'unavailable';
  const files = result.codemapFiles ?? 0;
  const symbols = result.codemapSymbols ?? 0;
  let ftsPart: string;
  if (result.contentSkipped) {
    const reason =
      result.contentSkipReason !== null && result.contentSkipReason.length > 0
        ? result.contentSkipReason
        : 'FTS skipped';
    ftsPart = `FTS skipped (${reason})`;
  } else if (result.contentFiles !== null) {
    ftsPart = `FTS ${String(result.contentFiles)} files`;
    if (result.contentMs !== null) {
      ftsPart += ` · ${String(result.contentMs)}ms FTS`;
    }
  } else {
    ftsPart = 'FTS failed';
  }

  return (
    `Last rebuild: ${warmth} · ${String(files)} files · ${String(symbols)} symbols · ` +
    `${ftsPart} · ${String(result.ms)}ms`
  );
}
