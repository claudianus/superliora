/**
 * `/log` (alias `/git`) — open an interactive commit browser listing recent
 * commits (hash · subject · author · relative date · `+a −d`). Enter opens a
 * commit's full diff in the diff review dialog. Optional argument filters
 * commits by case-insensitive substring on subject/hash/author.
 */

import { collectGitLog } from '#/utils/git/git-log';
import type { SlashCommandHost } from './dispatch';

export function showLog(host: SlashCommandHost, args?: string): void {
  const report = collectGitLog(host.state.appState.workDir);
  if (report === null) {
    host.showError('Not a git repository — /log needs a working tree.');
    return;
  }

  const filter = (args ?? '').trim();
  const commits =
    filter.length === 0
      ? report.commits
      : report.commits.filter((commit) => {
          const needle = filter.toLowerCase();
          return (
            commit.subject.toLowerCase().includes(needle) ||
            commit.hash.toLowerCase().includes(needle) ||
            commit.author.toLowerCase().includes(needle)
          );
        });

  if (filter.length > 0 && commits.length === 0) {
    host.showStatus(`No commits match "${filter}".`);
    return;
  }

  host.showCommitBrowser({ branch: report.branch, commits }, filter);
}
