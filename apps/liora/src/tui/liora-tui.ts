import {
  encodeRendererClearInlineImages,
  type Component,
  type Focusable,
  Spacer,
} from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type {
  ApprovalRequest,
  ApprovalResponse,
  BackgroundTaskInfo,
  CreateSessionOptions,
  LioraHarness,
  PermissionMode,
  Session,
} from '@superliora/sdk';
import { resolve } from 'pathe';

import type { CLIOptions } from '#/cli/options';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';
import { openUrl } from '#/utils/open-url';
import { detectFdPath } from '#/utils/process/fd-detect';
import { ttui } from './utils/tui-i18n';

import {
  type LioraSlashCommand,
  type RendererDiagnosticsOverlayCommand,
  type RendererTraceCommand,
  type SlashCommandHelpMode,
  type SkillListSession,
} from './commands';
import * as slashCommands from './commands/dispatch';
import { DeviceCodeBoxComponent } from './components/chrome/device-code-box';
import { MoonLoader, type SpinnerStyle } from './components/chrome/moon-loader';
import { IdleStageComponent } from './components/chrome/idle-stage';
import { SplashComponent, shouldPlaySplash } from './components/chrome/splash';
import { buildSplashMorphScene } from './utils/splash-reveal-preview';
import { pickRandomWorkingTip, tipText } from './components/chrome/working-tips';
import { CommandHubComponent } from './components/dialogs/command-hub';
import {
  SessionLoadingOverlayComponent,
  type SessionLoadingPhase,
} from './components/dialogs/session-loading-overlay';

import { AssistantMessageComponent } from './components/messages/assistant-message';
import { CronMessageComponent } from './components/messages/cron-message';
import { buildGoalMarker } from './components/messages/goal-markers';
import {
  GoalCompletionMessageComponent,
  GoalSetMessageComponent,
} from './components/messages/goal-panel';
import { PluginCommandComponent } from './components/messages/plugin-command';
import { SkillActivationComponent } from './components/messages/skill-activation';
import { ShellRunComponent } from './components/messages/shell-run';
import {
  NoticeMessageComponent,
  StatusMessageComponent,
} from './components/messages/status-message';
import { ThinkingComponent } from './components/messages/thinking';
import { StepSummaryComponent } from './components/messages/step-summary';
import { ToolCallComponent } from './components/messages/tool-call';
import { UserMessageComponent } from './components/messages/user-message';
import { ActivityPaneComponent, type ActivityPaneMode } from './components/panes/activity-pane';
import {
  QueuePaneComponent,
  queuePaneSelectionIdentity,
  resolveHostOwnedQueueSettleStartedAtMs,
} from './components/panes/queue-pane';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  type TuiConfig,
} from './config';
import {
  NO_ACTIVE_SESSION_MESSAGE,
} from './constant/liora-tui';
import { AppStateController } from './controllers/app-state';
import { AuthFlowController } from './controllers/auth-flow';
import { AutocompleteController } from './controllers/autocomplete';
import { AppearanceController, shouldRenderAmbientAnimationFrame } from './controllers/appearance';
import { BtwPanelController } from './controllers/btw-panel';
import { ClipboardImageHintController } from './controllers/clipboard-image-hint';
import { EditorKeyboardController } from './controllers/editor-keyboard';
import {
  NativeRendererDiagnosticsController,
  nativeRendererDiagnosticsOverlayEnabled,
} from './controllers/native-renderer-diagnostics';
import { PromptIntelligenceController } from './controllers/prompt-intelligence';
import { SessionEventHandler } from './controllers/session-event-handler';
import { DialogsController } from './controllers/dialogs';
import { MessageDispatchController } from './controllers/message-dispatch';
import { PanesController } from './controllers/panes';
import { ReverseRpcPanelsController } from './controllers/reverse-rpc-panels';
import { SessionBrowserController } from './controllers/session-browser';
import { SessionLifecycleController } from './controllers/session-lifecycle';
import { SessionRequestsController } from './controllers/session-requests';
import { ShellInputController } from './controllers/shell-input';
import { StartupLifecycleController } from './controllers/startup-lifecycle';
import { WorkspaceBrowserController } from './controllers/workspace-browser';
import { SessionReplayRenderer, type SessionReplayHost } from './controllers/session-replay';
import { StreamingUIController } from './controllers/streaming-ui';
import { TasksBrowserController } from './controllers/tasks-browser';
import { TranscriptRenderController } from './controllers/transcript-render';
import { UsageMonitorController } from './controllers/usage-monitor';
import { ApprovalController } from './reverse-rpc/approval/controller';
import { createApprovalRequestHandler } from './reverse-rpc/approval/handler';
import { registerReverseRPCHandlers } from './reverse-rpc/index';
import { QuestionController } from './reverse-rpc/question/controller';
import { createQuestionAskHandler } from './reverse-rpc/question/handler';
import { createContext7CredentialHandler } from './reverse-rpc/credential/handler';
import type { ApprovalPanelData, QuestionPanelData } from './reverse-rpc/types';
import { currentTheme, getColorPalette, getBuiltInPalette, isBuiltInTheme } from './theme';
import { refreshShikiPalette } from './components/media/shiki-ansi';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
import { appearanceAnimationNow, resolveUltraworkBorderGlowHex } from './utils/appearance-effects';
import { noteErrorFeedback } from './utils/feedback-vfx';
import type { TUIStateNativeInputRouter } from './utils/native-input-router';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type LioraTUIOptions,
  type LivePaneState,
  type LoginProgressSpinnerHandle,
  type QueuedMessage,
  type TranscriptDetailLevel,
  type TranscriptEntry,
  type TUIStartupOptions,
  type TUIStartupState,
} from './types';
import { hasDispose, isExpandable } from './utils/component-capabilities';
import { DisposableRegistry } from './utils/disposables';
import { contextWorkingSetSnapshotFromLoopControl } from './utils/context-working-set';
import type { CenterModalMountOptions } from './utils/center-modal';
import { requestTUILayoutRender } from './utils/frame-render';
import { createMotionBeatController } from './utils/motion-beats';
import { pickForegroundTasks } from './utils/foreground-task';
import { ImageAttachmentStore, type ImageAttachment } from './utils/image-attachment-store';
import { resolveImageProtocol } from './utils/image-protocol-detect';
import { PromptStash } from './utils/prompt-stash';
import { combineStartupNotice } from './utils/startup';
import { getTranscriptComponentEntry, markTranscriptComponent } from './utils/transcript-component-metadata';
import {
  TRANSCRIPT_EXPAND_TURNS,
  TRANSCRIPT_HYSTERESIS,
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
  TRANSCRIPT_WINDOW_ENABLED,
  groupTurns,
  turnsToTrim,
} from './utils/transcript-window';
import type { TranscriptScrollAction } from './utils/transcript-viewport';

