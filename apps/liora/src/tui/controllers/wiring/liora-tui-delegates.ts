import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { BackgroundTaskInfo, Session } from '@superliora/sdk';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';

import type {
  RendererDiagnosticsOverlayCommand,
  RendererTraceCommand,
  SkillListSession,
} from '../../commands';
import * as slashCommands from '../../commands/hub/dispatch';
import type { SessionLoadingPhase } from '../../components/dialogs/session/session-loading-overlay';
import type { ColorToken, ResolvedTheme, ThemeName } from '../../theme';
import type { CenterModalMountOptions } from '../../utils/ui/center-modal';
import { combineStartupNotice } from '../../utils/startup';
import type { TranscriptScrollAction } from '../../features/transcript/transcript-viewport';
import type {
  AppState,
  LivePaneState,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptDetailLevel,
  TranscriptEntry,
} from '../../types';
import type { TUIState } from '../../tui-state';
import type { LioraTUI } from '../../liora-tui';
import {
  handlePlanToggleFromHost,
  openUndoSelectorFromHost,
  setAskModeFromHost,
} from './liora-tui-wiring';
import type { ApprovalPanelData, QuestionPanelData } from '../../reverse-rpc/types';
import { openJobDeckViewer } from '../../commands/jobs-deck';

type LioraTUIConstructor = new (...args: never[]) => LioraTUI;

