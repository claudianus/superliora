/**
 * Footer Conductor jobs strip click → Inbox (unread) or Job Deck (F07).
 */

import type { NativeInputEvent } from '#/tui/renderer';

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import { planTUINativeStage } from '../native-layout/native-stage-plan';
import { activateConductorJobsStrip } from '../../utils/job/conductor-strip-activate';
import type { TUIState } from '../../tui-state';

export interface FooterJobsMouseHost {
  readonly state: TUIState;
  openJobDeck?(): void;
  openJobInbox?(): void;
}

/**
 * Global mouse handler: click inside the footer when jobs strip is active.
 * Returns true when the click was consumed.
 */
export function handleFooterJobsStripMouse(
  host: FooterJobsMouseHost,
  event: NativeInputEvent,
): boolean {
  if (!isExperimentalFlagEnabled('conductor_ux_v2')) return false;
  if (event.type !== 'mouse' || event.action !== 'press') return false;
  if (event.button !== undefined && event.button !== 'left') return false;

  const jobs = host.state.appState.conductorJobs;
  if (
    jobs === undefined ||
    jobs === null ||
    (jobs.total <= 0 &&
      jobs.running <= 0 &&
      jobs.queued <= 0 &&
      jobs.unreadInbox <= 0 &&
      jobs.interrupted <= 0 &&
      jobs.needsUser <= 0)
  ) {
    return false;
  }

  const footerRect = resolveFooterRect(host.state);
  if (footerRect === undefined) return false;
  if (
    event.y < footerRect.y ||
    event.y >= footerRect.y + footerRect.height ||
    event.x < footerRect.x ||
    event.x >= footerRect.x + footerRect.width
  ) {
    return false;
  }

  activateConductorJobsStrip({
    unreadInbox: jobs.unreadInbox,
    openInbox: () => {
      host.openJobInbox?.();
    },
    openDeck: () => {
      host.openJobDeck?.();
    },
  });
  return true;
}

function resolveFooterRect(
  state: TUIState,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  const plan = planTUINativeStage(state, state.terminal.columns, state.terminal.rows, {
    resolveEditorFallbackLines: (contentWidth) => state.editorContainer.render(contentWidth),
    resolveEditorRows: ({ editorLineCount, contentHeight, fixedRowsWithoutEditor }) =>
      Math.min(editorLineCount, Math.max(1, contentHeight - fixedRowsWithoutEditor - 1)),
  });
  const region = plan.layout.regions.find((entry) => entry.id === 'footer');
  return region?.rect;
}
