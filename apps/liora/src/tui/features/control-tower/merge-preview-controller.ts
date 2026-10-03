/**
 * Open operator Merge Preview from Deck or Inbox.
 */

import { MergePreviewPanelComponent } from '../../components/dialogs/merge-preview/merge-preview-panel';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import type { ConductorJobCard } from '../../utils/job/job-strip';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import { ttui } from '../../utils/tui-i18n';
import { collectGitBranchDiff } from '#/utils/git/git-diff';

export function canOpenMergePreview(card: ConductorJobCard): boolean {
  return card.status === 'done' || card.status === 'blocked';
}

/**
 * Pre-land diff for the job's worktree branch, collected from the main
 * workspace checkout. `undefined` when the job carries no branch; `null`
 * when git could not produce a diff (missing branch / not a repo).
 */
function jobDiffReport(host: SlashCommandHost, card: ConductorJobCard) {
  const branch = card.worktreeBranch?.trim();
  if (branch === undefined || branch.length === 0) return undefined;
  return collectGitBranchDiff(host.state.appState.workDir, branch, branch);
}

export function openMergePreview(host: SlashCommandHost, card: ConductorJobCard): void {
  if (!canOpenMergePreview(card)) {
    host.showStatus(ttui('tui.job.mergeNeedsJob'), 'textMuted');
    return;
  }
  const session = host.session;
  if (session === undefined) {
    host.showError(ttui('tui.job.mergeNoSession'));
    return;
  }

  const trustReason = card.resultSummary?.includes('merge:')
    ? card.resultSummary
    : undefined;
  const diffReport = jobDiffReport(host, card);

  const panel = new MergePreviewPanelComponent({
    job: card,
    trustReason,
    diffReport,
    onApprove: (summary) => {
      host.restoreEditor();
      void session
        .jobMerge({
          jobId: card.id,
          approve: true,
          summary: summary.length > 0 ? summary : card.resultSummary,
        })
        .then((result) => {
          host.showStatus(
            result.ok
              ? `Merged ${shortJobId(card.id)}`
              : `Merge held: ${result.error ?? result.text}`,
            result.ok ? 'success' : 'warning',
          );
        })
        .catch((error: unknown) => {
          host.showError(error instanceof Error ? error.message : String(error));
        });
    },
    onReject: (summary) => {
      host.restoreEditor();
      void session
        .jobMerge({
          jobId: card.id,
          approve: false,
          summary: summary.length > 0 ? summary : 'rejected from Merge Preview',
        })
        .then(() => {
          host.showStatus(ttui('tui.job.mergeRejected', { jobId: shortJobId(card.id) }), 'info');
        })
        .catch((error: unknown) => {
          host.showError(error instanceof Error ? error.message : String(error));
        });
    },
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
  host.mountEditorReplacement(panel);
}