export type { TUIState } from './tui-state';
export { createTUIState } from './tui-state';
export type {
  LioraTUIOptions,
  LoginProgressSpinnerHandle,
  TUIStartupOptions,
  TUIStartupState,
} from './types';

export interface LioraTUIStartupInput {
  readonly cliOptions: CLIOptions;
  readonly additionalDirs?: readonly string[];
  readonly tuiConfig: TuiConfig;
  readonly version: string;
  readonly workDir: string;
  readonly startupNotice?: string;
  readonly updateNotice?: { readonly currentVersion: string; readonly targetVersion: string; readonly installCommand: string };
  /** Optional session metadata (e.g. worktree) stamped on createSession. */
  readonly sessionMetadata?: import('@superliora/sdk').JsonObject;
}

function createInitialAppState(input: LioraTUIStartupInput): AppState {
  // Restore persisted permission mode; --auto CLI flag overrides.
  const startupPermission: PermissionMode = input.cliOptions.auto
    ? 'auto'
    : input.tuiConfig.permissionMode;
  return {
    model: '',
    workDir: input.workDir,
    additionalDirs: [...(input.additionalDirs ?? [])],
    sessionId: '',
    permissionMode: startupPermission,
    planMode: input.cliOptions.plan,
    ultraworkMode: false,
    premiumQualityMode: false,
    orchestratorMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    // Balanced defaults until harness config is loaded (footer badge stays stable).
    workingSet: contextWorkingSetSnapshotFromLoopControl({}),
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    promptIntelligencePhase: 'idle',
    activityTip: null,
    theme: input.tuiConfig.theme,
    disablePasteBurst: input.tuiConfig.disablePasteBurst,
    version: input.version,
    editorCommand: input.tuiConfig.editorCommand,
    notifications: input.tuiConfig.notifications,
    upgrade: input.tuiConfig.upgrade,
    appearance: input.tuiConfig.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
    onboarding: input.tuiConfig.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES,
    availableModels: {},
    availableProviders: {},
    nonVisionFallbackPolicy: 'analyze',
    providerRouteStatus: null,
    lastProviderRouteSelection: null,
    lastModelRouteNotice: null,
    sessionTitle: null,
    goal: null,
    mcpServersSummary: null,
    providerQuota: null,
    banner: undefined,
    updateNotice: input.updateNotice ?? null,
  };
}

