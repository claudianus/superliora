/**
 * W8 soft — fire-and-forget symbol codemap + sqlite content FTS warm at session start when env opt-in.
 */
import { getCodeMapForWorkspace } from '#/codemap/code-map';
import { isCodemapGitWorkspace } from '#/codemap/status';
import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';
import {
  REPO_INDEX_WARM_ENV,
  isRepoIndexWarmEnabled,
  repoIndexWarmEnableReason,
} from '#/profile/sovereign-soft-gates';

import { getContentIndexForWorkspace } from './content-indexer';
import { parseRepoIndexEngineEnv, REPO_INDEX_ENGINE_ENV } from './status';

export {
  REPO_INDEX_WARM_ENV,
  isRepoIndexWarmEnabled,
  repoIndexWarmEnableReason,
};

/** Settings / ops copy for session-start codemap warm env gate. */
export function repoIndexWarmStatusLine(env: NodeJS.ProcessEnv = process.env): string {
  const reason = repoIndexWarmEnableReason(env);
  const engine = parseRepoIndexEngineEnv(env[REPO_INDEX_ENGINE_ENV]);
  const ftsNote =
    engine === 'sqlite' && reason !== null
      ? ' · sqlite FTS content index warm when engine=sqlite'
      : '';
  return reason !== null
    ? `Codemap warm: ON (${reason}) — fire-and-forget ensureReady at session start${ftsNote}`
    : `Codemap warm: OFF (default) — lazy build on first RepoQuery ensureReady · opt-in: ${REPO_INDEX_WARM_ENV}=1 or ${SOVEREIGN_UMBRELLA_ENV}=1`;
}

/**
 * Kick symbol codemap (and sqlite content FTS when engine=sqlite) build in the background —
 * never throws; no-op when env off, empty workDir, or non-git workspace.
 */
export function maybeWarmCodemapAtSessionStart(
  workspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isRepoIndexWarmEnabled(env)) return;
  const dir = workspaceDir.trim();
  if (dir.length === 0) return;
  if (!isCodemapGitWorkspace(dir)) return;
  const warmContentFts = parseRepoIndexEngineEnv(env[REPO_INDEX_ENGINE_ENV]) === 'sqlite';
  setImmediate(() => {
    try {
      getCodeMapForWorkspace(dir).ensureReady();
    } catch {
      /* best-effort — codemap marks itself unusable on failure */
    }
    if (warmContentFts) {
      try {
        getContentIndexForWorkspace(dir).ensureReady();
      } catch {
        /* best-effort — content index marks itself unusable on failure */
      }
    }
  });
}
