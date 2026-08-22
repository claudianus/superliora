import type { Component, Focusable } from '#/tui/renderer';
import type { LioraHarness, Session } from '@superliora/sdk';

import { ExtensionsModalComponent } from '../../components/dialogs/session/extensions-modal';
import type { SessionRow } from '../../components/dialogs/session/session-picker';
import type { SessionLoadingPhase } from '../../components/dialogs/session/session-loading-overlay';
import { PRODUCT_NAME } from '../../constant/liora-tui';
import { MAX_TERMINAL_TITLE_LENGTH } from '../../constant/terminal';
import type { ColorToken } from '../../theme';
import type { AppState, LioraTUIOptions } from '../../types';
import type { TUIState } from '../../tui-state';
import type { CenterModalMountOptions } from '../../utils/ui/center-modal';
import {
  resolveExtensionsTab,
  type ExtensionsSnapshot,
  type ExtensionsTabId,
} from '../../utils/agent/extensions-rows';
import { formatErrorMessage } from '../../utils/event-payload';
import { persistTuiSessionState } from '../../utils/tui-session-state';
import { runClaudeImportInventoryForHost } from './session-browser-claude-import';
import {
  handleSessionPickerSelectFlow,
  hideSessionPickerFlow,
  mountSessionPickerFlow,
  openSessionPickerFlow,
  toggleSessionPickerScopeFlow,
  type SessionPickerControllerState,
} from './session-browser-picker';
import { sessionRowsForPicker } from '../../utils/session/session-picker-rows';
import { ttui } from '../../utils/tui-i18n';
import {
  displayWorkspacePath,
  resolveExistingWorkspaceDir,
  sameWorkspaceDir,
} from '../../utils/workspace';
import { folderResolveErrorMessage, showFolderPicker } from '../../commands/session/folder';
import type { EditorKeyboardController } from '../shell/editor-keyboard';
import type { SessionEventHandler } from '../session-event/handler';

/** Host surface for session picker and extensions browser. */
export interface SessionBrowserHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: LioraHarness;
  readonly options: LioraTUIOptions;
  readonly sessionEventHandler: SessionEventHandler;
  readonly editorKeyboard: EditorKeyboardController;
  sessionEventUnsubscribe: (() => void) | undefined;

  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  updateTerminalTitle(): void;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  showError(message: string): void;
  showStatus(message: string, color?: ColorToken): void;
  showNotice?(
    title: string,
    detail: string,
    options?: { readonly coalesceKey?: string },
  ): void;
  showSessionWarnings(session: Session): Promise<void>;
  hasSessionContent(): boolean;
  isSessionLoadingOverlayActive(): boolean;
  beginSessionLoading(sessionId?: string, title?: string): void;
  reportSessionLoading(patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void;
  endSessionLoading(): void;
  runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T>;
  mountEditorReplacement(panel: Component & Focusable): void;
  mountCenterModal(panel: Component & Focusable, options?: CenterModalMountOptions): void;
  closeAllCenterModals(): void;
  restoreEditor(): void;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  switchToSession(session: Session, statusMessage: string): Promise<void>;
  clearReverseRpcPanels(): void;
  cancelPendingReverseRpc(reason: string): void;
  stop(exitCode?: number): Promise<void>;
  runPluginsCommand(): Promise<void>;
}

/**
 * Session picker, extensions modal, fetch/resume/reload, and
 * startup-mode application for resumed sessions. LioraTUI keeps thin delegates.
 */
