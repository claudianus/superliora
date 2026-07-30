import { resolve } from 'pathe';

import { SessionPickerComponent, type SessionRow } from '../../components/dialogs/session/session-picker';
import { sessionRowsForPicker } from '../../utils/session/session-picker-rows';
import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import type { SessionBrowserHost } from './session-browser';

export interface SessionPickerMountOptions {
  readonly onCancel: () => void;
  readonly onCtrlC?: () => void;
  readonly onCtrlD?: () => void;
  readonly initialSelectedSessionId?: string;
  readonly applyStartupModes?: boolean;
}

export interface SessionPickerControllerState {
  sessionPickerOptions: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  };
  sessionPickerScopeRequestToken: number;
}

export async function openSessionPickerFlow(
  host: SessionBrowserHost,
  state: SessionPickerControllerState,
  options: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  },
  fetchSessions: (scope: 'cwd' | 'all') => Promise<void>,
  mountSessionPicker: (mountOptions: SessionPickerMountOptions) => void,
  hideSessionPicker: () => void,
): Promise<void> {
  if (host.state.appState.isReplaying || host.isSessionLoadingOverlayActive()) {
    host.showError(ttui('tui.sessionLoading.busy'));
    return;
  }
  state.sessionPickerOptions = options;
  await fetchSessions('cwd');
  mountSessionPicker({
    applyStartupModes: options.applyStartupModes,
    onCancel: () => {
      hideSessionPicker();
      if (options.closeOnCancel) void host.stop();
    },
    onCtrlC: options.forwardEditorExit
      ? () => {
          host.state.editor.onCtrlC?.();
        }
      : undefined,
    onCtrlD: options.forwardEditorExit
      ? () => {
          host.state.editor.onCtrlD?.();
        }
      : undefined,
  });
}

export async function toggleSessionPickerScopeFlow(
  host: SessionBrowserHost,
  state: SessionPickerControllerState,
  selectedSessionId: string,
  fetchSessions: (scope: 'cwd' | 'all') => Promise<void>,
  mountSessionPicker: (mountOptions: SessionPickerMountOptions) => void,
  hideSessionPicker: () => void,
): Promise<void> {
  const requestToken = ++state.sessionPickerScopeRequestToken;
  const nextScope = host.state.sessionsScope === 'cwd' ? 'all' : 'cwd';
  await fetchSessions(nextScope);
  if (requestToken !== state.sessionPickerScopeRequestToken) return;
  if (host.state.activeDialog !== 'session-picker') return;
  mountSessionPicker({
    initialSelectedSessionId: selectedSessionId,
    applyStartupModes: state.sessionPickerOptions.applyStartupModes,
    onCancel: () => {
      hideSessionPicker();
      if (state.sessionPickerOptions.closeOnCancel) void host.stop();
    },
    onCtrlC: state.sessionPickerOptions.forwardEditorExit
      ? () => {
          host.state.editor.onCtrlC?.();
        }
      : undefined,
    onCtrlD: state.sessionPickerOptions.forwardEditorExit
      ? () => {
          host.state.editor.onCtrlD?.();
        }
      : undefined,
  });
}

export function mountSessionPickerFlow(
  host: SessionBrowserHost,
  options: SessionPickerMountOptions,
  handleSessionPickerSelect: (session: SessionRow, applyStartupModes: boolean) => Promise<void>,
  renameSessionFromPicker: (session: SessionRow, newTitle: string) => Promise<void>,
  toggleSessionPickerScope: (selectedSessionId: string) => void,
): void {
  host.mountCenterModal(
    new SessionPickerComponent({
      sessions: host.state.sessions,
      loading: host.state.loadingSessions,
      currentSessionId: host.state.appState.sessionId,
      scope: host.state.sessionsScope,
      initialSelectedSessionId: options.initialSelectedSessionId,
      pageSize: 50,
      onSelect: (session: SessionRow) => {
        void handleSessionPickerSelect(session, options.applyStartupModes === true).catch((error) => {
          host.showError(`Failed to apply startup flags: ${formatErrorMessage(error)}`);
        });
      },
      onCancel: options.onCancel,
      onCtrlC: options.onCtrlC,
      onCtrlD: options.onCtrlD,
      onRename: (session: SessionRow, newTitle: string) =>
        renameSessionFromPicker(session, newTitle),
      onToggleScope: (selectedSessionId: string) => {
        toggleSessionPickerScope(selectedSessionId);
      },
    }),
    { mode: 'replace' },
  );
  host.state.activeDialog = 'session-picker';
}

export async function handleSessionPickerSelectFlow(
  host: SessionBrowserHost,
  session: SessionRow,
  applyStartupModes: boolean,
  showResumeOtherWorkDirHint: (session: SessionRow) => Promise<void>,
  resumeSession: (targetSessionId: string) => Promise<boolean>,
  applyStartupModesToResumedSession: (session: import('@superliora/sdk').Session) => Promise<void>,
  applyStartupPermissionAndPlanToAppState: () => void,
  hideSessionPicker: () => void,
): Promise<void> {
  if (resolve(session.work_dir) !== resolve(host.state.appState.workDir)) {
    await showResumeOtherWorkDirHint(session);
    if (applyStartupModes) await host.stop(0);
    return;
  }

  const switched = await resumeSession(session.id);
  if (!switched) return;
  if (applyStartupModes) {
    await applyStartupModesToResumedSession(host.requireSession());
    applyStartupPermissionAndPlanToAppState();
  }
  hideSessionPicker();
}

export function hideSessionPickerFlow(
  host: SessionBrowserHost,
  state: SessionPickerControllerState,
): void {
  state.sessionPickerScopeRequestToken += 1;
  host.editorKeyboard.clearPendingExit();
  host.state.activeDialog = null;
  if (host.state.centerModalStack.length > 0) {
    host.closeAllCenterModals();
    return;
  }
  host.restoreEditor();
}