export class LioraTUI {
  readonly harness: LioraHarness;
  readonly options: LioraTUIOptions;
  session: Session | undefined;
  state: TUIState;
  /** Thin transition-beat queue shared by harness enter/exit moments. */
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
  clipboardImageHintController: ClipboardImageHintController | undefined;
  signalCleanupHandlers: Array<() => void> = [];
  isShuttingDown = false;
  /** Central registry for timers, intervals, listeners, and watchers. */
  readonly disposables = new DisposableRegistry();
  eventLoopStarted = false;
  startupNotice: string | undefined;
  /** Startup cinematic splash; disposed after play or on shutdown. */
  splash: SplashComponent | undefined;
  /** UI children saved while the full-screen splash owns the tree. */
  splashSavedChildren: (typeof this.state.ui.children)[number][] | undefined;
  /** While true, ambient schedule stays armed even if interaction gates pause it. */
  splashForcesAmbient = false;
  lastHistoryContent: string | undefined;
  /** LIFO stash of prompt drafts saved via Ctrl-X while the editor has text. */
  readonly promptStash = new PromptStash();
  // Live `!` shell output entries, keyed by commandId so concurrent commands
  // each update their own card and stale events are dropped. Mutated in place
  // as `shell.output` events arrive; removed when the command completes.
  // `taskId` (from `shell.started`) lets ctrl+b detach the exact task.
  readonly shellOutputStreams = new Map<
    string,
    { entry: TranscriptEntry; component: ShellRunComponent; taskId?: string }
  >();
  readonly streamingUI: StreamingUIController;
  readonly authFlow: AuthFlowController;
  readonly appearanceController: AppearanceController;
  readonly btwPanelController: BtwPanelController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly transcriptRender: TranscriptRenderController;
  readonly panes: PanesController;
  readonly sessionLifecycle: SessionLifecycleController;
  readonly messageDispatch: MessageDispatchController;
  readonly sessionReplay: SessionReplayRenderer;
  readonly tasksBrowserController: TasksBrowserController;
  readonly usageMonitor: UsageMonitorController;
  readonly editorKeyboard: EditorKeyboardController;
  readonly promptIntelligence: PromptIntelligenceController;
  readonly dialogs: DialogsController;
  readonly workspaceBrowser: WorkspaceBrowserController;
  readonly sessionBrowser: SessionBrowserController;
  readonly reverseRpcPanels: ReverseRpcPanelsController;
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  nativeInputModalSequence = 0;
  centerModalSequence = 0;
  /** Live Command Hub instance while the center-modal stack owns it. */
  openCommandHub: CommandHubComponent | undefined;
  nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();
  private readonly sessionStartTime = Date.now();

  readonly autocomplete: AutocompleteController;
  readonly shellInput: ShellInputController;
  readonly sessionRequests: SessionRequestsController;
  readonly appStateController: AppStateController;
  readonly startupLifecycle: StartupLifecycleController;
  readonly nativeRendererDiagnostics: NativeRendererDiagnosticsController;

  /** Timer that auto-clears the one-shot "moved to background" footer hint. */
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;

  /** Last user-submitted text, for `/retry` / Hub → Chat → Retry. */
  lastUserInput: string | undefined;
  /** True when the most recent turn ended in an error; cleared on a clean turn. */
  private lastTurnFailed = false;

  // Deferred reverse-RPC payloads that arrived while a command-driven dialog
  // owned the editor area. Once the dialog closes (restoreEditor), the pending
  // approval/question is shown — preventing mid-flow clobbering (BUG-7).
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;

  public onExit?: (exitCode?: number) => Promise<void>;

  /** URL opened in the browser just before exit; printed by onExit. */
  public exitOpenUrl: string | undefined;

  track(event: string, properties?: Parameters<LioraHarness['track']>[1]): void {
    this.harness.track(event, properties);
  }

