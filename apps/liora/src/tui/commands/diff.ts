/**
 * `/diff` — show working-tree changes (staged + unstaged + untracked) as a
 * dense review panel in the transcript. Optional argument filters files by
 * path substring (`/diff src/foo.ts`).
 */

import { GitDiffPanel } from '../components/messages/git-diff-panel';
import { requestTUILayoutRender } from '../utils/frame-render';
import { collectGitDiff } from '#/utils/git/git-diff';
import type { SlashCommandHost } from './dispatch';

export function showDiff(host: SlashCommandHost, args?: string): void {
  const report = collectGitDiff(host.state.appState.workDir);
  if (report === null) {
    host.showError('Not a git repository — /diff needs a working tree.');
    return;
  }

  const filter = (args ?? '').trim();
  const files =
    filter.length === 0
      ? report.files
      : report.files.filter(
          (file) => file.path.includes(filter) || (file.oldPath?.includes(filter) ?? false),
        );

  if (filter.length > 0 && files.length === 0) {
    host.showStatus(`No working-tree changes match "${filter}".`);
    return;
  }

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted = files.reduce((sum, file) => sum + file.deleted, 0);

  const panel = new GitDiffPanel({
    branch: report.branch,
    files,
    totalAdded,
    totalDeleted,
    truncated: report.truncated,
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
