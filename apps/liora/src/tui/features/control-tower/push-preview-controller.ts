/**
 * Open Push Preview Stage from Deck / Inbox / land next-action.
 */

import { PushPreviewPanelComponent } from '../../components/dialogs/push-preview/push-preview-panel';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import type { ConductorJobCard } from '../../utils/job/job-strip';
import {
  describePublishRemoteRef,
  inferPublishRemoteRefFromJobCard,
} from '../../utils/job/push-publish-target';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import { ttui } from '../../utils/tui-i18n';

export function canOpenPushPreview(card: ConductorJobCard): boolean {
  return card.status === 'done' || card.status === 'blocked';
}

export function openPushPreview(
  host: SlashCommandHost,
  card: ConductorJobCard,
  opts?: {
    readonly remote?: string;
    readonly localRef?: string;
    readonly remoteRef?: string;
  },
): void {
  if (!canOpenPushPreview(card)) {
    host.showStatus(ttui('tui.job.pushNeedsJob'), 'textMuted');
    return;
  }
  const session = host.session;
  if (session === undefined) {
    host.showError(ttui('tui.job.pushNoSession'));
    return;
  }

  const remote = opts?.remote ?? 'origin';
  const localRef = opts?.localRef;
  const briefRef = inferPublishRemoteRefFromJobCard(card);
  const remoteRef = opts?.remoteRef ?? briefRef;
  const fromBrief = opts?.remoteRef === undefined && briefRef !== undefined;
  const remoteRefProvenance =
    opts?.remoteRef !== undefined
      ? undefined
      : describePublishRemoteRef({ fromBrief });

  const panel = new PushPreviewPanelComponent({
    job: card,
    remote,
    localRef,
    remoteRef,
    ...(remoteRefProvenance === undefined ? {} : { remoteRefProvenance }),
    onApprove: (summary) => {
      host.restoreEditor();
      void session
        .jobPush({
          jobId: card.id,
          approve: true,
          forceUserConfirm: true,
          remote,
          ref: localRef,
          remoteRef,
          summary: summary.length > 0 ? summary : card.resultSummary,
        })
        .then((result) => {
          host.showStatus(
            result.ok && result.pushJob !== undefined
              ? ttui('tui.job.pushApproved', { jobId: shortJobId(card.id) })
              : ttui('tui.job.pushHeld', { reason: result.error ?? result.text }),
            result.ok && result.pushJob !== undefined ? 'info' : 'warning',
          );
        })
        .catch((error: unknown) => {
          host.showError(error instanceof Error ? error.message : String(error));
        });
    },
    onReject: (summary) => {
      host.restoreEditor();
      void session
        .jobPush({
          jobId: card.id,
          approve: false,
          summary: summary.length > 0 ? summary : 'rejected from Push Preview',
        })
        .then(() => {
          host.showStatus(ttui('tui.job.pushRejected', { jobId: shortJobId(card.id) }), 'info');
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
