/**
 * Read-only codemap / symbol-index probe for Settings → Index and Ops glances.
 * Does not run a full index build — only checks git + existing sqlite rows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { resolveCodemapDbPath } from '#/codemap/code-map';
import { SymbolIndexStore } from '#/codemap/store';

export type CodemapWarmth = 'warm' | 'cold' | 'unavailable';

export interface CodemapStatus {
  readonly warmth: CodemapWarmth;
  readonly dbPath: string;
  readonly gitRepo: boolean;
  readonly fileCount: number | null;
  readonly symbolCount: number | null;
  readonly note: string | null;
}

export const CODEMAP_SYMBOL_VIA_REPOQUERY_TIP =
  'Symbol index via RepoQuery mode=symbol (builds on first use in git repos).';

/** Lightweight git-workspace check — no index build. */
export function isCodemapGitWorkspace(workspaceDir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: workspaceDir,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

/** Probe on-disk sqlite without triggering CodeMap.ensureReady(). */
export function getCodemapStatus(workspaceDir: string): CodemapStatus {
  const dbPath = resolveCodemapDbPath(workspaceDir);
  const gitRepo = isCodemapGitWorkspace(workspaceDir);

  if (!gitRepo) {
    return {
      warmth: 'unavailable',
      dbPath,
      gitRepo: false,
      fileCount: null,
      symbolCount: null,
      note: 'not a git repo — outline mode only per file',
    };
  }

  const counts = probeExistingDb(dbPath, workspaceDir);
  if (counts === null || counts.symbolCount === 0) {
    return {
      warmth: 'cold',
      dbPath,
      gitRepo: true,
      fileCount: counts?.fileCount ?? null,
      symbolCount: counts?.symbolCount ?? null,
      note: CODEMAP_SYMBOL_VIA_REPOQUERY_TIP,
    };
  }

  return {
    warmth: 'warm',
    dbPath,
    gitRepo: true,
    fileCount: counts.fileCount,
    symbolCount: counts.symbolCount,
    note: null,
  };
}

function probeExistingDb(
  dbPath: string,
  workspaceDir: string,
): { readonly fileCount: number; readonly symbolCount: number } | null {
  if (!existsSync(dbPath)) return null;
  try {
    const store = new SymbolIndexStore(dbPath);
    try {
      const root = store.getMeta('workspace_root');
      if (root !== undefined && root !== workspaceDir) {
        return null;
      }
      return {
        fileCount: store.fileCount(),
        symbolCount: store.symbolCount(),
      };
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}

/** Compact warmth line for Settings → Index. */
export function formatCodemapStatusLine(status: CodemapStatus): string {
  switch (status.warmth) {
    case 'warm':
      return (
        `Symbol codemap: warm · ${String(status.fileCount ?? 0)} files · ` +
        `${String(status.symbolCount ?? 0)} symbols`
      );
    case 'cold':
      return 'Symbol codemap: cold — builds on first RepoQuery mode=symbol';
    default:
      return `Symbol codemap: unavailable (${status.note ?? 'unknown'})`;
  }
}

/** SQLite path line — omits home prefix noise when possible. */
export function formatCodemapDbLine(status: CodemapStatus): string {
  return `Codemap sqlite: ${status.dbPath}`;
}