export class SessionBrowserController implements SessionPickerControllerState {
  sessionPickerOptions: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  } = {
    applyStartupModes: false,
    closeOnCancel: false,
    forwardEditorExit: false,
  };
  sessionPickerScopeRequestToken = 0;

  constructor(private readonly host: SessionBrowserHost) {}

  async applyStartupModesToResumedSession(session: Session): Promise<void> {
    const { startup } = this.host.options;
    if (startup.auto) {
      await session.setPermission('auto');
    } else if (startup.yolo) {
      await session.setPermission('yolo');
    } else {
      // No CLI flag: apply the persisted tui.toml permission mode so the
      // resumed session matches the user's configured preference.
      await session.setPermission(this.host.state.appState.permissionMode);
    }
    if (startup.plan) {
      const status = await session.getStatus();
      if (!status.planMode) {
        await session.setPlanMode(true);
      }
    }
  }

  applyStartupPermissionAndPlanToAppState(): void {
    const { startup } = this.host.options;
    if (startup.auto) {
      this.host.setAppState({ permissionMode: 'auto' });
    } else if (startup.yolo) {
      this.host.setAppState({ permissionMode: 'yolo' });
    }
    if (startup.plan) {
      this.host.setAppState({ planMode: true });
    }
  }

  async fetchSessions(scope: 'cwd' | 'all' = this.host.state.sessionsScope): Promise<void> {
    this.host.state.loadingSessions = true;
    this.host.state.sessionsScope = scope;
    persistTuiSessionState(this.host);
    try {
      const sessions =
        scope === 'all'
          ? await this.host.harness.listSessions({})
          : await this.host.harness.listSessions({ workDir: this.host.state.appState.workDir });
      this.host.state.sessions = sessionRowsForPicker(
        sessions,
        this.host.state.appState.sessionId,
        this.host.hasSessionContent(),
      );
    } catch {
      // Surface a warning instead of leaving the picker silently empty — the
      // user cannot tell a genuine "no sessions" from a server/network failure.
      this.host.state.sessions = [];
      this.host.showStatus(ttui('tui.sessions.fetchFailed'), 'warning');
    } finally {
      this.host.state.loadingSessions = false;
    }
  }

  async reloadCurrentSessionView(session: Session, statusMessage: string): Promise<void> {
    this.host.sessionEventUnsubscribe?.();
    this.host.sessionEventUnsubscribe = undefined;
    this.host.clearReverseRpcPanels();
    session.setApprovalHandler(undefined);
    session.setQuestionHandler(undefined);
    this.host.cancelPendingReverseRpc('reloading session');
    await this.host.switchToSession(session, statusMessage);
  }

  updateTerminalTitle(): void {
    const trimmed = this.host.state.appState.sessionTitle?.trim() ?? '';
    const label = trimmed.length > 0 ? trimmed.slice(0, MAX_TERMINAL_TITLE_LENGTH) : PRODUCT_NAME;
    this.host.state.terminal.setTitle?.(label);
  }

  async bootstrapFromPicker(): Promise<void> {
    await this.openSessionPicker({
      applyStartupModes: true,
      closeOnCancel: true,
      forwardEditorExit: true,
    });
  }

  async showSessionPicker(): Promise<void> {
    if (this.host.state.appState.isReplaying || this.host.isSessionLoadingOverlayActive()) {
      this.host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    await this.openSessionPicker({
      applyStartupModes: false,
      closeOnCancel: false,
      forwardEditorExit: false,
    });
  }

  async showExtensionsModal(args?: string): Promise<void> {
    const raw = (args ?? '').trim().toLowerCase();
    if (raw === 'claude' || raw === 'import-claude' || raw === 'import') {
      await this.runClaudeImportInventory();
      return;
    }

    const initialTab: ExtensionsTabId = resolveExtensionsTab(raw);

    let snapshot: ExtensionsSnapshot = { plugins: [], skills: [], mcpServers: [] };
    try {
      const session = this.host.requireSession();
      snapshot = await this.host.runWithBusyOverlay(
        {
          title: ttui('tui.sessionLoading.extensions'),
          detail: ttui('tui.sessionLoading.extensions'),
          phase: 'working',
        },
        async () => {
          const [plugins, skills, mcpServers] = await Promise.all([
            session.listPlugins().catch(() => []),
            session.listSkills().catch(() => []),
            session.listMcpServers().catch(() => []),
          ]);
          return { plugins, skills, mcpServers };
        },
      );
    } catch (error) {
      this.host.showError(
        ttui('tui.extensions.loadFailed', { message: formatErrorMessage(error) }),
      );
      // Still open empty modal so operators can reach Claude import (i).
    }

    this.host.mountCenterModal(
      new ExtensionsModalComponent({
        snapshot,
        initialTab,
        onAction: (action) => {
          void this.handleExtensionsAction(action).catch((error) => {
            this.host.showError(
              ttui('tui.extensions.actionFailed', { message: formatErrorMessage(error) }),
            );
          });
        },
        onCancel: () => {
          this.hideExtensionsModal();
        },
      }),
      { mode: 'replace' },
    );
    this.host.state.activeDialog = 'extensions';
  }

  hideExtensionsModal(): void {
    if (this.host.state.activeDialog === 'extensions') {
      this.host.state.activeDialog = null;
    }
    this.host.editorKeyboard.clearPendingExit();
    if (this.host.state.centerModalStack.length > 0) {
      this.host.closeAllCenterModals();
      return;
    }
    this.host.restoreEditor();
  }

  hideSessionPicker(): void {
    hideSessionPickerFlow(this.host, this);
  }

  async openWorkspace(
    target: string,
    options: { readonly resumeSessionId?: string } = {},
  ): Promise<void> {
    const { host } = this;
    if (host.state.appState.streamingPhase !== 'idle') {
      host.showError(ttui('tui.folder.busy'));
      return;
    }
    if (host.state.appState.isReplaying || host.isSessionLoadingOverlayActive()) {
      host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }

    const resolved = resolveExistingWorkspaceDir(target);
    if (!resolved.ok) {
      if (options.resumeSessionId === undefined) {
        host.showError(folderResolveErrorMessage(resolved));
        return;
      }
      // Resume a recorded session even when the folder is gone (history still opens).
      const fallback = resolved.path;
      host.setAppState({ workDir: fallback, additionalDirs: [] });
      const switched = await this.resumeSession(options.resumeSessionId);
      if (switched) {
        host.showStatus(ttui('tui.folder.resumed', { path: displayWorkspacePath(fallback) }));
      }
      return;
    }
    const nextDir = resolved.path;
    const current = host.state.appState.workDir;
    const sameDir = sameWorkspaceDir(nextDir, current);
    const display = displayWorkspacePath(nextDir);

    if (!sameDir) {
      try {
        process.chdir(nextDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.showError(ttui('tui.folder.chdirFailed', { path: display, message }));
        return;
      }
      host.setAppState({ workDir: nextDir, additionalDirs: [] });
    } else if (options.resumeSessionId === undefined) {
      host.showStatus(ttui('tui.folder.alreadyHere', { path: display }));
      return;
    }

    const resumeId = options.resumeSessionId
      ?? (await this.firstSessionIdForWorkDir(nextDir));
    if (resumeId !== undefined) {
      const switched = await this.resumeSession(resumeId);
      if (switched && !sameDir) {
        host.showStatus(ttui('tui.folder.resumed', { path: display }));
      }
      return;
    }

    try {
      const model = host.state.appState.model.trim();
      const session = await host.harness.createSession({
        workDir: nextDir,
        ...(model.length > 0 ? { model } : {}),
        permission: host.state.appState.permissionMode,
        planMode: host.state.appState.planMode,
      });
      await host.switchToSession(session, ttui('tui.folder.opened', { path: display }));
    } catch (error) {
      host.showError(
        ttui('tui.folder.openFailed', {
          path: display,
          message: formatErrorMessage(error),
        }),
      );
    }
  }

  async showFolderPicker(options: { readonly startup?: boolean } = {}): Promise<void> {
    if (this.host.state.appState.streamingPhase !== 'idle') {
      this.host.showError(ttui('tui.folder.busy'));
      return;
    }
    await showFolderPicker(
      {
        state: this.host.state,
        harness: this.host.harness,
        openWorkspace: (dir, opts) => this.openWorkspace(dir, opts),
        showStatus: (msg) => {
          this.host.showStatus(msg);
        },
        mountCenterModal: (panel, mountOptions) => {
          this.host.mountCenterModal(panel, mountOptions);
        },
        closeCenterModal: () => {
          this.host.closeAllCenterModals();
        },
        mountEditorReplacement: (panel) => {
          this.host.mountEditorReplacement(panel);
        },
        restoreEditor: () => {
          this.host.restoreEditor();
        },
      },
      { startup: options.startup },
    );
  }

  private async firstSessionIdForWorkDir(workDir: string): Promise<string | undefined> {
    try {
      const sessions = await this.host.harness.listSessions({ workDir });
      return sessions[0]?.id;
    } catch {
      return undefined;
    }
  }

  private async resumeSession(targetSessionId: string): Promise<boolean> {
    if (
      targetSessionId === this.host.state.appState.sessionId &&
      this.host.session !== undefined
    ) {
      try {
        await this.host.session.getStatus();
        this.host.showStatus(ttui('tui.session.alreadyOn'));
        return true;
      } catch {
        // Session was closed — fall through and re-acquire it.
      }
    }
    if (this.host.state.appState.streamingPhase !== 'idle') {
      this.host.showError(ttui('tui.session.cannotSwitchStreaming'));
      return false;
    }
    if (this.host.state.appState.isReplaying || this.host.isSessionLoadingOverlayActive()) {
      this.host.showError(ttui('tui.sessionLoading.busy'));
      return false;
    }

    this.host.beginSessionLoading(targetSessionId);
    this.host.reportSessionLoading({
      phase: 'loading',
      progress: 0.2,
      detail: ttui('tui.sessionLoading.phase.loading'),
      sessionId: targetSessionId,
    });
    let session: Session;
    try {
      session = await this.host.harness.resumeSession({ id: targetSessionId });
    } catch (error) {
      this.host.endSessionLoading();
      const msg = formatErrorMessage(error);
      this.host.showError(ttui('tui.session.resumeFailed', { id: targetSessionId, message: msg }));
      return false;
    }

    try {
      await this.host.switchToSession(session, `Resumed session (${session.id}).`);
      return true;
    } finally {
      this.host.endSessionLoading();
    }
  }

  private async openSessionPicker(options: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  }): Promise<void> {
    await openSessionPickerFlow(
      this.host,
      this,
      options,
      (scope) => this.fetchSessions(scope),
      (mountOptions) =>{  this.mountSessionPicker(mountOptions); },
      () =>{  this.hideSessionPicker(); },
    );
  }

  private async toggleSessionPickerScope(selectedSessionId: string): Promise<void> {
    await toggleSessionPickerScopeFlow(
      this.host,
      this,
      selectedSessionId,
      (scope) => this.fetchSessions(scope),
      (mountOptions) =>{  this.mountSessionPicker(mountOptions); },
      () =>{  this.hideSessionPicker(); },
    );
  }

  private mountSessionPicker(options: {
    readonly onCancel: () => void;
    readonly onCtrlC?: () => void;
    readonly onCtrlD?: () => void;
    readonly initialSelectedSessionId?: string;
    readonly applyStartupModes?: boolean;
  }): void {
    mountSessionPickerFlow(
      this.host,
      options,
      (session, applyStartupModes) => this.handleSessionPickerSelect(session, applyStartupModes),
      (session, newTitle) => this.renameSessionFromPicker(session, newTitle),
      (selectedSessionId) => {
        void this.toggleSessionPickerScope(selectedSessionId);
      },
    );
  }

  private async handleSessionPickerSelect(
    session: SessionRow,
    applyStartupModes: boolean,
  ): Promise<void> {
    await handleSessionPickerSelectFlow(
      this.host,
      session,
      applyStartupModes,
      (dir, options) => this.openWorkspace(dir, options),
      (targetSessionId) => this.resumeSession(targetSessionId),
      (activeSession) => this.applyStartupModesToResumedSession(activeSession),
      () => {
        this.applyStartupPermissionAndPlanToAppState();
      },
      () => {
        this.hideSessionPicker();
      },
    );
  }

  private async handleExtensionsAction(
    action:
      | { readonly kind: 'open-plugins' }
      | { readonly kind: 'open-mcp' }
      | { readonly kind: 'import-claude' }
      | { readonly kind: 'activate-skill'; readonly skillName: string }
      | { readonly kind: 'noop' },
  ): Promise<void> {
    switch (action.kind) {
      case 'open-plugins':
        this.hideExtensionsModal();
        await this.host.runPluginsCommand();
        return;
      case 'open-mcp':
        this.hideExtensionsModal();
        await this.host.runPluginsCommand();
        return;
      case 'import-claude':
        this.hideExtensionsModal();
        await this.runClaudeImportInventory();
        return;
      case 'activate-skill': {
        this.hideExtensionsModal();
        const name = action.skillName.trim();
        if (name.length === 0) return;
        this.host.sendNormalUserInput(`/${name}`, { displayText: `/${name}` });
        return;
      }
      case 'noop':
        return;
    }
  }

  private async runClaudeImportInventory(): Promise<void> {
    await runClaudeImportInventoryForHost(this.host);
  }

  private async renameSessionFromPicker(session: SessionRow, newTitle: string): Promise<void> {
    const title = newTitle.slice(0, 200);
    try {
      await this.host.harness.renameSession({ id: session.id, title });
    } catch (error) {
      this.host.showError(ttui('tui.session.renameFailed', { message: formatErrorMessage(error) }));
      throw error;
    }
    const index = this.host.state.sessions.findIndex((row) => row.id === session.id);
    if (index >= 0) {
      const previous = this.host.state.sessions[index];
      if (previous !== undefined) {
        this.host.state.sessions[index] = { ...previous, title };
      }
    }
    if (session.id === this.host.state.appState.sessionId) {
      this.host.setAppState({ sessionTitle: title });
      this.updateTerminalTitle();
    }
    this.host.showStatus(ttui('tui.session.renamed', { title }));
  }
}