  constructor(harness: LioraHarness, startupInput: LioraTUIStartupInput) {
    this.harness = harness;
    const tuiOptions: LioraTUIOptions = {
      initialAppState: createInitialAppState(startupInput),
      startup: {
        sessionFlag: startupInput.cliOptions.session,
        continueLast: startupInput.cliOptions.continue,
        yolo: startupInput.cliOptions.yolo,
        auto: startupInput.cliOptions.auto,
        plan: startupInput.cliOptions.plan,
        model: startupInput.cliOptions.model,
        startupNotice: startupInput.startupNotice,
        resumeGoal: startupInput.cliOptions.resumeGoal,
      },
      sessionMetadata: startupInput.sessionMetadata,
    };
    this.options = tuiOptions;
    this.startupNotice = startupInput.startupNotice;
    this.state = createTUIState(tuiOptions);
    this.state.footer.setMotionBeatSource(() =>
      this.motionBeats.active(appearanceAnimationNow()),
    );

    this.reverseRpcDisposers.push(
      ...registerReverseRPCHandlers(this.approvalController, this.questionController, {
        showApprovalPanel: (payload) => {
          this.showApprovalPanel(payload);
        },
        hideApprovalPanel: () => {
          this.hideApprovalPanel();
        },
        showQuestionDialog: (payload) => {
          this.showQuestionDialog(payload);
        },
        hideQuestionDialog: () => {
          this.hideQuestionDialog();
        },
      }),
    );
    this.streamingUI = new StreamingUIController(this);
    this.authFlow = new AuthFlowController(this);
    this.appearanceController = new AppearanceController({
      terminal: this.state.terminal,
      getAppearance: () => this.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      requestRender: () => {
        this.state.renderer.requestRender('animation');
      },
      setAmbientSchedule: (options) => {
        this.state.renderer.nativeRuntime?.setAmbientSchedule(options);
      },
      onAppearanceApplied: () => {
        this.state.renderer.invalidateFrame('palette');
      },
      shouldRenderAnimation: () => this.shouldRenderAmbientAnimationFrame(),
      forceAmbientSchedule: () => this.splashForcesAmbient,
    });
    // Transcript density is session-live: seed from tui.toml
    // (`appearance.transcript_detail`); /transcript and Settings mutate it.
    this.state.transcriptDetail =
      this.state.appState.appearance?.transcriptDetail ?? 'standard';
    this.btwPanelController = new BtwPanelController(this);
    this.sessionEventHandler = new SessionEventHandler(this);
    this.transcriptRender = new TranscriptRenderController(this);
    this.panes = new PanesController(this);
    this.dialogs = new DialogsController(this);
    this.workspaceBrowser = new WorkspaceBrowserController(this);
    this.sessionBrowser = new SessionBrowserController(this);
    this.reverseRpcPanels = new ReverseRpcPanelsController(this);
    this.sessionReplay = new SessionReplayRenderer(this as unknown as SessionReplayHost);
    this.sessionLifecycle = new SessionLifecycleController(this);
    this.messageDispatch = new MessageDispatchController(this);
    this.autocomplete = new AutocompleteController(this);
    this.shellInput = new ShellInputController(this);
    this.appStateController = new AppStateController(this);
    this.sessionRequests = new SessionRequestsController(this);
    this.startupLifecycle = new StartupLifecycleController(this);
    this.nativeRendererDiagnostics = new NativeRendererDiagnosticsController(this);
    this.tasksBrowserController = new TasksBrowserController(this);
    this.usageMonitor = new UsageMonitorController({
      harness: this.harness,
      setAppState: (patch) => this.setAppState(patch),
      requestRender: () => requestTUILayoutRender(this.state),
    });
    this.editorKeyboard = new EditorKeyboardController(this, this.imageStore);
    this.editorKeyboard.install();
    this.promptIntelligence = new PromptIntelligenceController(this);
    this.promptIntelligence.install();
    this.startupLifecycle.buildLayout();
  }

  // =========================================================================
  // Autocomplete & Skill Commands
  // =========================================================================
  getSlashCommands(mode: SlashCommandHelpMode = 'primary'): readonly LioraSlashCommand[] {
    return this.autocomplete.getSlashCommands(mode);
  }

  /** Lets controllers (e.g. `DialogsController`) run a slash command without importing `dispatch` themselves. */
  dispatchSlash(command: string): void {
    slashCommands.dispatchInput(this, command);
  }

  runPluginsCommand(): Promise<void> {
    return slashCommands.handlePluginsCommand(this, '');
  }

  setupAutocomplete(): void {
    this.autocomplete.setupAutocomplete();
  }

  refreshSlashCommandAutocomplete(): void {
    this.autocomplete.refreshSlashCommandAutocomplete();
  }

  async refreshSkillCommands(session?: SkillListSession): Promise<void> {
    return this.autocomplete.refreshSkillCommands(session);
  }

  async refreshDynamicSlashCommands(session?: Session): Promise<void> {
    return this.autocomplete.refreshDynamicSlashCommands(session);
  }
  // =========================================================================
  // Lifecycle
  // =========================================================================
  async start(): Promise<void> {
    return this.startupLifecycle.start();
  }

  private async loadBanner(): Promise<void> {
    return this.startupLifecycle.loadBanner();
  }

