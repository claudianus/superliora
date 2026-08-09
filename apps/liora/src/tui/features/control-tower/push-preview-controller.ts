/**
 * Open Push Preview Stage from Deck / Inbox / land next-action.
 */

import { PushPreviewPanelComponent } from '../../components/dialogs/push-preview/push-preview-panel';
import { isConductorUxV2Enabled } from '../../commands/job-hotpath';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import type { ConductorJobCard } from '../../utils/job/job-strip';
import { shortJobId } from '../../components/job-board/job-board-helpers';

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
  if (!isConductorUxV2Enabled()) {
    host.showStatus('Push Preview needs conductor_ux_v2.', 'textMuted');
    return;
  }
  if (!canOpenPushPreview(card)) {
    host.showStatus('Push Preview needs a done or blocked job.', 'textMuted');
    return;
  }
  const session = host.session;
  if (session === undefined) {
    host.showError('No active session — Push Preview needs a live session.');
    return;
  }

  const remote = opts?.remote ?? 'origin';
  const localRef = opts?.localRef;
  const remoteRef = opts?.remoteRef;

  const panel = new PushPreviewPanelComponent({
    job: card,
    remote,
    localRef,
    remoteRef,
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
            result.ok
              ? `Push approved for ${shortJobId(card.id)}`
              : `Push held: ${result.error ?? result.text}`,
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
        .jobPush({
          jobId: card.id,
          approve: false,
          summary: summary.length > 0 ? summary : 'rejected from Push Preview',
        })
        .then(() => {
          host.showStatus(`Push rejected for ${shortJobId(card.id)}`, 'info');
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
