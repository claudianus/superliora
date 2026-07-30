import type { Session } from '@superliora/sdk';

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
  void showTmuxKeyboardWarningIfNeeded(host);
  if (host.state.startupState === 'picker') {
    void host.sessionBrowser.bootstrapFromPicker();
    return;
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
      if (ownsColdStartOverlay) {
        host.endSessionLoading();
      }
    }
  }
  const resumeState = host.session?.getResumeState();
  if (resumeState?.warning !== undefined) {
    host.showStatus(`Warning: ${resumeState.warning}`, 'warning');
  }
  if (host.session !== undefined) {
    host.sessionEventHandler.startSubscription();
    void showSessionWarnings(host, host.session);
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
    for (const warning of warnings) {
      const severity = warning.severity === 'error' ? 'error' : 'warning';
      host.showStatus(`Warning: ${warning.message}`, severity);
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
    host.showStatus(warning, 'warning');
  } catch {
    // Best-effort: startup must not block on warning retrieval.
  }
}