  private async initMainTui(): Promise<boolean> {
    return this.startupLifecycle.initMainTui();
  }

  private async init(): Promise<boolean> {
    return this.startupLifecycle.init();
  }

  async stop(exitCode?: number): Promise<void> {
    return this.startupLifecycle.stop(exitCode);
  }

  private registerSignalHandlers(): void {
    this.startupLifecycle.registerSignalHandlers();
  }

  private unregisterSignalHandlers(): void {
    this.startupLifecycle.unregisterSignalHandlers();
  }

  private emergencyTerminalExit(exitCode = 129): never {
    return this.startupLifecycle.emergencyTerminalExit(exitCode);
  }

  private shouldRenderAmbientAnimationFrame(): boolean {
    const selection = this.state.transcriptSelection;
    return shouldRenderAmbientAnimationFrame(
      this.state.terminal.rows,
      selection.isDragging || selection.hasSelection,
    );
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    return this.startupLifecycle.scrollTranscriptViewport(action);
  }

  setNativeRendererDiagnosticsOverlay(command: RendererDiagnosticsOverlayCommand): void {
    this.nativeRendererDiagnostics.setNativeRendererDiagnosticsOverlay(command);
  }

  setNativeRendererTrace(command: RendererTraceCommand): void {
    this.nativeRendererDiagnostics.setNativeRendererTrace(command);
  }

  async showSessionWarnings(session: Session): Promise<void> {
    return this.startupLifecycle.showSessionWarnings(session);
  }

  private async finishStartup(shouldReplayHistory: boolean): Promise<void> {
    return this.startupLifecycle.finishStartup(shouldReplayHistory);
  }

  private async refreshProviderModelsInBackground(): Promise<void> {
    return this.startupLifecycle.refreshProviderModelsInBackground();
  }
  // =========================================================================
  // Input Dispatch
  // =========================================================================
  handlePlanToggle(next: boolean, ultra = false): void {
    void slashCommands.handlePlanCommand(this, next ? (ultra ? 'ultra' : 'on') : 'off');
  }

  handleUltraworkModeToggle(next: boolean): void {
    void slashCommands.handleUltraworkModeToggle(this, next);
  }

  handleInputModeChange(mode: 'prompt' | 'bash'): void {
    this.setAppState({ inputMode: mode });
    this.updateEditorBorderHighlight();
  }

  handleUserInput(text: string): void {
    this.messageDispatch.handleUserInput(text);
  }

  dispatchSlashInput(text: string): void {
    slashCommands.dispatchInput(this, text);
  }

  runShellCommandFromInput(command: string): void {
    this.shellInput.runShellCommandFromInput(command);
  }

  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void {
    this.shellInput.handleShellOutput(event);
  }

  handleShellStarted(event: { commandId: string; taskId: string }): void {
    this.shellInput.handleShellStarted(event);
  }

  cancelRunningShellCommand(): void {
    this.shellInput.cancelRunningShellCommand();
  }

  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void {
    this.messageDispatch.sendNormalUserInput(text, options);
  }

  supportsCurrentModelCapability(capability: string): boolean {
    const capabilities =
      this.state.appState.availableModels[this.state.appState.model]?.capabilities;
    if (capabilities === undefined) return true;
    return capabilities.includes(capability);
  }

  async loadPersistedInputHistory(): Promise<void> {
    return this.shellInput.loadPersistedInputHistory();
  }

  async persistInputHistory(text: string): Promise<void> {
    return this.shellInput.persistInputHistory(text);
  }

  recallLastQueued(): QueuedMessage | undefined {
    if (this.state.queuedMessages.length === 0) return undefined;
    const last = this.state.queuedMessages.at(-1)!;
    this.state.queuedMessages = this.state.queuedMessages.slice(0, -1);
    return last;
  }
  // =========================================================================
  // Session Requests / Queues
  // =========================================================================
  beginSessionRequest(): void {
    this.sessionRequests.beginSessionRequest();
  }

  failSessionRequest(message: string): void {
    this.sessionRequests.failSessionRequest(message);
  }

  sendQueuedMessage(session: Session, item: QueuedMessage): void {
    this.messageDispatch.sendQueuedMessage(session, item);
  }

  requestQueuedGoalPromotion(): void {
    this.sessionRequests.requestQueuedGoalPromotion();
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    this.sessionRequests.sendSkillActivation(session, skillName, skillArgs);
  }

  activatePluginCommand(
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ): void {
    this.sessionRequests.activatePluginCommand(session, pluginId, commandName, args);
  }

