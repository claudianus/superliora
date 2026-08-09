/**
 * Conductor Inbox drawer controller — mounts the presentation component and
 * owns Session Job RPC / answer-compose side effects.
 */

import { PlainTextInputDialogComponent } from '../../components/dialogs/shared/plain-text-input-dialog';
import {
  InboxDrawerComponent,
  type InboxDrawerItem,
} from '../../components/dialogs/inbox/inbox-drawer';
import {
  hotpathJobResume,
  isConductorUxV2Enabled,
} from '../../commands/job-hotpath';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import {
  emptyConductorJobsSnapshot,
  resolveConductorJobCard,
} from '../../utils/job/job-strip';
import {
  formatNeedsUserQuestionPreview,
  resolveNeedsUserQuestionText,
} from '../../utils/job/needs-user-preview';
import { resyncJobBoardFromSession } from './job-resync';
import { canOpenMergePreview, openMergePreview } from './merge-preview-controller';
import { canOpenPushPreview, openPushPreview } from './push-preview-controller';
import { ttui } from '../../utils/tui-i18n';

export function openInbox(host: SlashCommandHost): void {
  if (!isConductorUxV2Enabled()) {
    host.showStatus(ttui('tui.conductor.inboxNeedsUx'), 'textMuted');
    return;
  }
  if (host.session === undefined) {
    host.showError(ttui('tui.conductor.inboxNoSession'));
    return;
  }

  const items = buildInboxItems(host);
  const panel = new InboxDrawerComponent({
    items,
    onAct: (item) => {
      void actOnInboxItem(host, item);
    },
    onMergePreview: (item) => {
      if (item.jobId === undefined) return;
      const snap = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
      const card = resolveConductorJobCard(snap.jobs, item.jobId);
      if (card === undefined || !canOpenMergePreview(card)) {
        host.showStatus(ttui('tui.conductor.mergeNeedsJob'), 'textMuted');
        return;
      }
      openMergePreview(host, card);
    },
    onPushPreview: (item) => {
      if (item.jobId === undefined) return;
      const snap = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
      const card = resolveConductorJobCard(snap.jobs, item.jobId);
      if (card === undefined || !canOpenPushPreview(card)) {
        host.showStatus('Push Preview needs a done or blocked job.', 'textMuted');
        return;
      }
      openPushPreview(host, card);
    },
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
  host.mountEditorReplacement(panel);

  // F18: resync ledger, then mark-read + refresh drawer rows.
  void resyncJobBoardFromSession(host)
    .then(() => host.requireSession().jobInbox({ markRead: true, limit: 24 }))
    .then(() => {
      host.controlTowerDesk?.markInboxRead();
      panel.setItems(buildInboxItems(host));
    })
    .catch(() => {
      /* drawer still useful from local snapshot */
    });
}

export function buildInboxItems(host: SlashCommandHost): readonly InboxDrawerItem[] {
  const snap = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  const rows: InboxDrawerItem[] = [];

  const pendingApproval = host.state.livePane.pendingApproval;
  if (pendingApproval !== null) {
    rows.push({
      id: 'glance:approval',
      kind: 'approval',
      title: pendingApproval.data.tool_name || ttui('tui.conductor.pendingApproval'),
      detail: ttui('tui.conductor.focusApprovalPanel'),
    });
  }

  const pendingQuestion = host.state.livePane.pendingQuestion;
  if (pendingQuestion !== null) {
    rows.push({
      id: 'glance:question',
      kind: 'question',
      title: ttui('tui.conductor.pendingQuestion'),
      detail: ttui('tui.conductor.answerInDialog'),
    });
  }

  for (const card of snap.jobs) {
    if (card.status !== 'needs_user') continue;
    const inboxSummary = snap.inbox.find(
      (entry) => entry.jobId === card.id && entry.kind === 'job.needs_user',
    )?.summary;
    const preview = formatNeedsUserQuestionPreview(
      resolveNeedsUserQuestionText({
        resultSummary: card.resultSummary,
        inboxSummary,
      }),
      2,
    );
    rows.push({
      id: `needs:${card.id}`,
      kind: 'needs_user',
      title: card.title,
      detail: shortJobId(card.id),
      jobId: card.id,
      ...(preview.length > 0 ? { previewLines: preview } : {}),
    });
  }

  for (const entry of snap.inbox) {
    const isNeeds = entry.kind === 'job.needs_user';
    const preview = isNeeds
      ? formatNeedsUserQuestionPreview(entry.summary, 2)
      : [];
    rows.push({
      id: entry.eventId,
      kind: isNeeds ? 'needs_user' : 'notice',
      title: entry.title,
      detail: isNeeds ? shortJobId(entry.jobId) : (entry.summary ?? shortJobId(entry.jobId)),
      jobId: entry.jobId,
      eventKind: entry.kind,
      ...(preview.length > 0 ? { previewLines: preview } : {}),
    });
  }

  return rows;
}

async function actOnInboxItem(host: SlashCommandHost, item: InboxDrawerItem): Promise<void> {
  if (item.kind === 'approval') {
    host.restoreEditor();
    host.focusPendingApprovalPanel();
    return;
  }
  if (item.kind === 'question') {
    host.restoreEditor();
    host.showStatus(ttui('tui.conductor.answerInPanel'), 'info');
    return;
  }

  if (item.kind === 'needs_user' && item.jobId !== undefined) {
    const jobId = item.jobId;
    host.mountEditorReplacement(
      new PlainTextInputDialogComponent({
        title: `Answer ${shortJobId(jobId)}`,
        subtitleLines: [item.title, 'Enter sends JobResume with your answer.'],
        onDone: (result) => {
          host.restoreEditor();
          if (result.kind === 'cancel') return;
          void hotpathJobResume(host, { jobId, answer: result.value });
        },
      }),
    );
    return;
  }

  // Notice rows: open Job Deck on the job when possible.
  host.restoreEditor();
  if (item.jobId !== undefined) {
    host.jobBoardController.openDeck(item.jobId);
    return;
  }
  host.showStatus(item.title, 'info');
}
