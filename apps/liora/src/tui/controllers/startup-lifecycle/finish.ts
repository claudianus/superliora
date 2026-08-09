import type { Session } from '@superliora/sdk';

import { maybeAnnounceCwdBelowGitRoot } from '../../features/control-tower/cwd-git-root-banner';
import { maybeAnnounceInterruptedJobs } from '../../features/control-tower/interrupted-banner';
import { restorePromptInputState } from '../../utils/prompt-input-state';
import {
  pruneTuiSessionToolOutputViewports,
  restoreTuiSessionState,
  writeTuiSessionState,
} from '../../utils/tui-session-state';
import { formatSessionResumeWarningNotice } from '../../utils/session/session-resume-warning-notice';
import { formatSessionWarningNotice } from '../../utils/session/session-warning-notice';
import { formatTmuxKeyboardNotice } from '../../utils/session/tmux-keyboard-notice';
import { detectTmuxKeyboardWarning } from '../../utils/terminal/tmux-keyboard';
import { ttui } from '../../utils/tui-i18n';
import type { StartupLifecycleHost } from './types';

export async function finishStartupSession(
  host: StartupLifecycleHost,
  shouldReplayHistory: boolean,
): Promise<void> {
  if (host.startupNotice !== undefined) {
    host.showStatus(host.startupNotice);
    host.startupNotice = undefined;
  }
  surfaceUpdateLifecycle(host);
  maybeAnnounceCwdBelowGitRoot(host);
  void showTmuxKeyboardWarningIfNeeded(host);
  if (host.state.startupState === 'picker') {
    void host.sessionBrowser.bootstrapFromPicker();
    return;
  }
  if (host.session !== undefined) {
    await restoreTuiSessionState(host);
  }
  if (shouldReplayHistory) {
    const session = host.requireSession();
    const ownsColdStartOverlay = !host.isSessionLoadingOverlayActive();
    if (ownsColdStartOverlay) {
      host.beginSessionLoading(session.id, ttui('tui.sessionLoading.title'));
      host.reportSessionLoading({
        phase: 'loading',
        progress: 0.22,
        sessionId: session.id,
        detail: ttui('tui.sessionLoading.phase.loading'),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    try {
      await host.sessionReplay.hydrateFromReplay(session);
      host.sessionBrowser.applyStartupPermissionAndPlanToAppState();
    } finally {
      pruneTuiSessionToolOutputViewports(host);
      if (ownsColdStartOverlay) {
        host.endSessionLoading();
      }
    }
  }
  const resumeState = host.session?.getResumeState();
  if (resumeState?.warning !== undefined) {
    // Loop49a: named notice — status-line alone was easy to miss on resume.
    const notice = formatSessionResumeWarningNotice(resumeState.warning);
    host.showNotice(notice.title, notice.detail, {
      coalesceKey: notice.coalesceKey,
    });
    host.showStatus(notice.status, 'warning');
  }
  if (host.session !== undefined) {
    host.sessionEventHandler.startSubscription();
    void showSessionWarnings(host, host.session);
    void maybeAnnounceInterruptedJobs(host, host.session);
    // Restore prompt queue / Ctrl-X stash / editor draft after history hydrate.
    await restorePromptInputState(host).catch(() => undefined);
    await writeTuiSessionState(host).catch(() => undefined);
  }
  void host.sessionBrowser.fetchSessions();
  if (host.session !== undefined) {
    host.sessionBrowser.updateTerminalTitle();
  }
  void host.refreshDynamicSlashCommands(host.session);
  host.usageMonitor.start();
  if (host.options.startup.resumeGoal === true) {
    void resumeGoalFromQueue(host);
  }
}

export async function showSessionWarnings(
  host: StartupLifecycleHost,
  session: Session,
): Promise<void> {
  try {
    const warnings = await session.getSessionWarnings();
    if (host.session !== session) return;
    // Loop48a: named notices — status-line alone was easy to miss at startup.
    for (const warning of warnings) {
      const notice = formatSessionWarningNotice(warning);
      host.showNotice(notice.title, notice.detail, {
        coalesceKey: notice.coalesceKey,
      });
      host.showStatus(notice.status, notice.statusColor);
    }
  } catch {
    // Best-effort: startup must not block on warning retrieval.
  }
}

async function resumeGoalFromQueue(host: StartupLifecycleHost): Promise<void> {
  const session = host.session;
  if (session === undefined) return;

  try {
    const { readGoalQueue, removeGoalQueueItem } = await import('../../goal-queue-store');
    const queue = await readGoalQueue(session);
    const firstGoal = queue.goals[0];
    if (firstGoal === undefined) {
      host.showStatus('No goals in queue to resume.', 'textMuted');
      return;
    }

    await removeGoalQueueItem(session, { goalId: firstGoal.id });
    host.showStatus(`🎯 Resuming goal: ${firstGoal.objective.slice(0, 100)}...`, 'textMuted');
    host.sendNormalUserInput(`/goal ${firstGoal.objective}`, {
      displayText: `🎯 ${firstGoal.objective.slice(0, 50)}...`,
    });
  } catch (error) {
    host.showStatus(`Failed to resume goal from queue: ${String(error)}`, 'error');
  }
}

async function showTmuxKeyboardWarningIfNeeded(host: StartupLifecycleHost): Promise<void> {
  try {
    const warning = await detectTmuxKeyboardWarning();
    if (warning === undefined || host.aborted) return;
    // Loop53a: named notice — long recovery string as status alone was easy to miss.
    const notice = formatTmuxKeyboardNotice(warning);
    host.showNotice(notice.title, notice.detail, {
      coalesceKey: notice.coalesceKey,
    });
    host.showStatus(notice.status, 'warning');
  } catch {
    // Best-effort: startup must not block on warning retrieval.
  }
}

/** Toast + transcript + status so auto-update lifecycle is hard to miss. */
function surfaceUpdateLifecycle(host: StartupLifecycleHost): void {
  const lifecycle = host.state.appState.updateLifecycle;
  if (lifecycle === null || lifecycle === undefined) return;

  const toastMs =
    lifecycle.kind === 'completed' || lifecycle.kind === 'failed'
      ? 6_500
      : lifecycle.kind === 'installing'
        ? 4_500
        : 3_500;
  try {
    host.state.toast.show(lifecycle.title, toastMs);
  } catch {
    // Toast is best-effort.
  }

  const detail = lifecycle.detail?.trim();
  const statusColor =
    lifecycle.kind === 'completed'
      ? 'success'
      : lifecycle.kind === 'failed'
        ? 'error'
        : lifecycle.kind === 'installing'
          ? 'warning'
          : 'info';
  host.showStatus(lifecycle.title, statusColor);
  if (detail !== undefined && detail.length > 0 && detail !== lifecycle.title) {
    host.showNotice(lifecycle.title, detail);
  } else if (lifecycle.kind === 'completed' || lifecycle.kind === 'failed') {
    host.showNotice(lifecycle.title, detail);
  }
}
