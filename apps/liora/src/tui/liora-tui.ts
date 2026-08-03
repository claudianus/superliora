import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { BackgroundTaskInfo, LioraHarness, Session } from '@superliora/sdk';
import { detectFdPath } from '#/utils/process/fd-detect';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';

import type {
  LioraSlashCommand,
  RendererDiagnosticsOverlayCommand,
  RendererTraceCommand,
  SlashCommandHelpMode,
  SkillListSession,
} from './commands';
import * as slashCommands from './commands/hub/dispatch';
import { CommandHubComponent } from './components/dialogs/command-hub/index';
import {
  SessionLoadingOverlayComponent,
  type SessionLoadingPhase,
} from './components/dialogs/session/session-loading-overlay';
import { ShellRunComponent } from './components/messages/shell/shell-run';
import { AppStateController } from './controllers/wiring/app-state';
import { AuthFlowController } from './controllers/auth/auth-flow';
import { AutocompleteController } from './controllers/shell/autocomplete';
import { AppearanceController } from './controllers/appearance/index';
import { BtwPanelController } from './controllers/panes/btw-panel';
import { DialogsController } from './controllers/dialogs/index';
import { EditorKeyboardController } from './controllers/shell/editor-keyboard';
import { installLioraTUIDelegates } from './controllers/wiring/liora-tui-delegates';
import { wireLioraTUIControllers } from './controllers/wiring/liora-tui-wiring';
import { MessageDispatchController } from './controllers/transcript/message-dispatch';
import { NativeRendererDiagnosticsController } from './controllers/diagnostics/native-renderer-diagnostics';
import { PanesController } from './controllers/panes/panes';
import { PromptIntelligenceController } from './controllers/prompt/prompt-intelligence';
import { ReverseRpcPanelsController } from './controllers/panes/reverse-rpc-panels';
import { SessionBrowserController } from './controllers/session/session-browser';
import { SessionEventHandler } from './controllers/session-event/handler';
import { SessionLifecycleController } from './controllers/session/session-lifecycle';
import { SessionReplayRenderer } from './controllers/session-replay/index';
import { SessionRequestsController } from './controllers/session/session-requests';
import { ShellInputController } from './controllers/shell/shell-input';
import { StartupLifecycleController } from './controllers/startup-lifecycle/index';
import { StreamingUIController } from './controllers/streaming-ui/index';
import { TasksBrowserController } from './controllers/panes/tasks-browser';
import { JobBoardController } from './controllers/panes/job-board';
import { JobBoardStore } from './features/control-tower/job-board-store';
import { ControlTowerJobDesk } from './features/control-tower/job-desk-events';
import { TranscriptRenderController } from './controllers/transcript/transcript-render';
import { UsageMonitorController } from './controllers/usage/usage-monitor';
import { WorkspaceBrowserController } from './controllers/panes/workspace-browser';
import { ApprovalController } from './reverse-rpc/approval/controller';
import { QuestionController } from './reverse-rpc/question/controller';
import type { ApprovalPanelData, QuestionPanelData } from './reverse-rpc/types';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
import type { CenterModalMountOptions } from './utils/ui/center-modal';
import { DisposableRegistry } from './utils/disposables';
import { createMotionBeatController } from './utils/render/motion-beats';
import { ImageAttachmentStore } from './utils/image/image-attachment-store';
import { PromptStash } from './utils/prompt-stash';
import type { TranscriptScrollAction } from './features/transcript/transcript-viewport';
import type { TUIStateNativeInputRouter } from './features/native-layout/native-input-router';
import type {
  AppState,
  LivePaneState,
  LioraTUIOptions,
  LioraTUIStartupInput,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptDetailLevel,
  TranscriptEntry,
} from './types';
import { SplashComponent } from './components/chrome/splash';

export type { TUIState } from './tui-state';
export { createTUIState } from './tui-state';
export type {
  LioraTUIStartupInput,
  LioraTUIOptions,
  LoginProgressSpinnerHandle,
  TUIStartupOptions,
  TUIStartupState,
} from './types';