  steerMessage(session: Session, input: string[]): void {
    this.sessionRequests.steerMessage(session, input);
  }
  // =========================================================================
  // State & Accessors
  // =========================================================================

  setStartupReady(): void {
    this.state.startupState = 'ready';
  }

  clearQueuedMessages(): void {
    this.state.queuedMessages = [];
  }

  shiftQueuedMessage(): QueuedMessage | undefined {
    if (this.state.queuedMessages.length === 0) return undefined;
    const [first, ...rest] = this.state.queuedMessages;
    this.state.queuedMessages = rest;
    return first;
  }

  pushTranscriptEntry(entry: TranscriptEntry): void {
    this.state.transcriptEntries.push(entry);
  }

  setExternalEditorRunning(running: boolean): void {
    this.state.externalEditorRunning = running;
  }

  setTasksBrowser(value: TUIState['tasksBrowser']): void {
    this.state.tasksBrowser = value;
  }

  appendStartupNotice(extra: string): void {
    this.startupNotice = combineStartupNotice(this.startupNotice, extra);
  }

  get backgroundTasks(): ReadonlyMap<string, BackgroundTaskInfo> {
    return this.sessionEventHandler.backgroundTasks;
  }

  getCurrentSessionId(): string {
    return this.state.appState.sessionId;
  }

  hasSessionContent(): boolean {
    return this.state.transcriptEntries.length > 0;
  }

  setExitOpenUrl(url: string): void {
    this.exitOpenUrl = url;
  }

  async getStartupMcpMs(): Promise<number> {
    const session = this.session;
    if (session === undefined) return 0;
    try {
      const metrics = await session.getMcpStartupMetrics();
      return metrics.durationMs;
    } catch {
      return 0;
    }
  }

  setAppState(patch: Partial<AppState>): void {
    this.appStateController.setAppState(patch);
  }

  syncGoalMonitorPanel(): void {
    this.appStateController.syncGoalMonitorPanel();
  }

  patchLivePane(patch: Partial<LivePaneState>): void {
    this.appStateController.patchLivePane(patch);
  }

  resetLivePane(): void {
    this.appStateController.resetLivePane();
  }
  // =========================================================================
  // Session Runtime
  // =========================================================================

  requireSession(): Session {
    if (this.session === undefined) {
      throw new Error(NO_ACTIVE_SESSION_MESSAGE);
    }
    return this.session;
  }

  async setSession(session: Session): Promise<void> {
    return this.sessionLifecycle.setSession(session);
  }

  async syncRuntimeState(session: Session = this.requireSession()): Promise<void> {
    return this.sessionLifecycle.syncRuntimeState(session);
  }

  async closeSession(reason: string): Promise<void> {
    return this.sessionLifecycle.closeSession(reason);
  }

  clearReverseRpcPanels(): void {
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
  }

  cancelPendingReverseRpc(reason: string): void {
    this.approvalController.cancelAll(reason);
    this.questionController.cancelAll(reason);
  }

  registerSessionHandlers(session: Session): void {
    session.setApprovalHandler(
      createApprovalRequestHandler(this.approvalController, (request, response) => {
        this.transcriptRender.appendApprovalTranscriptEntry(request, response);
      }),
    );
    session.setQuestionHandler(createQuestionAskHandler(this.questionController));
    session.setCredentialHandler(createContext7CredentialHandler(this));
  }

  async fetchSessions(scope: 'cwd' | 'all' = this.state.sessionsScope): Promise<void> {
    return this.sessionBrowser.fetchSessions(scope);
  }

  updateTerminalTitle(): void {
    this.sessionBrowser.updateTerminalTitle();
  }

