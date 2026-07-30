import type { Component, Focusable } from '#/tui/renderer';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import { quoteShellArg } from '#/utils/shell-quote';
import type { LioraHarness, Session } from '@superliora/sdk';
import { resolve } from 'pathe';

import { AgentDashboardComponent } from '../components/dialogs/session/agent-dashboard';
import { ExtensionsModalComponent } from '../components/dialogs/session/extensions-modal';
import { SessionPickerComponent, type SessionRow } from '../components/dialogs/session/session-picker';
import type { SessionLoadingPhase } from '../components/dialogs/session/session-loading-overlay';
import { PRODUCT_NAME } from '../constant/liora-tui';
import { MAX_TERMINAL_TITLE_LENGTH } from '../constant/terminal';
import type { ColorToken } from '../theme';
import type { AppState, LioraTUIOptions } from '../types';
import type { TUIState } from '../tui-state';
import {
  dashboardRowsFromSessions,
  type DashboardSessionRow,
  type DashboardSessionStatus,
  type DashboardStatusHints,
} from '../utils/agent/agent-dashboard-rows';
import {
  buildClaudeImportPlan,
  formatClaudeImportSummary,
  resolveClaudeImportRoots,
  type ClaudeImportScanEntry,
} from '../utils/claude-import';
import type { CenterModalMountOptions } from '../utils/ui/center-modal';
import {
  resolveExtensionsTab,
  type ExtensionsSnapshot,
  type ExtensionsTabId,
} from '../utils/agent/extensions-rows';
import { formatErrorMessage } from '../utils/event-payload';
import { runClaudeImportInventoryForHost } from './session-browser-claude-import';
import { sessionRowsForPicker } from '../utils/session/session-picker-rows';
import { ttui } from '../utils/tui-i18n';
import type { EditorKeyboardController } from './editor-keyboard';
import type { SessionEventHandler } from './session-event/handler';

/** Host surface for session picker, agent dashboard, and extensions browser. */
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
  resetSessionRuntime(): void;
  updateTerminalTitle(): void;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  syncRuntimeState(session?: Session): Promise<void>;
  showError(message: string): void;
  showStatus(message: string, color?: ColorToken): void;
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
  registerSessionHandlers(session: Session): void;
  stop(exitCode?: number): Promise<void>;
  runPluginsCommand(): Promise<void>;
}

/**
 * Session picker, agent dashboard, extensions modal, fetch/resume/reload, and
 * startup-mode application for resumed sessions. LioraTUI keeps thin delegates.
 */