/** Bind coordinator public methods so liora-tui.ts stays a thin shell. */
export function installLioraTUIDelegates(Ctor: LioraTUIConstructor): void {
  const proto = Ctor.prototype as LioraTUI;

  proto.getSlashCommands = function (mode = 'primary' as const) {
    return this.autocomplete.getSlashCommands(mode);
  };
  proto.dispatchSlash = function (command: string) {
    slashCommands.dispatchInput(this, command);
  };
  proto.runPluginsCommand = function () {
    return slashCommands.handlePluginsCommand(this, '');
  };
  proto.setupAutocomplete = function () {
    this.autocomplete.setupAutocomplete();
  };
  proto.refreshSlashCommandAutocomplete = function () {
    this.autocomplete.refreshSlashCommandAutocomplete();
  };
  proto.refreshSkillCommands = function (session?: SkillListSession) {
    return this.autocomplete.refreshSkillCommands(session);
  };
  proto.refreshDynamicSlashCommands = function (session?: Session) {
    return this.autocomplete.refreshDynamicSlashCommands(session);
  };

  proto.start = function () {
    return this.startupLifecycle.start();
  };
  proto.stop = function (exitCode?: number) {
    return this.startupLifecycle.stop(exitCode);
  };
  proto.registerSignalHandlers = function () {
    this.startupLifecycle.registerSignalHandlers();
  };
  proto.unregisterSignalHandlers = function () {
    this.startupLifecycle.unregisterSignalHandlers();
  };
  proto.emergencyTerminalExit = function (exitCode = 129) {
    return this.startupLifecycle.emergencyTerminalExit(exitCode);
  };
  proto.initMainTui = function () {
    return this.startupLifecycle.initMainTui();
  };
  proto.init = function () {
    return this.startupLifecycle.init();
  };
  proto.ensureNativeInputRouter = function () {
    this.startupLifecycle.ensureNativeInputRouter();
  };
  proto.loadBanner = function () {
    return this.startupLifecycle.loadBanner();
  };
  proto.finishStartup = function (shouldReplayHistory: boolean) {
    return this.startupLifecycle.finishStartup(shouldReplayHistory);
  };
  proto.refreshProviderModelsInBackground = function () {
    return this.startupLifecycle.refreshProviderModelsInBackground();
  };
  proto.bootstrapFromPicker = function () {
    return this.sessionBrowser.bootstrapFromPicker();
  };
  proto.scrollTranscriptViewport = function (action: TranscriptScrollAction) {
    return this.startupLifecycle.scrollTranscriptViewport(action);
  };
  proto.getStartupMcpMs = function () {
    return this.startupLifecycle.getStartupMcpMs();
  };
  proto.setNativeRendererDiagnosticsOverlay = function (command: RendererDiagnosticsOverlayCommand) {
    this.nativeRendererDiagnostics.setNativeRendererDiagnosticsOverlay(command);
  };
  proto.setNativeRendererTrace = function (command: RendererTraceCommand) {
    this.nativeRendererDiagnostics.setNativeRendererTrace(command);
  };
  proto.showSessionWarnings = function (session: Session) {
    return this.startupLifecycle.showSessionWarnings(session);
  };

  proto.handlePlanToggle = function (next: boolean, ultra = false) {
    handlePlanToggleFromHost(this, next, ultra);
  };
  proto.setAskMode = function (enabled: boolean) {
    setAskModeFromHost(this, enabled);
  };
  proto.handleInputModeChange = function (mode: 'prompt' | 'bash') {
    this.setAppState({ inputMode: mode });
    this.updateEditorBorderHighlight();
  };

  proto.handleUserInput = function (text: string) {
    this.messageDispatch.handleUserInput(text);
  };
  proto.dispatchSlashInput = function (text: string) {
    slashCommands.dispatchInput(this, text);
  };
  proto.runShellCommandFromInput = function (command: string) {
    this.shellInput.runShellCommandFromInput(command);
  };
  proto.handleShellOutput = function (event: {
    commandId: string;
    update: { kind: string; text?: string };
  }) {
    this.shellInput.handleShellOutput(event);
  };
  proto.handleShellStarted = function (event: { commandId: string; taskId: string }) {
    this.shellInput.handleShellStarted(event);
  };
  proto.cancelRunningShellCommand = function () {
    this.shellInput.cancelRunningShellCommand();
  };
  proto.sendNormalUserInput = function (
    text: string,
    options?: { readonly displayText?: string },
  ) {
    this.messageDispatch.sendNormalUserInput(text, options);
  };
  proto.loadPersistedInputHistory = function () {
    return this.shellInput.loadPersistedInputHistory();
  };
  proto.persistInputHistory = function (text: string) {
    return this.shellInput.persistInputHistory(text);
  };

  proto.beginSessionRequest = function () {
    this.sessionRequests.beginSessionRequest();
  };
  proto.failSessionRequest = function (message: string) {
    this.sessionRequests.failSessionRequest(message);
  };
  proto.sendQueuedMessage = function (session: Session, item: QueuedMessage) {
    this.messageDispatch.sendQueuedMessage(session, item);
  };
  proto.requestQueuedGoalPromotion = function () {
    this.sessionRequests.requestQueuedGoalPromotion();
  };
  proto.sendSkillActivation = function (session: Session, skillName: string, skillArgs: string) {
    this.sessionRequests.sendSkillActivation(session, skillName, skillArgs);
  };
  proto.activatePluginCommand = function (
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ) {
    this.sessionRequests.activatePluginCommand(session, pluginId, commandName, args);
  };
  proto.steerMessage = function (session: Session, input: string[]) {
    this.sessionRequests.steerMessage(session, input);
  };

  proto.setStartupReady = function () {
    this.state.startupState = 'ready';
  };
  proto.clearQueuedMessages = function () {
    this.messageDispatch.clearQueuedMessages();
  };
  proto.shiftQueuedMessage = function () {
    return this.messageDispatch.shiftQueuedMessage();
  };
  proto.pushTranscriptEntry = function (entry: TranscriptEntry) {
    this.state.transcriptEntries.push(entry);
  };
  proto.setExternalEditorRunning = function (running: boolean) {
    this.state.externalEditorRunning = running;
  };
  proto.setTasksBrowser = function (value: TUIState['tasksBrowser']) {
    this.state.tasksBrowser = value;
  };
  proto.appendStartupNotice = function (extra: string) {
    this.startupNotice = combineStartupNotice(this.startupNotice, extra);
  };

  Object.defineProperty(proto, 'backgroundTasks', {
    get(this: LioraTUI) {
      return this.sessionEventHandler.backgroundTasks;
    },
  });

  proto.getCurrentSessionId = function () {
    return this.sessionLifecycle.getCurrentSessionId();
  };
  proto.hasSessionContent = function () {
    return this.sessionLifecycle.hasSessionContent();
  };
  proto.setExitOpenUrl = function (url: string) {
    this.exitOpenUrl = url;
  };

  proto.setAppState = function (patch: Partial<AppState>) {
    this.appStateController.setAppState(patch);
  };
  proto.syncGoalMonitorPanel = function () {
    this.appStateController.syncGoalMonitorPanel();
  };
  proto.patchLivePane = function (patch: Partial<LivePaneState>) {
    this.appStateController.patchLivePane(patch);
  };
  proto.resetLivePane = function () {
    this.appStateController.resetLivePane();
  };
  proto.supportsCurrentModelCapability = function (capability: string) {
    return this.appStateController.supportsCurrentModelCapability(capability);
  };

  proto.requireSession = function () {
    return this.sessionLifecycle.requireSession();
  };
  proto.setSession = function (session: Session) {
    return this.sessionLifecycle.setSession(session);
  };
  proto.syncRuntimeState = function (session?: Session) {
    return this.sessionLifecycle.syncRuntimeState(session);
  };
  proto.closeSession = function (reason: string) {
    return this.sessionLifecycle.closeSession(reason);
  };
  proto.clearReverseRpcPanels = function () {
    this.reverseRpcPanels.clearReverseRpcPanels();
  };
  proto.cancelPendingReverseRpc = function (reason: string) {
    this.reverseRpcPanels.cancelPendingReverseRpc(reason);
  };
  proto.registerSessionHandlers = function (session: Session) {
    this.sessionLifecycle.registerSessionHandlers(session);
  };
  proto.resetSessionRuntime = function () {
    this.sessionLifecycle.resetSessionRuntime();
  };
  proto.fetchSessions = function (this: LioraTUI, scope: 'cwd' | 'all' = this.state.sessionsScope) {
    return this.sessionBrowser.fetchSessions(scope);
  };
  proto.updateTerminalTitle = function () {
    this.sessionBrowser.updateTerminalTitle();
  };
  proto.switchToSession = function (session: Session, statusMessage: string) {
    return this.sessionLifecycle.switchToSession(session, statusMessage);
  };
  proto.reloadCurrentSessionView = function (session: Session, statusMessage: string) {
    return this.sessionBrowser.reloadCurrentSessionView(session, statusMessage);
  };
  proto.createNewSession = function () {
    return this.sessionLifecycle.createNewSession();
  };

  proto.renderWelcome = function () {
    this.transcriptRender.renderWelcome();
  };
  proto.appendTranscriptEntry = function (entry: TranscriptEntry) {
    this.transcriptRender.appendTranscriptEntry(entry);
  };
  proto.appendPlanReviewTranscript = function (toolCallId, plan) {
    return this.transcriptRender.appendPlanReviewTranscript(toolCallId, plan);
  };
  proto.clearTranscriptAndRedraw = function () {
    this.transcriptRender.clearTranscriptAndRedraw();
  };
  proto.mergeCurrentTurnSteps = function () {
    return this.transcriptRender.mergeCurrentTurnSteps();
  };
  proto.mergeAllTurnSteps = function () {
    this.transcriptRender.mergeAllTurnSteps();
  };
  proto.showStatus = function (message: string, color?: ColorToken) {
    this.transcriptRender.showStatus(message, color);
  };
  proto.showNotice = function (
    title: string,
    detail?: string,
    options?: slashCommands.ShowNoticeOptions,
  ) {
    this.transcriptRender.showNotice(title, detail, options);
  };
  proto.showError = function (message: string) {
    this.transcriptRender.showError(message);
  };
  proto.showLoginProgressSpinner = function (label: string): LoginProgressSpinnerHandle {
    return this.transcriptRender.showLoginProgressSpinner(label);
  };
  proto.showProgressSpinner = function (label: string): LoginProgressSpinnerHandle {
    return this.transcriptRender.showProgressSpinner(label);
  };
  proto.showLoginAuthorizationPrompt = function (
    auth: DeviceAuthorization,
  ): LoginProgressSpinnerHandle {
    return this.transcriptRender.showLoginAuthorizationPrompt(auth);
  };

  proto.updateActivityPane = function () {
    this.panes.updateActivityPane();
  };
  proto.updateQueueDisplay = function () {
    this.panes.updateQueueDisplay();
  };
  proto.toggleToolOutputExpansion = function () {
    this.panes.toggleToolOutputExpansion();
  };
  proto.setTranscriptDetail = function (level: TranscriptDetailLevel) {
    this.panes.setTranscriptDetail(level);
  };
  proto.setNeatMode = function (enabled: boolean) {
    this.panes.setNeatMode(enabled);
  };
  proto.toggleTodoPanelExpansion = function () {
    this.panes.toggleTodoPanelExpansion();
  };
  proto.detachCurrentForegroundTask = function () {
    return this.panes.detachCurrentForegroundTask();
  };
  proto.updateEditorBorderHighlight = function (text?: string) {
    this.panes.updateEditorBorderHighlight(text);
  };
  proto.applyTheme = function (themeName: ThemeName, resolved?: ResolvedTheme) {
    return this.panes.applyTheme(themeName, resolved);
  };
  proto.refreshTerminalThemeTracking = function () {
    this.panes.refreshTerminalThemeTracking();
  };

  proto.isSessionLoadingOverlayActive = function () {
    return this.dialogs.isSessionLoadingOverlayActive();
  };
  proto.beginSessionLoading = function (sessionId?: string, title?: string) {
    this.dialogs.beginSessionLoading(sessionId, title);
  };
  proto.reportSessionLoading = function (patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }) {
    this.dialogs.reportSessionLoading(patch);
  };
  proto.endSessionLoading = function () {
    this.dialogs.endSessionLoading();
  };
  proto.runWithBusyOverlay = function <T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ) {
    return this.dialogs.runWithBusyOverlay(options, work);
  };
  proto.mountEditorReplacement = function (panel: Component & Focusable) {
    this.dialogs.mountEditorReplacement(panel);
  };
  proto.mountCenterModal = function (
    panel: Component & Focusable,
    options: CenterModalMountOptions = {},
  ) {
    this.dialogs.mountCenterModal(panel, options);
  };
  proto.closeCenterModal = function () {
    this.dialogs.closeCenterModal();
  };
  proto.closeAllCenterModals = function () {
    this.dialogs.closeAllCenterModals();
  };
  proto.restoreEditor = function () {
    this.dialogs.restoreEditor();
  };
  proto.restoreInputText = function (text: string) {
    this.dialogs.restoreInputText(text);
  };
  proto.stashPromptToggle = function () {
    this.dialogs.stashPromptToggle();
  };
  proto.showHistorySearch = function () {
    this.dialogs.showHistorySearch();
  };
  proto.showCommandHub = function (
    options: { readonly initialQuery?: string; readonly intro?: boolean } = {},
  ) {
    this.dialogs.showCommandHub(options);
  };
  proto.showTranscriptSearch = function () {
    this.dialogs.showTranscriptSearch();
  };
  proto.scrollToTranscriptIndex = function (index: number) {
    this.dialogs.scrollToTranscriptIndex(index);
  };
  proto.retryLastTurn = function () {
    return this.messageDispatch.retryLastTurn();
  };
  proto.setLastTurnFailed = function (failed: boolean) {
    this.messageDispatch.setLastTurnFailed(failed);
  };
  proto.showHelpPanel = function (args = '') {
    this.dialogs.showHelpPanel(args);
  };

  proto.showFileExplorer = function () {
    this.workspaceBrowser.showFileExplorer();
  };
  proto.showDiffReview = function (report: GitDiffReport, filter: string) {
    this.workspaceBrowser.showDiffReview(report, filter);
  };
  proto.showCommitBrowser = function (report: GitLogReport, filter: string) {
    this.workspaceBrowser.showCommitBrowser(report, filter);
  };
  proto.showErrors = function () {
    this.workspaceBrowser.showErrors();
  };
  proto.showSearchResults = function (results: SearchResults) {
    this.workspaceBrowser.showSearchResults(results);
  };
  proto.showWebContent = function (rawUrl: string | undefined) {
    this.workspaceBrowser.showWebContent(rawUrl);
  };
  proto.showBlame = function (rawPath: string | undefined) {
    this.workspaceBrowser.showBlame(rawPath);
  };

  proto.showSessionPicker = function () {
    return this.sessionBrowser.showSessionPicker();
  };
  proto.showExtensionsModal = function (args?: string) {
    return this.sessionBrowser.showExtensionsModal(args);
  };
  proto.hideExtensionsModal = function () {
    this.sessionBrowser.hideExtensionsModal();
  };
  proto.hideSessionPicker = function () {
    this.sessionBrowser.hideSessionPicker();
  };
  proto.openUndoSelector = function () {
    openUndoSelectorFromHost(this);
  };
  proto.openJobDeck = function (jobId?: string) {
    openJobDeckViewer(this, jobId);
  };
  proto.showApprovalPanel = function (payload: ApprovalPanelData) {
    this.reverseRpcPanels.showApprovalPanel(payload);
  };
  proto.focusPendingApprovalPanel = function () {
    return this.reverseRpcPanels.focusPendingApprovalPanel();
  };
  proto.showQuestionDialog = function (payload: QuestionPanelData) {
    this.reverseRpcPanels.showQuestionDialog(payload);
  };
  proto.recallLastQueued = function () {
    return this.messageDispatch.recallLastQueued();
  };
}
