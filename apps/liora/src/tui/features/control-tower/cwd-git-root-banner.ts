/**
 * Startup banner when workDir is nested under a git toplevel (F11).
 */

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import {
  detectCwdBelowGitRoot,
  formatCwdBelowGitRootNotice,
} from '../../utils/job/cwd-git-root';

export interface CwdGitRootBannerHost {
  readonly state: {
    readonly appState: { readonly workDir?: string };
  };
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
}

export function maybeAnnounceCwdBelowGitRoot(
  host: CwdGitRootBannerHost,
  runGit?: (cwd: string) => string | undefined,
): boolean {
  if (!isExperimentalFlagEnabled('conductor_ux_v2')) return false;
  const cwd = host.state.appState.workDir?.trim();
  if (cwd === undefined || cwd.length === 0) return false;
  const info = detectCwdBelowGitRoot(cwd, runGit);
  if (info === undefined) return false;
  const notice = formatCwdBelowGitRootNotice(info);
  host.showNotice(notice.title, notice.detail, { coalesceKey: 'cwd-below-git-root' });
  return true;
}