  resetSessionRuntime(): void {
    this.aborted = false;
    this.streamingUI.discardPending();
    this.state.queuedMessages = [];
    this.state.swarmModeEntry = undefined;
    this.streamingUI.resetToolCallState();
    this.streamingUI.resetToolUi();
    this.sessionEventHandler.resetRuntimeState();
    this.skillCommands = [];
    this.skillCommandMap.clear();
    this.pluginCommands = [];
    this.pluginCommandMap.clear();
    this.tasksBrowserController.close();
    this.btwPanelController.clear();
    this.state.footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 0 });
    this.streamingUI.setTodoList([]);
    this.streamingUI.setTurnId(undefined);
    this.setAppState({ mcpServersSummary: null });
    this.streamingUI.setStep(0);
    this.streamingUI.resetLiveText();
    this.updateQueueDisplay();
  }

  async switchToSession(session: Session, statusMessage: string): Promise<void> {
    return this.sessionLifecycle.switchToSession(session, statusMessage);
  }

  async reloadCurrentSessionView(session: Session, statusMessage: string): Promise<void> {
    return this.sessionBrowser.reloadCurrentSessionView(session, statusMessage);
  }

  async createNewSession(): Promise<void> {
    return this.sessionLifecycle.createNewSession();
  }

  // =========================================================================
  // Transcript Rendering
  // =========================================================================

  renderWelcome(): void {
    this.transcriptRender.renderWelcome();
  }

  appendTranscriptEntry(entry: TranscriptEntry): void {
    this.transcriptRender.appendTranscriptEntry(entry);
  }

  clearTranscriptAndRedraw(): void {
    this.transcriptRender.clearTranscriptAndRedraw();
  }

  mergeCurrentTurnSteps(): boolean {
    return this.transcriptRender.mergeCurrentTurnSteps();
  }

  mergeAllTurnSteps(): void {
    this.transcriptRender.mergeAllTurnSteps();
  }

  showStatus(message: string, color?: ColorToken): void {
    this.transcriptRender.showStatus(message, color);
  }

  showNotice(
    title: string,
    detail?: string,
    options?: slashCommands.ShowNoticeOptions,
  ): void {
    this.transcriptRender.showNotice(title, detail, options);
  }

  showError(message: string): void {
    this.transcriptRender.showError(message);
  }

  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return this.transcriptRender.showLoginProgressSpinner(label);
  }

  showProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return this.transcriptRender.showProgressSpinner(label);
  }

  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle {
    return this.transcriptRender.showLoginAuthorizationPrompt(auth);
  }

  // =========================================================================
  // Panes / Presentation State
  // =========================================================================

  updateActivityPane(): void {
    this.panes.updateActivityPane();
  }

  updateQueueDisplay(): void {
    this.panes.updateQueueDisplay();
  }

  toggleToolOutputExpansion(): void {
    this.panes.toggleToolOutputExpansion();
  }

  /**
   * Switch transcript density live (PREMIUM.md §7.9). Re-projects every
   * mounted tool card — including replayed history — and re-renders.
   * `/transcript` and the Settings appearance selector call this.
   */
  setTranscriptDetail(level: TranscriptDetailLevel): void {
    this.panes.setTranscriptDetail(level);
  }

  toggleTodoPanelExpansion(): void {
    this.panes.toggleTodoPanelExpansion();
  }

  async detachCurrentForegroundTask(): Promise<void> {
    return this.panes.detachCurrentForegroundTask();
  }

  updateEditorBorderHighlight(text?: string): void {
    this.panes.updateEditorBorderHighlight(text);
  }

  async applyTheme(themeName: ThemeName, resolved?: ResolvedTheme): Promise<void> {
    return this.panes.applyTheme(themeName, resolved);
  }

  refreshTerminalThemeTracking(): void {
    this.panes.refreshTerminalThemeTracking();
  }

  // =========================================================================
  // Dialogs / Selectors
  // =========================================================================

  isSessionLoadingOverlayActive(): boolean {
    return this.dialogs.isSessionLoadingOverlayActive();
  }

  beginSessionLoading(sessionId?: string, title?: string): void {
    this.dialogs.beginSessionLoading(sessionId, title);
  }

  reportSessionLoading(patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void {
    this.dialogs.reportSessionLoading(patch);
  }

  endSessionLoading(): void {
    this.dialogs.endSessionLoading();
  }

  async runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T> {
    return this.dialogs.runWithBusyOverlay(options, work);
  }

  mountEditorReplacement(panel: Component & Focusable): void {
    this.dialogs.mountEditorReplacement(panel);
  }

  /**
   * Float a PREMIUM panel in the viewport center (Command Hub, Settings, …).
   * Does not replace the editor strip. See PREMIUM.md §8.2.
   */
  mountCenterModal(
    panel: Component & Focusable,
    options: CenterModalMountOptions = {},
  ): void {
    this.dialogs.mountCenterModal(panel, options);
  }

  /** Pop the top center modal. Restores editor focus when the stack is empty. */
  closeCenterModal(): void {
    this.dialogs.closeCenterModal();
  }

  closeAllCenterModals(): void {
    this.dialogs.closeAllCenterModals();
  }

  restoreEditor(): void {
    this.dialogs.restoreEditor();
  }

  restoreInputText(text: string): void {
    this.dialogs.restoreInputText(text);
  }

  /** Ctrl-X: stash the current draft, or pop the latest stash when the editor is empty. */
  stashPromptToggle(): void {
    this.dialogs.stashPromptToggle();
  }

  // =========================================================================
  // History search (Ctrl-R), Command Hub (? / Ctrl-K),
  // transcript search (Ctrl-F)
  // =========================================================================

  showHistorySearch(): void {
    this.dialogs.showHistorySearch();
  }

  /** Open the beginner Command Hub (replaces the old Ctrl-Space palette). */
  showCommandPalette(): void {
    this.dialogs.showCommandPalette();
  }

  /**
   * Power-user omnibox: fuzzy-search every slash command, skill, and a few
   * session actions, then run the selection. Opened from the Hub
   * (Help → Command palette); Esc returns to the Hub when it is stacked
   * below. Recently run entries float to the top via Hub recency scoring.
   */
  showCommandPaletteOmnibox(): void {
    this.dialogs.showCommandPaletteOmnibox();
  }

  showCommandHub(
    options: { readonly initialQuery?: string; readonly intro?: boolean } = {},
  ): void {
    this.dialogs.showCommandHub(options);
  }

  showTranscriptSearch(): void {
    this.dialogs.showTranscriptSearch();
  }

  /** Shared with the Error Navigator (`showErrors`) to jump to a transcript entry. */
  scrollToTranscriptIndex(index: number): void {
    this.dialogs.scrollToTranscriptIndex(index);
  }

  async retryLastTurn(): Promise<void> {
    const session = this.session;
    if (session === undefined || this.lastUserInput === undefined) {
      this.showError(ttui('tui.retry.none'));
      return;
    }
    if (this.state.appState.streamingPhase !== 'idle') return;
    this.lastTurnFailed = false;
    this.showStatus(ttui('tui.retry.resending'), 'primary');
    this.messageDispatch.sendMessageInternal(session, this.lastUserInput);
  }

  setLastTurnFailed(failed: boolean): void {
    this.lastTurnFailed = failed;
  }

  showHelpPanel(args = ''): void {
    this.dialogs.showHelpPanel(args);
  }

  showFileExplorer(): void {
    this.workspaceBrowser.showFileExplorer();
  }

  showDiffReview(report: GitDiffReport, filter: string): void {
    this.workspaceBrowser.showDiffReview(report, filter);
  }

  showCommitBrowser(report: GitLogReport, filter: string): void {
    this.workspaceBrowser.showCommitBrowser(report, filter);
  }

  showErrors(): void {
    this.workspaceBrowser.showErrors();
  }

  showSearchResults(results: SearchResults): void {
    this.workspaceBrowser.showSearchResults(results);
  }

  showWebContent(rawUrl: string | undefined): void {
    this.workspaceBrowser.showWebContent(rawUrl);
  }

  showBlame(rawPath: string | undefined): void {
    this.workspaceBrowser.showBlame(rawPath);
  }

  helpModeFromArgs(args: string): SlashCommandHelpMode {
    const normalized = args.trim().toLowerCase();
    if (normalized === 'diagnostics' || normalized === 'diagnostic' || normalized === 'internal') {
      return 'diagnostics';
    }
    return normalized === 'advanced' || normalized === 'manual' ? 'advanced' : 'primary';
  }

  /** Editor-area modal while resume RPC + history hydrate run. */
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  sessionLoadingPulseTimer: ReturnType<typeof setInterval> | undefined;

  async showSessionPicker(): Promise<void> {
    return this.sessionBrowser.showSessionPicker();
  }

  async showAgentDashboard(): Promise<void> {
    return this.sessionBrowser.showAgentDashboard();
  }

  hideAgentDashboard(): void {
    this.sessionBrowser.hideAgentDashboard();
  }

  async showExtensionsModal(args?: string): Promise<void> {
    return this.sessionBrowser.showExtensionsModal(args);
  }

  hideExtensionsModal(): void {
    this.sessionBrowser.hideExtensionsModal();
  }

  hideSessionPicker(): void {
    this.sessionBrowser.hideSessionPicker();
  }

  private async bootstrapFromPicker(): Promise<void> {
    return this.sessionBrowser.bootstrapFromPicker();
  }

  openUndoSelector(): void {
    void slashCommands.handleUndoCommand(this, '');
  }

  showApprovalPanel(payload: ApprovalPanelData): void {
    this.reverseRpcPanels.showApprovalPanel(payload);
  }

  private hideApprovalPanel(): void {
    this.reverseRpcPanels.hideApprovalPanel();
  }

  showQuestionDialog(payload: QuestionPanelData): void {
    this.reverseRpcPanels.showQuestionDialog(payload);
  }

  private hideQuestionDialog(): void {
    this.reverseRpcPanels.hideQuestionDialog();
  }
}

