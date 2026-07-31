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
  REPO_INDEX_WARM_PARALLEL_TIP,
  repoIndexPreferredEngineTipLine,
  repoIndexWarmStatusLine,
} from '@superliora/sdk';

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
