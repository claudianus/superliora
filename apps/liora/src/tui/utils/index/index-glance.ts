/**
 * Index settings glance — live RepoQuery + codemap + getRepoIndexStatus wire (SSOT §6 / §9.2).
 */

import {
  CODEMAP_SYMBOL_VIA_REPOQUERY_TIP,
  type CodemapStatus,
  formatCodemapDbLine,
  formatCodemapStatusLine,
  formatRepoIndexBackendLine,
  formatRepoIndexEngineLine,
  formatRepoIndexRebuildResultLine,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  type RepoIndexRebuildResult,
  type RepoIndexStatus,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  REPO_INDEX_WARM_PARALLEL_TIP,
  repoIndexPreferredEngineTipLine,
  repoIndexWarmStatusLine,
} from '@superliora/sdk';

/** ChoicePicker tip — session-start warm path (default ON). */
export const INDEX_WARM_TIP = REPO_INDEX_WARM_PARALLEL_TIP;

/** ChoicePicker tip — bundled SQLite FTS5 vs Zoekt sidecar. */
export const INDEX_FTS_TIP = REPO_INDEX_FTS_BACKEND_TIP;

/** ChoicePicker tip — default engine=sqlite and env opt-outs. */
export const INDEX_ENGINE_TIP = REPO_INDEX_PREFERRED_ENGINE_TIP;

export interface IndexStatusGlanceInput {
  readonly repoQueryActive: boolean;
  readonly codemap: CodemapStatus;
  readonly repoIndex: RepoIndexStatus;
}

/** One-line at-a-glance summary for the status panel header. */
export function formatIndexStatusGlanceLine(input: IndexStatusGlanceInput): string {
  const repoQuery = input.repoQueryActive ? 'RepoQuery on' : 'RepoQuery off';
  const codemap =
    input.codemap.warmth === 'warm'
      ? 'codemap warm'
      : `codemap ${input.codemap.warmth}`;
  const engine = `engine=${input.repoIndex.engine}`;
  const fts = input.repoIndex.wired ? 'FTS live' : 'FTS not live';
  return `Glance: ${repoQuery} · ${codemap} · ${engine} · ${fts}`;
}

export interface IndexSessionLiveGlance {
  readonly env?: NodeJS.ProcessEnv;
  readonly repoIndex?: RepoIndexStatus;
}

/** Session (live) — codemap warm env gate + zoekt wire probe when engine=zoekt (SSOT). */
export function buildIndexSessionLiveLines(
  glance: IndexSessionLiveGlance = {},
): readonly string[] {
  const env = glance.env;
  const repoIndex =
    glance.repoIndex ?? (env !== undefined ? getRepoIndexStatus(env) : getRepoIndexStatus());
  const preferredEngineTip = repoIndexPreferredEngineTipLine(env);

  return [
    '── Session (live) ───────────────────────────',
    repoIndexWarmStatusLine(env),
    ...(preferredEngineTip !== null ? [preferredEngineTip] : []),
    ...(repoIndex.engine === 'zoekt' ? [formatRepoIndexWiredLine(repoIndex)] : []),
    '',
  ];
}

export interface IndexSettingsGlanceInput {
  readonly repoQueryActive: boolean;
  readonly codemap: CodemapStatus;
  readonly repoIndex: RepoIndexStatus;
  readonly env?: NodeJS.ProcessEnv;
  readonly rebuildResult?: RepoIndexRebuildResult | null;
}

export function buildIndexSettingsLines(input: IndexSettingsGlanceInput): readonly string[] {
  const { repoQueryActive, codemap, repoIndex, env, rebuildResult } = input;

  return [
    '── Repo index (read-only) ────────────────────',
    'RepoQuery + symbol codemap + FTS warm path — Sovereign Reform §6.',
    formatIndexStatusGlanceLine({ repoQueryActive, codemap, repoIndex }),
    '',
    ...buildIndexSessionLiveLines({ env, repoIndex }),
    '── Status ───────────────────────────────────',
    repoQueryActive
      ? 'RepoQuery: registered in this session (symbol/content/path unified search).'
      : 'RepoQuery: not active in this session — check agent profile / tool waist.',
    formatCodemapStatusLine(codemap),
    formatCodemapDbLine(codemap),
    ...(codemap.note !== null && codemap.warmth !== 'warm' ? [`· ${codemap.note}`] : []),
    formatRepoIndexEngineLine(repoIndex),
    formatRepoIndexBackendLine(repoIndex),
    formatRepoIndexWiredLine(repoIndex),
    '',
    '── Rebuild ──────────────────────────────────',
    'Settings → Index → Rebuild now clears symbol + sqlite FTS and rebuilds.',
    ...(rebuildResult !== undefined && rebuildResult !== null
      ? [formatRepoIndexRebuildResultLine(rebuildResult)]
      : []),
    '',
    '── Today ────────────────────────────────────',
    '· Use RepoQuery, Grep, Glob for codebase evidence',
    '· Grep remains fallback when index is cold or missing',
    '· Settings → Cache tips mention index-first context',
    '',
    '── Enable (future) ──────────────────────────',
    `· ${repoIndex.tip}`,
    `· ${REPO_INDEX_WARM_PARALLEL_TIP}`,
    `· ${CODEMAP_SYMBOL_VIA_REPOQUERY_TIP}`,
    `· ${repoIndex.ftsBackendTip}`,
    '· Experiments may expose codegraph/index flags first',
  ];
}