class LioraTUIClass {
  readonly harness: LioraHarness;
  readonly options!: LioraTUIOptions;
  session: Session | undefined;
  state!: TUIState;
  readonly motionBeats = createMotionBeatController();
  readonly approvalController = new ApprovalController();
  readonly questionController = new QuestionController();
  readonly reverseRpcDisposers: Array<() => void> = [];
  skillCommands: LioraSlashCommand[] = [];
  pluginCommands: LioraSlashCommand[] = [];
  readonly skillCommandMap = new Map<string, string>();
  readonly pluginCommandMap = new Map<string, string>();
  readonly imageStore = new ImageAttachmentStore();
  fdPath: string | null = detectFdPath();
  fdDownloadStarted = false;
  sessionEventUnsubscribe: (() => void) | undefined;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages = false;
  aborted = false;
  terminalFocusTrackingDispose: (() => void) | undefined;
  clipboardImageHintController: import('./controllers/clipboard/clipboard-image-hint').ClipboardImageHintController | undefined;
  signalCleanupHandlers: Array<() => void> = [];
  isShuttingDown = false;
  readonly disposables = new DisposableRegistry();
  eventLoopStarted = false;
  startupNotice: string | undefined;
  splash: SplashComponent | undefined;
  splashSavedChildren: (typeof this.state.ui.children)[number][] | undefined;
  splashForcesAmbient = false;
  lastHistoryContent: string | undefined;
  readonly promptStash = new PromptStash();
  readonly shellOutputStreams = new Map<
    string,
    { entry: TranscriptEntry; component: ShellRunComponent; taskId?: string }
  >();
  streamingUI!: StreamingUIController;
  authFlow!: AuthFlowController;
  appearanceController!: AppearanceController;
  btwPanelController!: BtwPanelController;
  sessionEventHandler!: SessionEventHandler;
  transcriptRender!: TranscriptRenderController;
  panes!: PanesController;
  sessionLifecycle!: SessionLifecycleController;
  messageDispatch!: MessageDispatchController;
  sessionReplay!: SessionReplayRenderer;
  tasksBrowserController!: TasksBrowserController;
  jobBoardController!: JobBoardController;
  jobBoardStore!: JobBoardStore;
  controlTowerDesk!: ControlTowerJobDesk;
  usageMonitor!: UsageMonitorController;
  editorKeyboard!: EditorKeyboardController;
  promptIntelligence!: PromptIntelligenceController;
  dialogs!: DialogsController;
  workspaceBrowser!: WorkspaceBrowserController;
  sessionBrowser!: SessionBrowserController;
  reverseRpcPanels!: ReverseRpcPanelsController;
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  nativeInputModalSequence = 0;
  centerModalSequence = 0;
  openCommandHub: CommandHubComponent | undefined;
  nativeRendererDiagnosticsHudEnabled = false;
  autocomplete!: AutocompleteController;
  shellInput!: ShellInputController;
  sessionRequests!: SessionRequestsController;
  appStateController!: AppStateController;
  startupLifecycle!: StartupLifecycleController;
  nativeRendererDiagnostics!: NativeRendererDiagnosticsController;
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;
  lastUserInput: string | undefined;
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  sessionLoadingPulseTimer: ReturnType<typeof setInterval> | undefined;

  public onExit?: (exitCode?: number) => Promise<void>;
  public exitOpenUrl: string | undefined;

  constructor(harness: LioraHarness, startupInput: LioraTUIStartupInput) {
    this.harness = harness;
    wireLioraTUIControllers(this as unknown as LioraTUI, harness, startupInput);
  }

  track(event: string, properties?: Parameters<LioraHarness['track']>[1]): void {
    this.harness.track(event, properties);
  }
}