export class SessionBrowserController {
  private sessionPickerOptions: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  } = {
    applyStartupModes: false,
    closeOnCancel: false,
    forwardEditorExit: false,
  };
  private sessionPickerScopeRequestToken = 0;

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

    this.host.resetSessionRuntime();
    this.host.session = session;
    this.host.harness.setTelemetryContext({ sessionId: session.id });
    this.host.registerSessionHandlers(session);
    await this.host.syncRuntimeState(session);
    this.updateTerminalTitle();
    try {
      await this.host.refreshDynamicSlashCommands(session);
    } catch {
      /* keep the reloaded session usable even if dynamic skills fail */
    }
    this.host.sessionEventHandler.startSubscription();
    const resumeState = session.getResumeState();
    if (resumeState?.warning !== undefined) {
      this.host.showStatus(`Warning: ${resumeState.warning}`, 'warning');
    }
    this.host.showStatus(statusMessage);
    void this.host.showSessionWarnings(session);
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

  async showAgentDashboard(): Promise<void> {
    if (this.host.state.appState.isReplaying || this.host.isSessionLoadingOverlayActive()) {
      this.host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    this.host.state.loadingSessions = true;
    let summaries: Awaited<ReturnType<LioraHarness['listSessions']>> = [];
    try {
      summaries = await this.host.runWithBusyOverlay(
        {
          title: ttui('tui.sessionLoading.dashboard'),
          detail: ttui('tui.sessionLoading.dashboard'),
          phase: 'working',
        },
        async () => this.host.harness.listSessions({ workDir: this.host.state.appState.workDir }),
      );
      // Keep session-picker cache in sync for other dialogs.
      this.host.state.sessions = sessionRowsForPicker(
        summaries,
        this.host.state.appState.sessionId,
        this.host.hasSessionContent(),
      );
    } catch {
      this.host.state.sessions = [];
      this.host.showStatus(ttui('tui.sessions.fetchFailed'), 'warning');
    } finally {
      this.host.state.loadingSessions = false;
    }

    const statusHints = this.buildDashboardStatusHints(summaries.map((s) => s.id));
    const rows = dashboardRowsFromSessions(summaries, {
      currentSessionId: this.host.state.appState.sessionId,
      currentSessionHasContent: this.host.hasSessionContent(),
      statusHints,
    });

    this.host.state.activeDialog = 'agent-dashboard';
    this.host.mountEditorReplacement(
      new AgentDashboardComponent({
        sessions: rows,
        loading: false,
        currentSessionId: this.host.state.appState.sessionId,
        onSelect: (session: DashboardSessionRow) => {
          void this.handleAgentDashboardSelect(session).catch((error) => {
            this.host.showError(`세션 연결 실패: ${formatErrorMessage(error)}`);
          });
        },
        onCancel: () => {
          this.hideAgentDashboard();
        },
      }),
    );
  }

  hideAgentDashboard(): void {
    if (this.host.state.activeDialog === 'agent-dashboard') {
      this.host.state.activeDialog = null;
    }
    this.host.editorKeyboard.clearPendingExit();
    this.host.restoreEditor();
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
      this.host.showError(`확장 목록 불러오기 실패: ${formatErrorMessage(error)}`);
      // Still open empty modal so operators can reach Claude import (i).
    }

    this.host.mountCenterModal(
      new ExtensionsModalComponent({
        snapshot,
        initialTab,
        onAction: (action) => {
          void this.handleExtensionsAction(action).catch((error) => {
            this.host.showError(`확장 동작 실패: ${formatErrorMessage(error)}`);
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
    this.sessionPickerScopeRequestToken += 1;
    this.host.editorKeyboard.clearPendingExit();
    this.host.state.activeDialog = null;
    if (this.host.state.centerModalStack.length > 0) {
      this.host.closeAllCenterModals();
      return;
    }
    this.host.restoreEditor();
  }

  private async showResumeOtherWorkDirHint(session: SessionRow): Promise<void> {
    this.hideSessionPicker();
    const command = `cd ${quoteShellArg(session.work_dir)} && liora --resume ${quoteShellArg(session.id)}`;
    const message = `Current session is in a different working directory.\n  To resume, run: ${command}`;
    try {
      await copyTextToClipboard(command);
      this.host.showStatus(`${message}\n  Command copied to clipboard`, 'warning');
    } catch {
      this.host.showStatus(`${message}\n  Failed to copy command to clipboard`, 'warning');
    }
  }

  private async resumeSession(targetSessionId: string): Promise<boolean> {
    if (
      targetSessionId === this.host.state.appState.sessionId &&
      this.host.session !== undefined
    ) {
      try {
        await this.host.session.getStatus();
        this.host.showStatus('Already on this session.');
        return true;
      } catch {
        // Session was closed — fall through and re-acquire it.
      }
    }
    if (this.host.state.appState.streamingPhase !== 'idle') {
      this.host.showError('Cannot switch sessions while streaming — press Esc or Ctrl-C first.');
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
      this.host.showError(`Failed to resume session ${targetSessionId}: ${msg}`);
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
    if (this.host.state.appState.isReplaying || this.host.isSessionLoadingOverlayActive()) {
      this.host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    this.sessionPickerOptions = options;
    await this.fetchSessions('cwd');
    this.mountSessionPicker({
      applyStartupModes: options.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (options.closeOnCancel) void this.host.stop();
      },
      onCtrlC: options.forwardEditorExit
        ? () => {
            this.host.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: options.forwardEditorExit
        ? () => {
            this.host.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  private async toggleSessionPickerScope(selectedSessionId: string): Promise<void> {
    const requestToken = ++this.sessionPickerScopeRequestToken;
    const nextScope = this.host.state.sessionsScope === 'cwd' ? 'all' : 'cwd';
    await this.fetchSessions(nextScope);
    if (requestToken !== this.sessionPickerScopeRequestToken) return;
    if (this.host.state.activeDialog !== 'session-picker') return;
    this.mountSessionPicker({
      initialSelectedSessionId: selectedSessionId,
      applyStartupModes: this.sessionPickerOptions.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (this.sessionPickerOptions.closeOnCancel) void this.host.stop();
      },
      onCtrlC: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.host.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.host.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  private mountSessionPicker(options: {
    readonly onCancel: () => void;
    readonly onCtrlC?: () => void;
    readonly onCtrlD?: () => void;
    readonly initialSelectedSessionId?: string;
    readonly applyStartupModes?: boolean;
  }): void {
    this.host.mountCenterModal(
      new SessionPickerComponent({
        sessions: this.host.state.sessions,
        loading: this.host.state.loadingSessions,
        currentSessionId: this.host.state.appState.sessionId,
        scope: this.host.state.sessionsScope,
        initialSelectedSessionId: options.initialSelectedSessionId,
        pageSize: 50,
        onSelect: (session: SessionRow) => {
          void this.handleSessionPickerSelect(session, options.applyStartupModes === true).catch(
            (error) => {
              this.host.showError(`Failed to apply startup flags: ${formatErrorMessage(error)}`);
            },
          );
        },
        onCancel: options.onCancel,
        onCtrlC: options.onCtrlC,
        onCtrlD: options.onCtrlD,
        onRename: (session: SessionRow, newTitle: string) =>
          this.renameSessionFromPicker(session, newTitle),
        onToggleScope: (selectedSessionId: string) => {
          void this.toggleSessionPickerScope(selectedSessionId);
        },
      }),
      { mode: 'replace' },
    );
    this.host.state.activeDialog = 'session-picker';
  }

  private async handleSessionPickerSelect(
    session: SessionRow,
    applyStartupModes: boolean,
  ): Promise<void> {
    if (resolve(session.work_dir) !== resolve(this.host.state.appState.workDir)) {
      await this.showResumeOtherWorkDirHint(session);
      if (applyStartupModes) await this.host.stop(0);
      return;
    }

    const switched = await this.resumeSession(session.id);
    if (!switched) return;
    if (applyStartupModes) {
      await this.applyStartupModesToResumedSession(this.host.requireSession());
      this.applyStartupPermissionAndPlanToAppState();
    }
    this.hideSessionPicker();
  }

  private async handleAgentDashboardSelect(session: DashboardSessionRow): Promise<void> {
    const asRow: SessionRow = {
      id: session.id,
      title: session.title,
      last_prompt: session.last_prompt,
      work_dir: session.work_dir,
      updated_at: session.updated_at,
      metadata: session.metadata,
    };
    if (resolve(session.work_dir) !== resolve(this.host.state.appState.workDir)) {
      await this.showResumeOtherWorkDirHint(asRow);
      return;
    }
    const switched = await this.resumeSession(session.id);
    if (!switched) return;
    this.hideAgentDashboard();
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

  private buildDashboardStatusHints(
    sessionIds: readonly string[],
  ): DashboardStatusHints {
    const hints: Record<string, DashboardSessionStatus> = {};
    const currentId = this.host.state.appState.sessionId;
    for (const id of sessionIds) {
      if (id !== currentId) continue;
      if (this.host.state.livePane.pendingApproval !== null) {
        hints[id] = 'needs_input';
      } else if (this.host.state.appState.streamingPhase !== 'idle') {
        hints[id] = 'working';
      } else {
        hints[id] = 'idle';
      }
    }
    return hints;
  }

  private async renameSessionFromPicker(session: SessionRow, newTitle: string): Promise<void> {
    const title = newTitle.slice(0, 200);
    try {
      await this.host.harness.renameSession({ id: session.id, title });
    } catch (error) {
      this.host.showError(`Failed to rename session: ${formatErrorMessage(error)}`);
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
    this.host.showStatus(`Session renamed to: ${title}`);
  }
}