export interface LioraTUIHost {
  getSlashCommands(mode?: SlashCommandHelpMode): readonly LioraSlashCommand[];
  dispatchSlash(command: string): void;
  runPluginsCommand(): Promise<void>;
  setupAutocomplete(): void;
  refreshSlashCommandAutocomplete(): void;
  refreshSkillCommands(session?: SkillListSession): Promise<void>;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  start(): Promise<void>;
  stop(exitCode?: number): Promise<void>;
  registerSignalHandlers(): void;
  unregisterSignalHandlers(): void;
  emergencyTerminalExit(exitCode?: number): never;
  initMainTui(): Promise<boolean>;
  init(): Promise<boolean>;
  /** Wire native input router after `init()` when tests skip `initMainTui()`. */
  ensureNativeInputRouter(): void;
  loadBanner(): Promise<void>;
  finishStartup(shouldReplayHistory: boolean): Promise<void>;
  refreshProviderModelsInBackground(): Promise<void>;
  bootstrapFromPicker(): Promise<void>;
  scrollTranscriptViewport(action: TranscriptScrollAction): boolean;
  getStartupMcpMs(): Promise<number>;
  setNativeRendererDiagnosticsOverlay(command: RendererDiagnosticsOverlayCommand): void;
  setNativeRendererTrace(command: RendererTraceCommand): void;
  showSessionWarnings(session: Session): Promise<void>;
  handlePlanToggle(next: boolean, ultra?: boolean): void;
  handleUltraworkModeToggle(next: boolean): void;
  handleInputModeChange(mode: 'prompt' | 'bash'): void;
  handleUserInput(text: string): void;
  dispatchSlashInput(text: string): void;
  runShellCommandFromInput(command: string): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
  cancelRunningShellCommand(): void;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  supportsCurrentModelCapability(capability: string): boolean;
  loadPersistedInputHistory(): Promise<void>;
  persistInputHistory(text: string): Promise<void>;
  recallLastQueued(): QueuedMessage | undefined;
  beginSessionRequest(): void;
  failSessionRequest(message: string): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  requestQueuedGoalPromotion(): void;
  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void;
  activatePluginCommand(
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ): void;
  steerMessage(session: Session, input: string[]): void;
  setStartupReady(): void;
  clearQueuedMessages(): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  pushTranscriptEntry(entry: TranscriptEntry): void;
  setExternalEditorRunning(running: boolean): void;
  setTasksBrowser(value: TUIState['tasksBrowser']): void;
  setJobBoard(value: TUIState['jobBoard']): void;
  appendStartupNotice(extra: string): void;
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  getCurrentSessionId(): string;
  hasSessionContent(): boolean;
  setExitOpenUrl(url: string): void;
  setAppState(patch: Partial<AppState>): void;
  syncGoalMonitorPanel(): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  requireSession(): Session;
  setSession(session: Session): Promise<void>;
  syncRuntimeState(session?: Session): Promise<void>;
  closeSession(reason: string): Promise<void>;
  clearReverseRpcPanels(): void;
  cancelPendingReverseRpc(reason: string): void;
  registerSessionHandlers(session: Session): void;
  resetSessionRuntime(): void;
  fetchSessions(scope?: 'cwd' | 'all'): Promise<void>;
  updateTerminalTitle(): void;
  switchToSession(session: Session, statusMessage: string): Promise<void>;
  reloadCurrentSessionView(session: Session, statusMessage: string): Promise<void>;
  createNewSession(): Promise<void>;
  renderWelcome(): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  clearTranscriptAndRedraw(): void;
  mergeCurrentTurnSteps(): boolean;
  mergeAllTurnSteps(): void;
  showStatus(message: string, color?: ColorToken): void;
  showNotice(
    title: string,
    detail?: string,
    options?: slashCommands.ShowNoticeOptions,
  ): void;
  showError(message: string): void;
  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle;
  showProgressSpinner(label: string): LoginProgressSpinnerHandle;
  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  toggleToolOutputExpansion(): void;
  setTranscriptDetail(level: TranscriptDetailLevel): void;
  toggleTodoPanelExpansion(): void;
  detachCurrentForegroundTask(): Promise<void>;
  updateEditorBorderHighlight(text?: string): void;
  applyTheme(themeName: ThemeName, resolved?: ResolvedTheme): Promise<void>;
  refreshTerminalThemeTracking(): void;
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
  closeCenterModal(): void;
  closeAllCenterModals(): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  stashPromptToggle(): void;
  showHistorySearch(): void;
  showCommandHub(options?: { readonly initialQuery?: string; readonly intro?: boolean }): void;
  showTranscriptSearch(): void;
  scrollToTranscriptIndex(index: number): void;
  retryLastTurn(): Promise<void>;
  setLastTurnFailed(failed: boolean): void;
  showHelpPanel(args?: string): void;
  showFileExplorer(): void;
  showDiffReview(report: GitDiffReport, filter: string): void;
  showCommitBrowser(report: GitLogReport, filter: string): void;
  showErrors(): void;
  showSearchResults(results: SearchResults): void;
  showWebContent(rawUrl: string | undefined): void;
  showBlame(rawPath: string | undefined): void;
  showSessionPicker(): Promise<void>;
  showAgentDashboard(): Promise<void>;
  hideAgentDashboard(): void;
  showExtensionsModal(args?: string): Promise<void>;
  hideExtensionsModal(): void;
  hideSessionPicker(): void;
  openUndoSelector(): void;
  showApprovalPanel(payload: ApprovalPanelData): void;
  focusPendingApprovalPanel(): boolean;
  showQuestionDialog(payload: QuestionPanelData): void;
}

/** Instance type includes prototype-mixed delegates from {@link installLioraTUIDelegates}. */
export type LioraTUI = LioraTUIClass & LioraTUIHost;

export const LioraTUI = LioraTUIClass as unknown as {
  new (harness: LioraHarness, startupInput: LioraTUIStartupInput): LioraTUI;
  prototype: LioraTUI;
};

installLioraTUIDelegates(LioraTUI);
