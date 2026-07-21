import { writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import chalk from 'chalk';
import {
  encodeRendererClearInlineImages,
  LioraNativeRootUI,
  NativeTerminalSession,
  type Component,
  type Focusable,
  type NativeInputEvent,
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
  PromptPart,
  Session,
} from '@superliora/sdk';
import { resolve } from 'pathe';

import type { CLIOptions } from '#/cli/options';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import {
  appendGlobalInputHistory,
  appendInputHistory,
  loadGlobalInputHistory,
  loadInputHistory,
} from '#/utils/history/input-history';
import { loadFileForViewer } from '#/utils/fs/file-content';
import { buildFileTree, listProjectFiles } from '#/utils/fs/file-tree';
import type { SearchResults } from '#/utils/fs/project-search';
import { collectGitBlame } from '#/utils/git/git-blame';
import type { GitDiffReport } from '#/utils/git/git-diff';
import { collectCommitDiff, type GitLogReport } from '#/utils/git/git-log';
import { openUrl } from '#/utils/open-url';
import { getGlobalInputHistoryFile, getInputHistoryFile } from '#/utils/paths';
import { detectFdPath, ensureFdPath } from '#/utils/process/fd-detect';
import { quoteShellArg } from '#/utils/shell-quote';
import { fetchWebContent } from '#/utils/web/web-content';
import { ttui } from './utils/tui-i18n';
import { renderStatusBar } from './utils/status-bar';
import { renderActivityTicker } from './utils/activity-ticker';

import { BannerProvider } from './banner/banner-provider';
import { readBannerDisplayState, writeBannerDisplayState } from './banner/state';
import {
  BUILTIN_SLASH_COMMANDS,
  buildPluginSlashCommands,
  buildSkillSlashCommands,
  formatRendererDiagnosticsStatusReport,
  formatRendererTraceStatusReport,
  isExperimentalFlagEnabled,
  setExperimentalFeatures,
  slashCommandsForHelp,
  sortSlashCommands,
  thinkingArgumentCompletionsForModel,
  type LioraSlashCommand,
  type RendererDiagnosticsOverlayCommand,
  type RendererTraceCommand,
  type SlashCommandHelpMode,
  type SkillListSession,
} from './commands';
import * as slashCommands from './commands/dispatch';
import { BannerComponent } from './components/chrome/banner';
import { DeviceCodeBoxComponent } from './components/chrome/device-code-box';
import { MoonLoader, type SpinnerStyle } from './components/chrome/moon-loader';
import { IdleStageComponent } from './components/chrome/idle-stage';
import { SplashComponent, shouldPlaySplash } from './components/chrome/splash';
import { buildSplashMorphScene } from './utils/splash-reveal-preview';
import { WelcomeComponent } from './components/chrome/welcome';
import { pickRandomWorkingTip, tipText } from './components/chrome/working-tips';
import {
  ApprovalPanelComponent,
  type ApprovalPanelResponse,
} from './components/dialogs/approval-panel';
import {
  ApprovalPreviewViewer,
  type ApprovalPreviewBlock,
} from './components/dialogs/approval-preview';
import { CompactionComponent } from './components/dialogs/compaction';
import { CommandPaletteComponent, type PaletteEntry } from './components/dialogs/command-palette';
import { HistorySearchDialogComponent } from './components/dialogs/history-search-dialog';
import { TranscriptSearchDialogComponent } from './components/dialogs/transcript-search';
import {
  advancedHelpIntro,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from './components/dialogs/help-panel';
import { FileExplorerComponent } from './components/dialogs/file-explorer';
import { DiffReviewComponent } from './components/dialogs/diff-review';
import { CommitBrowserComponent } from './components/dialogs/commit-browser';
import { ErrorNavigatorComponent } from './components/dialogs/error-navigator';
import { FileViewerComponent } from './components/dialogs/file-viewer';
import { SearchResultsComponent } from './components/dialogs/search-results';
import { QuestionDialogComponent } from './components/dialogs/question-dialog';
import { SessionPickerComponent, type SessionRow } from './components/dialogs/session-picker';
import {
  FileMentionProvider,
  type SlashAutocompleteCommand,
} from './components/editor/file-mention-provider';

import { AssistantMessageComponent } from './components/messages/assistant-message';
import { BackgroundAgentStatusComponent } from './components/messages/background-agent-status';
import { BlamePanelComponent } from './components/dialogs/blame-panel';
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
import { DEFAULT_APPEARANCE_PREFERENCES, type TuiConfig } from './config';
import {
  LLM_NOT_SET_MESSAGE,
  MAIN_AGENT_ID,
  NO_ACTIVE_SESSION_MESSAGE,
  PRODUCT_NAME,
} from './constant/liora-tui';
import { MAX_TERMINAL_TITLE_LENGTH } from './constant/terminal';
import { AuthFlowController } from './controllers/auth-flow';
import { AppearanceController, shouldRenderAmbientAnimationFrame } from './controllers/appearance';
import { BtwPanelController } from './controllers/btw-panel';
import { ClipboardImageHintController } from './controllers/clipboard-image-hint';
import { EditorKeyboardController } from './controllers/editor-keyboard';
import { PromptIntelligenceController } from './controllers/prompt-intelligence';
import { SessionEventHandler } from './controllers/session-event-handler';
import { SessionReplayRenderer, type SessionReplayHost } from './controllers/session-replay';
import { StreamingUIController } from './controllers/streaming-ui';
import { TasksBrowserController } from './controllers/tasks-browser';
import { UsageMonitorController } from './controllers/usage-monitor';
import { setKittyGraphicsChannel } from './media/kitty-graphics-channel';
import { adaptPanelResponse } from './reverse-rpc/approval/adapter';
import { ApprovalController } from './reverse-rpc/approval/controller';
import { createApprovalRequestHandler } from './reverse-rpc/approval/handler';
import { registerReverseRPCHandlers } from './reverse-rpc/index';
import { QuestionController } from './reverse-rpc/question/controller';
import { createQuestionAskHandler } from './reverse-rpc/question/handler';
import { createContext7CredentialHandler } from './reverse-rpc/credential/handler';
import type { ApprovalPanelData, QuestionPanelData } from './reverse-rpc/types';
import { currentTheme, getColorPalette, getBuiltInPalette, isBuiltInTheme } from './theme';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
import {
  appearanceAnimationNow,
  resolveUltraworkBorderGlowHex,
} from './utils/appearance-effects';
import {
  createTUIStateNativeInputRouter,
  type TUIStateNativeInputRouter,
} from './utils/native-input-router';
import {
  createTUIStateNativeRenderCallback,
} from './utils/native-layout-frame';
import { WorkspaceController, PanelManager, WorkspaceLayoutPersistence, LayoutPresetManager } from './workspace';
import { FileExplorerPanel } from './workspace/panels/file-explorer-panel';
import { TerminalPanel } from './workspace/panels/terminal-panel';
import { GitDiffPanel } from './workspace/panels/git-diff-panel';
import { ArtifactViewerPanel } from './workspace/panels/artifact-viewer-panel';
import { SessionManagerPanel } from './workspace/panels/session-manager-panel';
import { ActivityTransparencyPanel, ActivityFeed } from './workspace/panels/activity-transparency-panel';
import { SideChatPanel } from './workspace/panels/side-chat-panel';
import { ImagePreviewPanel } from './workspace/panels/image-preview-panel';
import { WebBrowserPanel } from './workspace/panels/web-browser-panel';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type LioraTUIOptions,
  type LivePaneState,
  type LoginProgressSpinnerHandle,
  type QueuedMessage,
  type TranscriptEntry,
  type TUIStartupOptions,
  type TUIStartupState,
} from './types';
import { hasDispose, isExpandable } from './utils/component-capabilities';
import { isDeadTerminalError } from './utils/dead-terminal';
import { DisposableRegistry } from './utils/disposables';
import { formatErrorMessage } from './utils/event-payload';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
  requestTUIScrollRender,
} from './utils/frame-render';
import { createMotionBeatController, isMotionTheatreActive } from './utils/motion-beats';
import { pickForegroundTasks } from './utils/foreground-task';
import { collectTranscriptErrors } from './utils/transcript-errors';
import { ImageAttachmentStore, type ImageAttachment } from './utils/image-attachment-store';
import { extractMediaAttachments } from './utils/image-placeholder';
import { resolveImageProtocol } from './utils/image-protocol-detect';
import { hasPatchChanges } from './utils/object-patch';
import { PromptStash } from './utils/prompt-stash';
import { sessionRowsForPicker } from './utils/session-picker-rows';
import { combineStartupNotice, isOAuthLoginRequiredError } from './utils/startup';
import { installTerminalFocusTracking } from './utils/terminal-focus';
import { notifyUserAttentionOnce } from './utils/terminal-notification';
import { installKittyDndTracking } from './utils/kitty-dnd';
import { installTerminalThemeTracking } from './utils/terminal-theme';
import { detectTmuxKeyboardWarning } from './utils/tmux-keyboard';
import { getTranscriptComponentEntry, markTranscriptComponent } from './utils/transcript-component-metadata';
import { resolveTranscriptEntryLineOffset } from './utils/transcript-entry-layout';
import { resolveTranscriptHitTestContext } from './utils/transcript-hit-test';
import {
  TRANSCRIPT_EXPAND_TURNS,
  TRANSCRIPT_HYSTERESIS,
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
  TRANSCRIPT_WINDOW_ENABLED,
  groupTurns,
  turnsToTrim,
} from './utils/transcript-window';
import {
  jumpTranscriptViewportToLine,
  scrollTranscriptViewport as applyTranscriptViewportScroll,
  type TranscriptScrollAction,
} from './utils/transcript-viewport';
import { formatBashOutputForDisplay } from './utils/shell-output';
import { nextTranscriptId } from './utils/transcript-id';

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
}

type EffectiveActivityPaneMode = ActivityPaneMode | 'idle' | 'session';
type LoadingTipKind = 'moon' | 'composing';

function loadingTipKind(mode: EffectiveActivityPaneMode): LoadingTipKind | undefined {
  if (mode === 'waiting' || mode === 'tool') return 'moon';
  if (mode === 'composing') return 'composing';
  return undefined;
}

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

type MutableCreateSessionOptions = {
  -readonly [P in keyof CreateSessionOptions]: CreateSessionOptions[P];
};

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
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    activityTip: null,
    theme: input.tuiConfig.theme,
    disablePasteBurst: input.tuiConfig.disablePasteBurst,
    version: input.version,
    editorCommand: input.tuiConfig.editorCommand,
    notifications: input.tuiConfig.notifications,
    upgrade: input.tuiConfig.upgrade,
    appearance: input.tuiConfig.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
    availableModels: {},
    availableProviders: {},
    providerRouteStatus: null,
    sessionTitle: null,
    goal: null,
    mcpServersSummary: null,
    providerQuota: null,
    banner: undefined,
  };
}

interface SendMessageOptions {
  readonly displayText?: string;
  readonly parts?: readonly PromptPart[];
  readonly imageAttachmentIds?: readonly number[];
  readonly hasMedia?: boolean;
}

/** How long the one-shot "moved to background" footer hint stays visible. */
const DETACH_HINT_DISPLAY_MS = 4_000;

export class LioraTUI {
  readonly harness: LioraHarness;
  readonly options: LioraTUIOptions;
  session: Session | undefined;
  state: TUIState;
  /** Thin transition-beat queue shared by harness enter/exit moments. */
  readonly motionBeats = createMotionBeatController();
  private readonly approvalController = new ApprovalController();
  private readonly questionController = new QuestionController();
  private readonly reverseRpcDisposers: Array<() => void> = [];
  private skillCommands: readonly LioraSlashCommand[] = [];
  private pluginCommands: readonly LioraSlashCommand[] = [];
  readonly skillCommandMap = new Map<string, string>();
  readonly pluginCommandMap = new Map<string, string>();
  private readonly imageStore = new ImageAttachmentStore();
  private fdPath: string | null = detectFdPath();
  private fdDownloadStarted = false;
  sessionEventUnsubscribe: (() => void) | undefined;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages = false;
  aborted = false;
  private terminalFocusTrackingDispose: (() => void) | undefined;
  private terminalThemeTrackingDispose: (() => void) | undefined;
  private clipboardImageHintController: ClipboardImageHintController | undefined;
  private signalCleanupHandlers: Array<() => void> = [];
  private isShuttingDown = false;
  /** Central registry for timers, intervals, listeners, and watchers. */
  private readonly disposables = new DisposableRegistry();
  private eventLoopStarted = false;
  private startupNotice: string | undefined;
  /** Startup cinematic splash; disposed after play or on shutdown. */
  private splash: SplashComponent | undefined;
  /** UI children saved while the full-screen splash owns the tree. */
  private splashSavedChildren: (typeof this.state.ui.children)[number][] | undefined;
  /** While true, ambient schedule stays armed even if interaction gates pause it. */
  private splashForcesAmbient = false;
  private lastActivityMode: string | undefined;
  private currentLoadingTip:
    | { kind: LoadingTipKind; tip: string | undefined; tipKey?: string; pinned: boolean }
    | undefined = undefined;
  private lastHistoryContent: string | undefined;
  /** LIFO stash of prompt drafts saved via Ctrl-X while the editor has text. */
  private readonly promptStash = new PromptStash();
  // Live `!` shell output entries, keyed by commandId so concurrent commands
  // each update their own card and stale events are dropped. Mutated in place
  // as `shell.output` events arrive; removed when the command completes.
  // `taskId` (from `shell.started`) lets ctrl+b detach the exact task.
  private readonly shellOutputStreams = new Map<
    string,
    { entry: TranscriptEntry; component: ShellRunComponent; taskId?: string }
  >();
  readonly streamingUI: StreamingUIController;
  readonly authFlow: AuthFlowController;
  readonly appearanceController: AppearanceController;
  readonly btwPanelController: BtwPanelController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly sessionReplay: SessionReplayRenderer;
  readonly tasksBrowserController: TasksBrowserController;
  readonly usageMonitor: UsageMonitorController;
  readonly editorKeyboard: EditorKeyboardController;
  readonly promptIntelligence: PromptIntelligenceController;
  private nativeInputRouter: TUIStateNativeInputRouter | undefined;
  private nativeInputModalDispose: (() => void) | undefined;
  private nativeInputModalSequence = 0;
  private nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();
  private workspaceController: WorkspaceController | undefined;
  private workspaceLayoutPersistence: WorkspaceLayoutPersistence | undefined;
  private kittyDndTrackingDispose: (() => void) | undefined;
  private readonly sessionStartTime = Date.now();
  private readonly activityFeed = new ActivityFeed();

  /** Timer that auto-clears the one-shot "moved to background" footer hint. */
  private detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;

  /** Host-owned queue settle clock (survives QueuePane remounts). */
  private queueSettleSelectionIdentity: string | undefined;
  private queueSettleStartedAtMs: number | undefined;

  /** Last user-submitted text, for `/retry` (Ctrl-Y). */
  private lastUserInput: string | undefined;
  /** True when the most recent turn ended in an error; cleared on a clean turn. */
  private lastTurnFailed = false;

  // The currently-mounted approval panel, if any. Kept so the full-screen
  // preview viewer can restore focus to the exact same instance (and its
  // selection / feedback state) when it closes.
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
  // Deferred reverse-RPC payloads that arrived while a command-driven dialog
  // owned the editor area. Once the dialog closes (restoreEditor), the pending
  // approval/question is shown — preventing mid-flow clobbering (BUG-7).
  private deferredApproval: ApprovalPanelData | undefined;
  private deferredQuestion: QuestionPanelData | undefined;
  // Active full-screen approval preview. While set, the root UI's normal
  // children are stashed in `savedChildren`; closing restores them.
  private approvalPreview:
    | {
        component: ApprovalPreviewViewer;
        savedChildren: readonly Component[];
        panel: ApprovalPanelComponent;
      }
    | undefined;

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
    this.btwPanelController = new BtwPanelController(this);
    this.sessionEventHandler = new SessionEventHandler(this);
    this.sessionEventHandler.activityFeed = this.activityFeed;
    this.sessionReplay = new SessionReplayRenderer(this as unknown as SessionReplayHost);
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
    this.buildLayout();
  }

  // =========================================================================
  // Autocomplete & Skill Commands
  // =========================================================================

  private getSlashCommands(mode: SlashCommandHelpMode = 'primary'): readonly LioraSlashCommand[] {
    const builtins = sortSlashCommands(BUILTIN_SLASH_COMMANDS).filter((command) =>
      isExperimentalFlagEnabled(command.experimentalFlag),
    );
    const visibleBuiltins = slashCommandsForHelp(builtins, mode);
    return mode === 'diagnostics'
      ? visibleBuiltins
      : [...visibleBuiltins, ...this.skillCommands, ...this.pluginCommands];
  }

  private setupAutocomplete(): void {
    const primaryCommands = this.getSlashCommands('primary');
    const advancedCommands = this
      .getSlashCommands('advanced')
      .filter((cmd) => !this.skillCommands.includes(cmd) && !this.pluginCommands.includes(cmd));
    const slashCommands: SlashAutocompleteCommand[] = [
      ...primaryCommands,
      ...advancedCommands,
    ].map((cmd) => {
      const completer = cmd.name === 'thinking'
        ? (prefix: string) => thinkingArgumentCompletionsForModel(
            prefix,
            this.state.appState.availableModels[this.state.appState.model],
          )
        : cmd.completeArgs;
      return {
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
        visibility: cmd.visibility ?? 'primary',
        ...(cmd.argumentHint !== undefined ? { argumentHint: cmd.argumentHint } : {}),
        ...(completer !== undefined
          ? { getArgumentCompletions: (prefix: string) => completer(prefix) }
          : {}),
      };
    });
    const provider = new FileMentionProvider(
      slashCommands,
      this.state.appState.workDir,
      this.fdPath,
      this.state.appState.additionalDirs,
      (query, signal) => this.searchSkillSlashCommands(query, signal),
      () => this.state.appState.inputMode,
    );
    this.state.editor.setAutocompleteProvider(provider);

    const argumentHints = new Map<string, string>();
    for (const cmd of slashCommands) {
      if (cmd.argumentHint === undefined) continue;
      argumentHints.set(cmd.name, cmd.argumentHint);
      for (const alias of cmd.aliases ?? []) {
        argumentHints.set(alias, cmd.argumentHint);
      }
    }
    this.state.editor.setArgumentHints(argumentHints);
  }

  refreshSlashCommandAutocomplete(): void {
    this.setupAutocomplete();
  }

  async refreshSkillCommands(_session?: SkillListSession): Promise<void> {
    this.skillCommands = [];
    this.skillCommandMap.clear();
    this.setupAutocomplete();
  }

  private async refreshPluginCommands(session?: Session): Promise<void> {
    this.pluginCommands = [];
    this.pluginCommandMap.clear();
    if (session === undefined) {
      this.setupAutocomplete();
      return;
    }

    let defs;
    try {
      defs = await session.listPluginCommands();
    } catch {
      this.setupAutocomplete();
      return;
    }
    if (this.session !== session) return;

    const pluginCommands = buildPluginSlashCommands(defs);
    this.pluginCommands = pluginCommands.commands;
    for (const [commandName, body] of pluginCommands.commandMap) {
      this.pluginCommandMap.set(commandName, body);
    }
    this.setupAutocomplete();
  }

  private async refreshDynamicSlashCommands(session?: Session): Promise<void> {
    await this.refreshSkillCommands(session);
    await this.refreshPluginCommands(session);
  }

  private async searchSkillSlashCommands(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly LioraSlashCommand[]> {
    const session = this.session;
    if (session === undefined || signal.aborted) return [];
    const skillQuery = query.startsWith('skill:') ? query.slice('skill:'.length) : query;
    if (skillQuery.trim().length === 0) return [];
    let skills;
    try {
      skills = await session.searchSkills(skillQuery, { limit: 5 });
    } catch {
      return [];
    }
    if (signal.aborted) return [];
    const skillCommands = buildSkillSlashCommands(skills);
    for (const [commandName, skillName] of skillCommands.commandMap) {
      this.skillCommandMap.set(commandName, skillName);
    }
    return skillCommands.commands;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async start(): Promise<void> {
    // Signal handlers must be installed before raw mode to avoid EIO loops.
    this.registerSignalHandlers();
    // Outer try rolls back signal listeners on startup failure.
    try {
      const shouldReplayHistory = await this.initMainTui();
      this.startEventLoop();
      try {
        // Mount Welcome + IdleStage before the splash so the saved UI tree
        // (captured by playStartupSplash) already contains them. The morph
        // target scene and the first post-splash frame are then 1:1 identical.
        this.renderWelcome();
        // Cinematic splash after the renderer loop is live, before Welcome.
        await this.playStartupSplash();
        void this.loadBanner();
        this.startBackgroundFdAutocomplete();
        await this.finishStartup(shouldReplayHistory);
      } catch (error) {
        this.disposeStartupSplash();
        this.disposeTerminalTracking();
        this.state.renderer.stop();
        throw error;
      }
    } catch (error) {
      this.unregisterSignalHandlers();
      throw error;
    }
  }

  private async loadBanner(): Promise<void> {
    const provider = new BannerProvider(this.state.appState.version);
    const displayState = await readBannerDisplayState();
    const now = new Date();
    const banner = await provider.load(fetch, {
      state: displayState,
      now,
    });
    this.state.appState.banner = banner;
    if (banner === null) return;

    this.renderBanner();
    requestTUILayoutRender(this.state);

    if (banner.display === 'always') return;
    try {
      await writeBannerDisplayState({
        version: 1,
        shown: {
          ...displayState.shown,
          [banner.key]: { lastShownAt: now.toISOString() },
        },
      });
    } catch {
      // Best-effort: banner display state should never block startup.
    }
  }

  private renderBanner(): void {
    if (this.state.appState.banner === null || this.state.appState.banner === undefined) {
      return;
    }
    if (this.state.transcriptContainer.children.some((child) => child instanceof BannerComponent)) {
      return;
    }
    const welcomeIndex = this.state.transcriptContainer.children.findIndex(
      (child) => child instanceof WelcomeComponent,
    );
    const banner = new BannerComponent(this.state.appState.banner);
    if (welcomeIndex >= 0) {
      this.state.transcriptContainer.children.splice(welcomeIndex + 1, 0, banner);
    } else {
      this.state.transcriptContainer.children.unshift(banner);
    }
    this.state.transcriptContainer.invalidate();
  }

  private async initMainTui(): Promise<boolean> {
    const shouldReplayHistory = await this.init();

    // Mount only after init() succeeds; see mountFooter() / mountHeader().
    // Welcome is deferred until after the startup splash in start().
    this.mountFooter();
    this.mountHeader();
    this.setupAutocomplete();
    void this.loadPersistedInputHistory();
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.state.ui.setFocus(this.state.editor);
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();

    // First-run onboarding: when no model is configured and no provider exists
    // yet, surface the unified provider picker so the user can connect in one
    // step instead of having to discover /login on their own.
    void this.maybeStartOnboarding().catch(() => {
      // Onboarding is best-effort; a failure here must not block startup.
    });

    return shouldReplayHistory;
  }

  private async maybeStartOnboarding(): Promise<void> {
    const config = await this.harness.getConfig({ reload: true });
    const hasProvider =
      config.defaultModel !== undefined ||
      Object.keys(config.providers ?? {}).length > 0;
    if (hasProvider) return;

    // Auto-detect Qwen Token Plan: when the env key is set and no provider
    // exists yet, configure it silently so the user gets a working setup
    // without any interaction.
    const qwenKey = process.env['QWEN_TOKEN_PLAN_API_KEY']?.trim();
    if (qwenKey !== undefined && qwenKey.length > 0) {
      const { applyQwenTokenPlanProvider } = await import('#/tui/utils/qwen-token-plan');
      applyQwenTokenPlanProvider(config, qwenKey);
      await this.harness.setConfig({
        providers: config.providers,
        models: config.models,
        defaultModel: config.defaultModel,
        defaultThinking: config.defaultThinking,
      });
      await this.authFlow.refreshConfigAfterLogin();
      this.showStatus(
        'Qwen Cloud (Token Plan) auto-configured from QWEN_TOKEN_PLAN_API_KEY. ' +
        'Text, image, video generation, harness tools, and visual understanding enabled.',
        'success',
      );
      return;
    }

    // Route through the normal slash-command dispatch so /login's unified
    // provider picker opens on first run.
    slashCommands.dispatchInput(this, '/login');
  }

  private attachNativeRendererCallback(): void {
    if (!(this.state.ui instanceof LioraNativeRootUI)) return;
    if (this.nativeInputRouter !== undefined) {
      this.state.ui.setInputRouter(this.nativeInputRouter.router);
    }

    // Initialize workspace controller for multi-panel layout
    if (this.nativeInputRouter !== undefined && this.workspaceController === undefined) {
      const panelManager = new PanelManager();
      this.workspaceController = new WorkspaceController({
        panelManager,
        inputRouter: this.nativeInputRouter.router,
        requestRender: () => this.state.ui.requestRender(),
      });
      // Register default panels
      const cwd = this.state.appState.workDir ?? process.cwd();
      this.workspaceController.addPanel(new FileExplorerPanel(cwd), 'left');
      this.workspaceController.addPanel(new GitDiffPanel(cwd), 'left');
      this.workspaceController.addPanel(
        new SessionManagerPanel({
          listSessions: async () => {
            const sessions = await this.harness.listSessions({ workDir: cwd });
            return sessions.map((s) => ({
              id: s.id,
              title: s.title ?? null,
              lastPrompt: s.lastPrompt ?? null,
              workDir: s.workDir,
              updatedAt: s.updatedAt ?? s.createdAt ?? 0,
            }));
          },
          switchSession: async (id: string) => this.resumeSession(id),
          createSession: async () => {
            const session = await this.createSessionFromCurrentState();
            await this.switchToSession(session, 'New session created.');
            return true;
          },
          currentSessionId: () => this.state.appState.sessionId ?? '',
        }),
        'left',
      );
      this.workspaceController.addPanel(new TerminalPanel(cwd), 'right');
      this.workspaceController.addPanel(new ArtifactViewerPanel(cwd), 'right');
      this.workspaceController.addPanel(new ActivityTransparencyPanel(this.activityFeed), 'right');
      this.workspaceController.addPanel(
        new SideChatPanel({
          sendMessage: (text: string) => {
            const session = this.session;
            if (session === undefined) return false;
            this.sendMessage(session, text);
            return this.state.appState.streamingPhase === 'idle';
          },
          isBusy: () => this.state.appState.streamingPhase !== 'idle',
        }),
        'right',
      );
      this.workspaceController.addPanel(new ImagePreviewPanel(cwd), 'right');
      this.workspaceController.addPanel(new WebBrowserPanel(cwd), 'right');
      // Register keyboard shortcuts for panel management
      const wc = this.workspaceController;
      this.nativeInputRouter.router.registerGlobalHandler({
        id: 'workspace-keyboard-shortcuts',
        onInput: (event) => {
          // Overlays + panel-management shortcuts. Also installed as the
          // editor's pre-editor hook so they win while the editor is focused
          // (the router runs focused targets before global handlers).
          if (this.handleWorkspaceOverlaysAndShortcuts(event)) return true;
          // Route to the focused panel (only reachable when a panel, not the
          // editor, is the focused router target).
          if (wc.routeInputToPanel(event)) return true;
          return false;
        },
      });
      // Load persisted workspace layout (dock widths, visibility, panel order)
      this.workspaceLayoutPersistence = new WorkspaceLayoutPersistence(panelManager);
      this.workspaceLayoutPersistence.load();
      // Layout presets
      const presetManager = new LayoutPresetManager(panelManager);
      wc.setPresetManager(presetManager);
      // Kitty DnD: file drop support
      this.kittyDndTrackingDispose = installKittyDndTracking(this.state, (paths) => {
        this.handleFileDrop(paths);
      });
    }

    const diagnosticsOverlay = () => this.nativeRendererDiagnosticsHudEnabled;
    this.state.ui.setRenderCallback(
      createTUIStateNativeRenderCallback(this.state, {
        diagnosticsOverlay,
        onAuthoritativeFrame: () => {
          this.appearanceController.reapplyTerminalPalette();
        },
        workspaceDockWidths: () => {
          if (!this.workspaceController?.isEnabled()) return null;
          const pm = this.workspaceController.panelManager;
          const layoutOpts = pm.getLayoutOptions();
          if (!layoutOpts.leftDockVisible && !layoutOpts.rightDockVisible) return null;
          return {
            leftDockWidth: layoutOpts.leftDockVisible ? layoutOpts.leftDockWidth : 0,
            rightDockWidth: layoutOpts.rightDockVisible ? layoutOpts.rightDockWidth : 0,
          };
        },
        postFrameRender: ({ frameRenderer, columns, rows }) => {
          // Activity ticker at the top row — always-on Bloomberg-style live band,
          // rendered independently of workspace mode.
          const entries = this.activityFeed.getEntries();
          const latestEntry = entries.length > 0 ? entries[entries.length - 1] : undefined;
          const agentActive = this.state.appState.streamingPhase !== 'idle';
          const tickerLine = renderActivityTicker(latestEntry, agentActive, columns);
          frameRenderer.writeText(0, 0, tickerLine);

          // Workspace-only docks/overlays. The bottom status bar renders in every
          // path below so the live band stays visible even without workspace mode.
          if (!this.workspaceController?.isEnabled()) {
            this.renderBottomStatusBar(frameRenderer, columns, rows, undefined);
            return;
          }

          const layout = this.workspaceController.computeLayout({
            terminalColumns: columns,
            terminalRows: rows,
          });
          if (!layout) {
            this.renderBottomStatusBar(frameRenderer, columns, rows, undefined);
            return;
          }
          const docks = this.workspaceController.renderDocks(layout);
          // Draw left dock panels (or maximized panel)
          const maximizedId = this.workspaceController.getMaximizedPanelId();
          if (maximizedId !== null && docks.left) {
            // Maximized: render at full width from x=0
            for (let row = 0; row < docks.left.length; row++) {
              const line = docks.left[row] ?? '';
              if (line.length > 0) {
                frameRenderer.writeText(0, row, line);
              }
            }
          } else if (docks.left && layout.leftDock) {
            const { x, y } = layout.leftDock.rect;
            for (let row = 0; row < docks.left.length; row++) {
              const line = docks.left[row] ?? '';
              if (line.length > 0) {
                frameRenderer.writeText(x, y + row, line);
              }
            }
          }
          // Draw right dock panels
          if (docks.right && layout.rightDock) {
            const { x, y } = layout.rightDock.rect;
            for (let row = 0; row < docks.right.length; row++) {
              const line = docks.right[row] ?? '';
              if (line.length > 0) {
                frameRenderer.writeText(x, y + row, line);
              }
            }
          }
          // Draw panel switcher overlay (centered)
          const switcherLines = this.workspaceController.renderSwitcherOverlay();
          if (switcherLines) {
            const overlayWidth = 32;
            const overlayX = Math.max(0, Math.floor((columns - overlayWidth) / 2));
            const overlayY = Math.max(1, Math.floor((rows - switcherLines.length) / 2));
            for (let row = 0; row < switcherLines.length; row++) {
              frameRenderer.writeText(overlayX, overlayY + row, switcherLines[row] ?? '');
            }
          }
          // Draw keyboard help overlay (centered)
          const helpLines = this.workspaceController.renderHelpOverlay();
          if (helpLines) {
            const overlayWidth = 46;
            const overlayX = Math.max(0, Math.floor((columns - overlayWidth) / 2));
            const overlayY = Math.max(1, Math.floor((rows - helpLines.length) / 2));
            for (let row = 0; row < helpLines.length; row++) {
              frameRenderer.writeText(overlayX, overlayY + row, helpLines[row] ?? '');
            }
          }
          // Draw layout preset overlay (centered)
          const presetLines = this.workspaceController.renderPresetOverlay();
          if (presetLines) {
            const overlayWidth = 34;
            const overlayX = Math.max(0, Math.floor((columns - overlayWidth) / 2));
            const overlayY = Math.max(1, Math.floor((rows - presetLines.length) / 2));
            for (let row = 0; row < presetLines.length; row++) {
              frameRenderer.writeText(overlayX, overlayY + row, presetLines[row] ?? '');
            }
          }
          // Draw command palette overlay (centered)
          const paletteLines = this.workspaceController.renderPaletteOverlay();
          if (paletteLines) {
            const overlayWidth = 40;
            const overlayX = Math.max(0, Math.floor((columns - overlayWidth) / 2));
            const overlayY = Math.max(1, Math.floor((rows - paletteLines.length) / 2));
            for (let row = 0; row < paletteLines.length; row++) {
              frameRenderer.writeText(overlayX, overlayY + row, paletteLines[row] ?? '');
            }
          }
          // Draw session stats overlay (centered)
          if (this.workspaceController.isStatsOpen) {
            const actEntries = this.activityFeed.getEntries();
            const statsLines = this.workspaceController.renderStatsOverlay({
              sessionDurationMs: Date.now() - this.sessionStartTime,
              totalActivities: actEntries.length,
              toolCalls: actEntries.filter((e) => e.kind === 'tool-start').length,
              fileReads: actEntries.filter((e) => e.kind === 'file-read').length,
              fileWrites: actEntries.filter((e) => e.kind === 'file-write').length,
              commands: actEntries.filter((e) => e.kind === 'command').length,
              thinkingEvents: actEntries.filter((e) => e.kind === 'thinking').length,
              contextTokens: this.state.appState.contextTokens ?? 0,
              maxContextTokens: this.state.appState.maxContextTokens ?? 0,
            });
            if (statsLines) {
              const overlayWidth = 38;
              const overlayX = Math.max(0, Math.floor((columns - overlayWidth) / 2));
              const overlayY = Math.max(1, Math.floor((rows - statsLines.length) / 2));
              for (let row = 0; row < statsLines.length; row++) {
                frameRenderer.writeText(overlayX, overlayY + row, statsLines[row] ?? '');
              }
            }
          }
          // Draw search overlay (bottom-left)
          if (this.workspaceController.isSearchOpen) {
            const searchLines = this.workspaceController.renderSearchOverlay();
            if (searchLines) {
              const overlayY = rows - searchLines.length - 1;
              for (let row = 0; row < searchLines.length; row++) {
                frameRenderer.writeText(1, overlayY + row, searchLines[row] ?? '');
              }
            }
          }
          // Status bar at the bottom row (always-on live band)
          const pm = this.workspaceController.panelManager;
          const focusedId = pm.getFocusedPanelId();
          const focusedPanel = focusedId ? pm.getPanel(focusedId) : undefined;
          this.renderBottomStatusBar(frameRenderer, columns, rows, focusedPanel?.definition.title);
        },
      }),
    );
    // Occupy the full terminal viewport. The renderer is created with the
    // `fullscreen-app` feature profile (alternate screen + clearOnStart), so
    // the TUI owns the whole screen in its own buffer and the terminal's
    // pre-session scrollback never shows through. The `measureFrameHeight`
    // "grow with content" override is intentionally NOT set here — it would
    // cap the frame to the transcript's content height and leave the rest of
    // the alternate screen blank, which is the opposite of the forced
    // full-screen occupation we want. It remains available for tests via
    // createTUIStateNativeRenderer({ growWithContent: true }).
  }

  /**
   * Render the always-on Bloomberg-style status bar at the bottom row.
   * Called from every postFrameRender path so the live band stays visible
   * regardless of workspace mode.
   */
  private renderBottomStatusBar(
    frameRenderer: import('@harness-kit/tui-renderer').NativeFrameRenderer,
    columns: number,
    rows: number,
    activePanel: string | undefined,
  ): void {
    const phase = this.state.appState.streamingPhase;
    const agentStatus = phase === 'thinking' ? 'thinking' as const
      : phase === 'idle' ? 'idle' as const : 'working' as const;
    const statusLine = renderStatusBar({
      agentStatus,
      contextUsage: this.state.appState.contextUsage,
      activePanel,
      contextTokens: this.state.appState.contextTokens,
      maxContextTokens: this.state.appState.maxContextTokens,
      model: this.state.appState.model,
      sessionCostUsd: this.state.appState.sessionCostUsd,
    }, columns, process.cwd());
    frameRenderer.writeText(0, rows - 1, statusLine);
  }

  private startEventLoop(): void {
    this.state.renderer.start();
    // Kitty graphics escapes bypass the cell compositor; route them straight
    // to the terminal while the event loop owns it.
    setKittyGraphicsChannel((sequence) => {
      this.state.terminal.write(sequence);
    });
    this.eventLoopStarted = true;
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();
    this.startClipboardImageHintController();
    this.terminalFocusTrackingDispose = installTerminalFocusTracking(this.state);
    this.refreshTerminalThemeTracking();
  }

  setNativeRendererDiagnosticsOverlay(command: RendererDiagnosticsOverlayCommand): void {
    if (command === 'status') {
      const report = formatRendererDiagnosticsStatusReport({
        hudEnabled: this.nativeRendererDiagnosticsHudEnabled,
        nativeRendererEnabled: true,
        diagnostics: this.nativeRendererDiagnosticsSnapshot(),
      });
      this.showStatus(report.message, report.color);
      return;
    }
    if (command === 'reset') {
      this.track('native_renderer_diagnostics_reset');
      if (!this.resetNativeRendererDiagnostics()) {
        this.showStatus(
          'Native renderer diagnostics reset skipped: native renderer is not active.',
          'warning',
        );
        return;
      }
      this.showStatus('Native renderer diagnostics reset.');
      return;
    }

    const enabled = command === 'toggle'
      ? !this.nativeRendererDiagnosticsHudEnabled
      : command === 'on';
    this.nativeRendererDiagnosticsHudEnabled = enabled;
    this.track('native_renderer_diagnostics_hud', { enabled, command });

    requestTUILayoutRender(this.state);
    this.showStatus(`Native renderer diagnostics HUD: ${enabled ? 'ON' : 'OFF'}.`);
  }

  private nativeRendererDiagnosticsSnapshot() {
    return this.state.renderer.nativeRuntime?.diagnostics;
  }

  private resetNativeRendererDiagnostics(): boolean {
    const renderer = this.state.renderer.nativeRuntime;
    if (renderer === undefined) return false;
    renderer.resetStats();
    requestTUILayoutRender(this.state);
    return true;
  }

  setNativeRendererTrace(command: RendererTraceCommand): void {
    if (command.action === 'status') {
      const report = formatRendererTraceStatusReport({
        nativeRendererEnabled: true,
        trace: this.nativeRendererTraceSnapshot(),
      });
      this.showStatus(report.message, report.color);
      return;
    }

    if (command.action === 'reset') {
      this.track('native_renderer_trace_reset');
      if (!this.resetNativeRendererTrace()) {
        this.showStatus('Native renderer trace reset skipped: native renderer is not active.', 'warning');
        return;
      }
      this.showStatus('Native renderer trace reset.');
      return;
    }

    if (command.action === 'export') {
      const outputPath = this.exportNativeRendererTrace(command.path);
      if (outputPath === undefined) {
        this.showStatus('Native renderer trace export skipped: native renderer is not active.', 'warning');
        return;
      }
      this.track('native_renderer_trace_export');
      this.showStatus(`Native renderer trace exported: ${outputPath}`);
    }
  }

  private nativeRendererTraceSnapshot() {
    return this.nativeRendererTraceRuntime()?.traceSnapshot;
  }

  private resetNativeRendererTrace(): boolean {
    const renderer = this.nativeRendererTraceRuntime();
    if (renderer === undefined) return false;
    renderer.resetTrace();
    requestTUILayoutRender(this.state);
    return true;
  }

  private exportNativeRendererTrace(path: string | undefined): string | undefined {
    const renderer = this.nativeRendererTraceRuntime();
    if (renderer === undefined) return undefined;
    const workDir = this.state.appState.workDir;
    const outputPath = path === undefined
      ? join(workDir, `renderer-trace-${String(Date.now())}.json`)
      : resolve(workDir, path);
    const rel = relative(workDir, outputPath);
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
      this.showStatus('Trace export path must be inside the workspace.', 'error');
      return undefined;
    }
    writeFileSync(
      outputPath,
      `${JSON.stringify(renderer.exportTrace({ processName: 'SuperLiora TUI' }), null, 2)}\n`,
    );
    return outputPath;
  }

  private nativeRendererTraceRuntime() {
    return this.state.renderer.nativeRuntime;
  }

  private ensureNativeInputRouter(): void {
    this.nativeInputRouter ??= createTUIStateNativeInputRouter(this.state, {
      scrollTranscriptViewport: (action) => this.scrollTranscriptViewport(action),
      handlePreEditorInput: (event) => this.handleWorkspaceOverlaysAndShortcuts(event),
    });
  }

  /**
   * Workspace overlays (stats/search/palette/preset/help/switcher) and
   * panel-management shortcuts (F1/F2/F3, Ctrl+B/N, Ctrl+1-9, Tab cycle).
   * Runs both as the editor's pre-editor hook (so it wins while the editor is
   * focused) and from the global input handler (for panel-focused states).
   * Deliberately excludes routeInputToPanel, which must not steal typing from
   * the editor.
   */
  private handleWorkspaceOverlaysAndShortcuts(event: NativeInputEvent): boolean {
    const wc = this.workspaceController;
    if (wc === undefined) return false;
    if (wc.handleStatsInput(event)) return true;
    if (wc.handleSearchInput(event)) return true;
    if (wc.handlePaletteInput(event)) return true;
    if (wc.handlePresetInput(event)) return true;
    if (wc.handleHelpInput(event)) return true;
    if (wc.handleSwitcherInput(event)) return true;
    if (wc.handlePanelShortcut(event)) {
      this.workspaceLayoutPersistence?.scheduleSave();
      return true;
    }
    if (wc.handleTabCycle(event)) return true;
    return false;
  }

  private stopNativeRendererAdapters(): void {
    this.nativeInputModalDispose?.();
    this.nativeInputModalDispose = undefined;
    this.nativeInputRouter?.dispose();
    this.nativeInputRouter = undefined;
  }

  private startClipboardImageHintController(): void {
    this.clipboardImageHintController = new ClipboardImageHintController({
      ui: this.state.ui,
      footer: this.state.footer,
      getModelSupportsImage: () => this.supportsCurrentModelCapability('image_in'),
      requestRender: () => {
        requestTUIContentRender(this.state);
      },
    });
    this.clipboardImageHintController.start();
  }

  private startBackgroundFdAutocomplete(): void {
    if (this.fdPath !== null || this.fdDownloadStarted) return;
    this.fdDownloadStarted = true;

    void ensureFdPath()
      .then((fdPath) => {
        if (fdPath === null) return;
        this.fdPath = fdPath;
        this.setupAutocomplete();
      })
      .catch(() => {
        // Best-effort background bootstrap: autocomplete keeps using the filesystem fallback.
      });
  }

  private async refreshProviderModelsInBackground(): Promise<void> {
    try {
      const result = await this.authFlow.refreshProviderModels();
      for (const c of result.changed) {
        if (c.added <= 0) continue;
        this.showStatus(`${c.providerName} · +${String(c.added)} model${c.added > 1 ? 's' : ''}.`);
      }
      for (const f of result.failed) {
        this.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
      }
    } catch {
      // Best-effort: startup must not crash on background refresh failures.
    }
  }

  private async finishStartup(shouldReplayHistory: boolean): Promise<void> {
    if (this.startupNotice !== undefined) {
      this.showStatus(this.startupNotice);
      this.startupNotice = undefined;
    }
    void this.showTmuxKeyboardWarningIfNeeded();
    if (this.state.startupState === 'picker') {
      void this.bootstrapFromPicker();
      return;
    }
    if (shouldReplayHistory) {
      await this.sessionReplay.hydrateFromReplay(this.requireSession());
      this.applyStartupPermissionAndPlanToAppState();
    }
    const resumeState = this.session?.getResumeState();
    if (resumeState?.warning !== undefined) {
      this.showStatus(`Warning: ${resumeState.warning}`, 'warning');
    }
    if (this.session !== undefined) {
      this.sessionEventHandler.startSubscription();
      void this.showSessionWarnings(this.session);
    }
    void this.fetchSessions();
    if (this.session !== undefined) {
      this.updateTerminalTitle();
    }
    void this.refreshDynamicSlashCommands(this.session);
    this.usageMonitor.start();
    // Goal-driven boot protocol: automatically resume the first goal in the queue
    if (this.options.startup.resumeGoal === true) {
      void this.resumeGoalFromQueue();
    }
  }

  /**
   * Goal-driven boot protocol: automatically resume the first goal in the queue.
   * This is triggered by the --resume-goal CLI option.
   */
  private async resumeGoalFromQueue(): Promise<void> {
    const session = this.session;
    if (session === undefined) return;

    try {
      const { readGoalQueue, removeGoalQueueItem } = await import('./goal-queue-store');
      const queue = await readGoalQueue(session);
      const firstGoal = queue.goals[0];
      if (firstGoal === undefined) {
        this.showStatus('No goals in queue to resume.', 'info');
        return;
      }

      // Remove the goal from the queue before starting it
      await removeGoalQueueItem(session, { goalId: firstGoal.id });

      // Start the goal using the goal command handler
      this.showStatus(`🎯 Resuming goal: ${firstGoal.objective.slice(0, 100)}...`, 'info');

      // Send the goal objective as a user input to start the goal
      this.sendNormalUserInput(`/goal ${firstGoal.objective}`, {
        displayText: `🎯 ${firstGoal.objective.slice(0, 50)}...`,
      });
    } catch (error) {
      this.showStatus(`Failed to resume goal from queue: ${error}`, 'error');
    }
  }

  private async showSessionWarnings(session: Session): Promise<void> {
    try {
      const warnings = await session.getSessionWarnings();
      if (this.session !== session) return;
      for (const warning of warnings) {
        const severity = warning.severity === 'error' ? 'error' : 'warning';
        this.showStatus(`Warning: ${warning.message}`, severity);
      }
    } catch {
      // Best-effort: startup must not block on warning retrieval.
    }
  }

  private async showTmuxKeyboardWarningIfNeeded(): Promise<void> {
    try {
      const warning = await detectTmuxKeyboardWarning();
      if (warning === undefined || this.aborted) return;
      this.showStatus(warning, 'warning');
    } catch {
      // Best-effort: startup must not block on warning retrieval.
    }
  }

  private async init(): Promise<boolean> {
    setExperimentalFeatures(await this.harness.getExperimentalFeatures(), true);
    await this.authFlow.refreshAvailableModels();
    void this.refreshProviderModelsInBackground();

    const { startup } = this.options;
    const { workDir } = this.state.appState;
    let session: Session | undefined;
    let shouldReplayHistory = false;
    const isResumeStartup = startup.sessionFlag !== undefined || startup.continueLast;
    const createSessionOptions: MutableCreateSessionOptions = {
      workDir,
      model: startup.model,
      permission: startup.auto
        ? 'auto'
        : startup.yolo
          ? 'yolo'
          : this.state.appState.permissionMode,
      planMode: startup.plan,
    };
    if (this.state.appState.additionalDirs.length > 0) {
      createSessionOptions.additionalDirs = [...this.state.appState.additionalDirs];
    }

    try {
      if (isResumeStartup) {
        if (startup.sessionFlag === '') {
          this.state.startupState = 'picker';
          return false;
        }

        if (startup.sessionFlag !== undefined) {
          const sessions = await this.harness.listSessions({
            sessionId: startup.sessionFlag,
            workDir,
          });
          const target = sessions[0];
          if (target === undefined) {
            throw new Error(`Session "${startup.sessionFlag}" not found.`);
          }
          if (resolve(target.workDir) !== resolve(workDir)) {
            this.state.renderer.stop();
            process.stderr.write(
              `${currentTheme.fg(
                'warning',
                `Session "${startup.sessionFlag}" was created under a different directory.\n` +
                  `  cd "${target.workDir}" && liora -r ${startup.sessionFlag}`,
              )}\n\n`,
            );
            throw new Error(
              `Session "${startup.sessionFlag}" was created under a different directory.`,
            );
          }
          session = await this.harness.resumeSession({
            id: startup.sessionFlag,
            additionalDirs: createSessionOptions.additionalDirs,
          });
          shouldReplayHistory = true;
        } else {
          const sessions = await this.harness.listSessions({ workDir });
          const target = sessions[0];
          if (target !== undefined) {
            session = await this.harness.resumeSession({
              id: target.id,
              additionalDirs: createSessionOptions.additionalDirs,
            });
            shouldReplayHistory = true;
          } else {
            session = await this.harness.createSession(createSessionOptions);
            this.startupNotice = combineStartupNotice(
              this.startupNotice,
              `No sessions to continue under "${workDir}"; starting a fresh session.`,
            );
          }
        }
      } else {
        session = await this.harness.createSession(createSessionOptions);
      }
      if (session !== undefined && shouldReplayHistory) {
        await this.applyStartupModesToResumedSession(session);
        if (startup.model !== undefined) {
          await session.setModel(startup.model);
        }
      }
    } catch (error) {
      if (!isOAuthLoginRequiredError(error)) throw error;
      this.authFlow.enterLoginRequiredStartupState();
      return false;
    }

    if (session === undefined) {
      throw new Error('Startup session was not initialized.');
    }
    await this.setSession(session);
    await this.syncRuntimeState(session);
    await this.refreshDynamicSlashCommands(session);
    this.applyStartupPermissionAndPlanToAppState();
    this.state.startupState = 'ready';
    return shouldReplayHistory;
  }

  async stop(exitCode?: number): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    this.aborted = true;
    this.streamingUI.discardPending();
    this.editorKeyboard.clearPendingExit();
    // BUG-5: clear the detach-hint timer so it does not fire into a stopped
    // renderer after exit.
    if (this.detachHintClearTimer !== undefined) {
      clearTimeout(this.detachHintClearTimer);
      this.detachHintClearTimer = undefined;
    }
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
    this.reverseRpcDisposers.length = 0;
    this.disposeTerminalTracking();
    this.disposeStartupSplash();
    this.appearanceController.dispose();
    // Persist workspace layout before shutdown
    this.workspaceLayoutPersistence?.saveNow();
    this.workspaceLayoutPersistence?.dispose();
    this.kittyDndTrackingDispose?.();
    this.kittyDndTrackingDispose = undefined;
    // BUG-2: dispose the footer's goal-timer interval and the header clock.
    this.state.footer.dispose();
    this.state.header.dispose();
    await this.closeSession('shutting down');
    await this.harness.close();
    // BUG-3: clear any queued goal-promotion timer (and MCP spinners).
    this.sessionEventHandler.resetRuntimeState();
    // BUG-4: close the tasks browser so its 1s poll timer does not keep
    // firing into a closed session.
    this.tasksBrowserController.close();
    this.usageMonitor.dispose();
    this.promptIntelligence.dispose();
    // Central teardown: any resource registered with the disposable registry
    // (timers, intervals, listeners, watchers) is cleaned up here.
    this.disposables.disposeAll();
    await this.state.renderer.drainInput();
    this.state.ui.stop();
    if (this.onExit) {
      await this.onExit(exitCode);
    }
  }

  // SIGHUP / dead-terminal EIO → emergencyTerminalExit (no cleanup, avoids
  // EIO write-loop that can pin a CPU core). SIGTERM → normal stop().
  private registerSignalHandlers(): void {
    this.unregisterSignalHandlers();

    // Register a synchronous exit handler so the terminal is always restored —
    // normal stop(), SIGHUP emergency exit, and even a mid-stop throw all run
    // this. The restore sequences are written best-effort (EIO on a dead pty
    // is swallowed) so this never throws at process exit.
    const exitHandler = (): void => {
      try {
        NativeTerminalSession.writeRestoreSequencesSync(process.stdout);
      } catch {
        // Swallow — must never throw at process exit.
      }
    };
    process.on('exit', exitHandler);
    this.signalCleanupHandlers.push(() => {
      process.off('exit', exitHandler);
    });

    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    if (process.platform !== 'win32') {
      signals.push('SIGHUP');
    }

    for (const signal of signals) {
      const handler = (): void => {
        if (signal === 'SIGHUP') {
          // Best-effort synchronous flush before the emergency exit — a dead
          // terminal can EIO-loop and pin a CPU, so we cannot run async
          // cleanup, but we can still drain pending records to disk so the
          // in-flight work survives the abrupt exit.
          this.harness.emergencyFlushSync();
          this.emergencyTerminalExit();
          return;
        }
        // Registering a SIGTERM/SIGINT listener disables Node's default
        // exit(128+signum), so we must reinstate it after stop() or on
        // failure. Both take the graceful async path that flushes records
        // and Ultrawork checkpoints via Session.close().
        const code = 128 + (signal === 'SIGINT' ? 2 : 15);
        this.stop(code).then(
          () => {
            process.exit(code);
          },
          () => {
            this.emergencyTerminalExit(code);
          },
        );
      };
      process.prependListener(signal, handler);
      this.signalCleanupHandlers.push(() => {
        process.off(signal, handler);
      });
    }

    const terminalErrorHandler = (error: Error): void => {
      if (isDeadTerminalError(error)) {
        this.emergencyTerminalExit();
      }
    };
    process.stdout.on('error', terminalErrorHandler);
    process.stderr.on('error', terminalErrorHandler);
    this.signalCleanupHandlers.push(() => {
      process.stdout.off('error', terminalErrorHandler);
    });
    this.signalCleanupHandlers.push(() => {
      process.stderr.off('error', terminalErrorHandler);
    });
  }

  private unregisterSignalHandlers(): void {
    const handlers = this.signalCleanupHandlers;
    this.signalCleanupHandlers = [];
    for (const cleanup of handlers) cleanup();
  }

  // Exit codes follow POSIX 128+signum: 129 = SIGHUP, 143 = SIGTERM.
  private emergencyTerminalExit(exitCode = 129): never {
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    // Last-resort synchronous flush so any state still pending after the
    // graceful stop attempt (or a failed one) is not lost to the abrupt exit.
    try {
      this.harness.emergencyFlushSync();
    } catch {
      // Swallow — we are exiting regardless.
    }
    process.exit(exitCode);
  }

  private disposeTerminalTracking(): void {
    this.stopNativeRendererAdapters();
    setKittyGraphicsChannel(undefined);
    this.eventLoopStarted = false;
    this.stopTerminalThemeTracking();
    this.clipboardImageHintController?.stop();
    this.clipboardImageHintController = undefined;
    this.terminalFocusTrackingDispose?.();
    this.terminalFocusTrackingDispose = undefined;
  }

  private buildLayout(): void {
    const { ui } = this.state;
    ui.clear();
    ui.addChild(this.state.transcriptContainer);
    ui.addChild(this.state.activityContainer);
    ui.addChild(this.state.todoPanelContainer);
    ui.addChild(this.state.queueContainer);
    ui.addChild(this.state.btwPanelContainer);
    ui.addChild(this.state.editorContainer);
    // Footer is mounted later (mountFooter), not here.
  }

  private shouldRenderAmbientAnimationFrame(): boolean {
    const selection = this.state.transcriptSelection;
    return shouldRenderAmbientAnimationFrame(
      this.state.transcriptViewport.followOutput,
      this.state.terminal.rows,
      selection.isDragging || selection.hasSelection,
    );
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    const changed = applyTranscriptViewportScroll(this.state.transcriptViewport, action);
    if (changed) requestTUIScrollRender(this.state);
    return changed;
  }

  // Footer is the only chrome with content before a session is ready, so
  // mounting it at construction lets a stray pre-start render leak it to the
  // terminal — e.g. above the error when resuming a missing session. Mount the
  // prepared footer container only once init() succeeds.
  private mountFooter(): void {
    if (!this.state.footerContainer.children.includes(this.state.footer)) {
      this.state.footerContainer.addChild(this.state.footer);
    }
    if (!this.state.ui.children.includes(this.state.footerContainer)) {
      this.state.ui.addChild(this.state.footerContainer);
    }
  }

  // Header mirrors footer: mount after init() so its model label does not leak
  // before the session is ready.
  private mountHeader(): void {
    if (!this.state.headerContainer.children.includes(this.state.header)) {
      this.state.headerContainer.addChild(this.state.header);
    }
    if (!this.state.ui.children.includes(this.state.headerContainer)) {
      this.state.ui.addChild(this.state.headerContainer);
    }
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
    const wasBashMode = this.state.appState.inputMode === 'bash';
    if (wasBashMode) {
      // A submit always exits bash mode (the `!` is consumed by this command).
      this.state.editor.inputMode = 'prompt';
      this.handleInputModeChange('prompt');
    }
    if (text.trim().length === 0) return;
    if (this.state.appState.isReplaying) {
      this.showError('Cannot send input while session history is replaying.');
      return;
    }
    // Shell commands are stored with a leading `!` so ↑ recall can tell them
    // apart from prompts and restore bash mode. The `!` is stripped again when
    // the entry is recalled.
    const historyText = wasBashMode ? `!${text}` : text;
    void this.persistInputHistory(historyText);
    if (wasBashMode) {
      // Only one foreground action at a time: queue the shell command while
      // another shell command is running or an agent turn is in progress.
      if (this.state.appState.streamingPhase !== 'idle') {
        this.enqueueMessage(text, undefined, 'bash');
        this.updateQueueDisplay();
        requestTUILayoutRender(this.state);
        return;
      }
      this.runShellCommandFromInput(text);
      return;
    }
    slashCommands.dispatchInput(this, text);
  }

  private runShellCommandFromInput(command: string): void {
    const session = this.session;
    if (session === undefined) {
      this.showError('No active session for shell command.');
      return;
    }
    // Echo the command locally (bash-input) with a `$` prompt. The agent also
    // records it for resume; this is the live view.
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'user',
      turnId: undefined,
      renderMode: 'plain',
      content: currentTheme.fg('shellMode', `$ ${command}`),
      bullet: '',
      timestamp: Date.now(),
    });
    // Create the live output entry up front. ShellRunComponent owns its own
    // rendering (running card → final view) and is mutated in place as output
    // streams in and on completion.
    const commandId = nextTranscriptId();
    const outputEntry: TranscriptEntry = {
      id: commandId,
      kind: 'status',
      turnId: undefined,
      renderMode: 'plain',
      content: '',
    };
    const outputComponent = new ShellRunComponent(() => {
      requestTUIContentRender(this.state);
    });
    this.shellOutputStreams.set(commandId, { entry: outputEntry, component: outputComponent });
    this.state.transcriptEntries.push(outputEntry);
    markTranscriptComponent(outputComponent, outputEntry);
    this.state.transcriptContainer.addChild(outputComponent);
    // Treat command execution as a streaming phase so input queues, the activity
    // pane shows the moon spinner, and ctrl+b is enabled while it runs.
    this.setAppState({ streamingPhase: 'shell' });
    requestTUIContentRender(this.state);

    void session.runShellCommand(command, { commandId }).then(
      ({ stdout, stderr, isError, backgrounded }) => {
        this.finishShellOutput(commandId, stdout, stderr, isError, backgrounded);
      },
      (error: unknown) => {
        const message = formatErrorMessage(error);
        this.finishShellOutput(commandId, '', message, true);
        this.showError(`Shell command failed: ${message}`);
      },
    );
  }

  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void {
    const stream = this.shellOutputStreams.get(event.commandId);
    if (stream === undefined) return;
    const text = event.update.text ?? '';
    if (text.length === 0) return;
    stream.component.append(text);
  }

  handleShellStarted(event: { commandId: string; taskId: string }): void {
    const stream = this.shellOutputStreams.get(event.commandId);
    if (stream === undefined) return;
    stream.taskId = event.taskId;
  }

  cancelRunningShellCommand(): void {
    const session = this.session;
    if (session === undefined) return;
    for (const commandId of this.shellOutputStreams.keys()) {
      void session.cancelShellCommand(commandId).catch((error: unknown) => {
        this.showError(`Failed to cancel shell command: ${formatErrorMessage(error)}`);
      });
    }
  }

  private finishShellOutput(
    commandId: string,
    stdout: string,
    stderr: string,
    isError?: boolean,
    backgrounded?: boolean,
  ): void {
    const stream = this.shellOutputStreams.get(commandId);
    if (stream === undefined) return;
    if (backgrounded === true) {
      // The command was moved to the background; detachRunningShellCommand owns
      // the UI and the model notification, so there is nothing to render here.
      return;
    }
    stream.component.finish(stdout, stderr, isError);
    // Keep the transcript entry's metadata in sync for anything that reads it
    // (export / copy). The component renders itself.
    stream.entry.content = formatBashOutputForDisplay(stdout, stderr, isError);
    this.shellOutputStreams.delete(commandId);
    // When the last shell command finishes, leave the shell streaming phase,
    // release one queued message (if any), and refresh the activity pane.
    if (this.shellOutputStreams.size === 0) {
      this.setAppState({ streamingPhase: 'idle' });
      this.drainOneQueuedMessage();
    }
  }

  private drainOneQueuedMessage(): void {
    const item = this.shiftQueuedMessage();
    if (item === undefined) return;
    const session = this.session;
    if (session === undefined) return;
    if (item.mode === 'bash') {
      this.runShellCommandFromInput(item.text);
    } else {
      this.sendQueuedMessage(session, item);
    }
    this.updateQueueDisplay();
  }

  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void {
    if (this.btwPanelController.sendUserInput(text)) return;
    if (this.state.appState.model.trim().length === 0) {
      this.showError(LLM_NOT_SET_MESSAGE);
      return;
    }
    const extraction = extractMediaAttachments(text, this.imageStore);
    if (!this.validateMediaCapabilities(extraction)) return;
    const session = this.session;
    if (session === undefined) {
      this.showError(LLM_NOT_SET_MESSAGE);
      return;
    }
    if (extraction.hasMedia) {
      this.sendMessage(session, text, {
        displayText: options?.displayText,
        hasMedia: true,
        parts: extraction.parts,
        imageAttachmentIds: extraction.imageAttachmentIds,
      });
    } else {
      this.sendMessage(session, text, { displayText: options?.displayText });
    }
    this.updateQueueDisplay();
    requestTUIContentRender(this.state);
  }

  private validateMediaCapabilities(
    extraction: ReturnType<typeof extractMediaAttachments>,
  ): boolean {
    if (!extraction.hasMedia) return true;
    if (
      extraction.imageAttachmentIds.length > 0 &&
      !this.supportsCurrentModelCapability('image_in')
    ) {
      this.showError('Current model does not support image input.');
      return false;
    }
    if (
      extraction.videoAttachmentIds.length > 0 &&
      !this.supportsCurrentModelCapability('video_in')
    ) {
      this.showError('Current model does not support video input.');
      return false;
    }
    return true;
  }

  private supportsCurrentModelCapability(capability: string): boolean {
    const capabilities =
      this.state.appState.availableModels[this.state.appState.model]?.capabilities;
    if (capabilities === undefined) return true;
    return capabilities.includes(capability);
  }

  private async loadPersistedInputHistory(): Promise<void> {
    try {
      const file = getInputHistoryFile(this.state.appState.workDir);
      const entries = await loadInputHistory(file);
      const workdirContents = new Set(entries.map((entry) => entry.content));

      // Load global (cross-workdir) history as a fallback. Entries not already
      // present in the workdir-specific file are added first (older / less
      // relevant), so the workdir entries remain the most recent when the user
      // navigates backwards with ↑.
      try {
        const globalEntries = await loadGlobalInputHistory(getGlobalInputHistoryFile());
        for (const entry of globalEntries) {
          if (!workdirContents.has(entry.content)) {
            this.state.editor.addToHistory(entry.content);
          }
        }
      } catch {
        // Global history is best-effort.
      }

      for (const entry of entries) {
        this.state.editor.addToHistory(entry.content);
      }
      this.lastHistoryContent = entries.at(-1)?.content;
    } catch (error) {
      console.warn('Failed to load input history:', error);
    }
  }

  private async persistInputHistory(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed === this.lastHistoryContent) return;
    this.state.editor.addToHistory(trimmed);
    try {
      const file = getInputHistoryFile(this.state.appState.workDir);
      const written = await appendInputHistory(file, trimmed, this.lastHistoryContent);
      if (written) this.lastHistoryContent = trimmed;
    } catch (error) {
      console.warn('Failed to persist input history:', error);
      this.lastHistoryContent = trimmed;
    }
    // Also persist to the global (cross-workdir) history. Best-effort; the load
    // path dedupes, so we append unconditionally here.
    try {
      await appendGlobalInputHistory(getGlobalInputHistoryFile(), trimmed);
    } catch {
      // Global history is best-effort.
    }
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

  private enqueueMessage(
    text: string,
    options?: SendMessageOptions,
    mode?: 'prompt' | 'bash',
  ): void {
    this.state.queuedMessages.push({
      text,
      displayText: options?.displayText,
      agentId: this.harness.interactiveAgentId,
      parts: options?.parts,
      imageAttachmentIds:
        options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
          ? options.imageAttachmentIds
          : undefined,
      mode,
    });
    this.track('input_queue');
  }

  beginSessionRequest(): void {
    this.streamingUI.setTurnId(undefined);
    this.streamingUI.resetLiveText();
    this.streamingUI.resetToolUi();
    this.streamingUI.resetToolCallState();

    this.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  failSessionRequest(message: string): void {
    this.setAppState({ streamingPhase: 'idle' });
    this.resetLivePane();
    this.showError(message);
  }

  sendQueuedMessage(session: Session, item: QueuedMessage): void {
    if (item.mode === 'bash') {
      this.runShellCommandFromInput(item.text);
      return;
    }
    this.harness.withInteractiveAgent(item.agentId ?? MAIN_AGENT_ID, () => {
      this.sendMessageInternal(session, item.text, {
        displayText: item.displayText,
        parts: item.parts,
        imageAttachmentIds: item.imageAttachmentIds,
      });
    });
  }

  requestQueuedGoalPromotion(): void {
    this.sessionEventHandler.requestQueuedGoalPromotion();
  }

  private sendMessageInternal(session: Session, input: string, options?: SendMessageOptions): void {
    const imageAttachmentIds =
      options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
        ? options.imageAttachmentIds
        : undefined;
    const displayInput = options?.displayText ?? input;
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'user',
      turnId: undefined,
      renderMode: 'plain',
      content: displayInput,
      imageAttachmentIds,
      timestamp: Date.now(),
    });

    // Track the last user input for `/retry` (Ctrl-Y).
    if (options?.displayText === undefined) this.lastUserInput = input;

    this.beginSessionRequest();

    const sdkInput = options?.parts ?? input;
    void session.prompt(sdkInput).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.failSessionRequest(`Failed to send: ${message}`);
    });
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    this.beginSessionRequest();
    void session.activateSkill(skillName, skillArgs).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.failSessionRequest(`Skill "${skillName}" failed: ${message}`);
    });
  }

  activatePluginCommand(
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ): void {
    this.beginSessionRequest();
    void session.activatePluginCommand(pluginId, commandName, args).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.failSessionRequest(`Command "${pluginId}:${commandName}" failed: ${message}`);
    });
  }

  private sendMessage(session: Session, input: string, options?: SendMessageOptions): void {
    if (
      this.deferUserMessages ||
      this.state.appState.streamingPhase !== 'idle' ||
      this.state.appState.isCompacting
    ) {
      this.enqueueMessage(input, options);
      return;
    }
    this.sendMessageInternal(session, input, options);
  }

  steerMessage(session: Session, input: string[]): void {
    if (this.deferUserMessages || this.state.appState.isCompacting) {
      for (const part of input) {
        this.enqueueMessage(part);
      }
      return;
    }
    if (this.state.appState.streamingPhase === 'idle') {
      for (const part of input) {
        this.sendMessageInternal(session, part);
      }
      return;
    }

    for (const part of input) {
      this.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'user',
        turnId: this.streamingUI.getTurnContext().turnId,
        renderMode: 'plain',
        content: part,
        timestamp: Date.now(),
      });
    }

    void session.steer(input.join('\n\n')).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.showError(`Failed to steer: ${message}`);
    });
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
    if (!hasPatchChanges(this.state.appState, patch)) return;
    const additionalDirsChanged =
      'additionalDirs' in patch &&
      !sameStringArrays(this.state.appState.additionalDirs, patch.additionalDirs ?? []);
    const busyChanged = 'streamingPhase' in patch || 'isCompacting' in patch;
    const becameIdle =
      'streamingPhase' in patch &&
      this.state.appState.streamingPhase !== 'idle' &&
      patch.streamingPhase === 'idle';
    const modeBeats = collectFooterModeBeats(this.state.appState, patch);
    Object.assign(this.state.appState, patch);
    if ('planMode' in patch || 'ultraworkMode' in patch) this.updateEditorBorderHighlight();
    if ('appearance' in patch) this.appearanceController.apply();
    const theatreActive = isMotionTheatreActive(this.state.appState);
    for (const beat of modeBeats) {
      const planBeat = beat.name === 'plan_enter' || beat.name === 'plan_exit';
      this.motionBeats.play({
        name: beat.name,
        seed: planBeat ? 'plan' : `mode:${beat.title}`,
        title: beat.title,
        nowMs: appearanceAnimationNow(),
        theatreActive,
      });
    }
    this.state.footer.setState(this.state.appState);
    this.state.header.setState(this.state.appState);
    this.updateActivityPane();
    if (busyChanged) {
      this.updateQueueDisplay();
      this.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (additionalDirsChanged) this.setupAutocomplete();
    if (becameIdle) this.promptIntelligence.notifyIdle();
    requestTUIContentRender(this.state);
  }

  patchLivePane(patch: Partial<LivePaneState>): void {
    if (!hasPatchChanges(this.state.livePane, patch)) return;
    Object.assign(this.state.livePane, patch);
    this.updateActivityPane();
    requestTUIContentRender(this.state);
  }

  resetLivePane(): void {
    this.state.livePane = { ...INITIAL_LIVE_PANE };
    this.updateActivityPane();
    requestTUIContentRender(this.state);
  }

  private syncAdditionalDirs(session: Session): void {
    const additionalDirs = session.summary?.additionalDirs ?? [];
    if (sameStringArrays(this.state.appState.additionalDirs, additionalDirs)) return;
    this.setAppState({ additionalDirs: [...additionalDirs] });
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

  private async createSessionFromCurrentState(): Promise<Session> {
    const model = this.state.appState.model.trim();
    if (model.length === 0) {
      throw new Error(LLM_NOT_SET_MESSAGE);
    }
    const options: MutableCreateSessionOptions = {
      workDir: this.state.appState.workDir,
      model,
      thinking:
        this.session === undefined ? undefined : this.state.appState.thinking ? 'on' : 'off',
      permission: this.state.appState.permissionMode,
      planMode: this.state.appState.planMode,
    };
    if (this.state.appState.additionalDirs.length > 0) {
      options.additionalDirs = [...this.state.appState.additionalDirs];
    }
    return this.harness.createSession(options);
  }

  async setSession(session: Session): Promise<void> {
    if (this.session === session) {
      this.harness.setTelemetryContext({ sessionId: session.id });
      this.registerSessionHandlers(session);
      this.syncAdditionalDirs(session);
      return;
    }
    const previous = this.unloadCurrentSession('switching session');
    await previous?.close();
    this.session = session;
    this.harness.setTelemetryContext({ sessionId: session.id });
    this.registerSessionHandlers(session);
    this.syncAdditionalDirs(session);
  }

  async syncRuntimeState(session: Session = this.requireSession()): Promise<void> {
    const [status, goalResult] = await Promise.all([session.getStatus(), session.getGoal()]);
    this.setAppState({
      sessionId: session.id,
      model: status.model ?? '',
      thinking: status.thinkingLevel !== 'off',
      permissionMode: status.permission,
      planMode: status.planMode,
      ultraworkMode: this.state.appState.ultraworkMode,
      premiumQualityMode: status.premiumQualityMode ?? false,
      swarmMode: status.swarmMode ?? false,
      contextTokens: status.contextTokens,
      maxContextTokens: status.maxContextTokens,
      contextUsage: status.contextUsage,
      contextOS: status.contextOS ?? null,
      microCompaction: status.microCompaction ?? null,
      autoDream: status.autoDream ?? null,
      providerRouteStatus: status.providerRouteStatus ?? null,
      sessionTitle: session.summary?.title ?? null,
      goal: goalResult.goal,
    });
    this.syncAdditionalDirs(session);
  }

  // Apply --auto/--yolo/--plan startup flags (or the persisted tui.toml
  // permission mode) to a resumed session. The resumed session may already be
  // in plan mode from its persisted records, and re-entering plan mode throws,
  // so only enable it when it is not active yet. setPermission is idempotent
  // and needs no such guard.
  private async applyStartupModesToResumedSession(session: Session): Promise<void> {
    const { startup } = this.options;
    if (startup.auto) {
      await session.setPermission('auto');
    } else if (startup.yolo) {
      await session.setPermission('yolo');
    } else {
      // No CLI flag: apply the persisted tui.toml permission mode so the
      // resumed session matches the user's configured preference.
      await session.setPermission(this.state.appState.permissionMode);
    }
    if (startup.plan) {
      const status = await session.getStatus();
      if (!status.planMode) {
        await session.setPlanMode(true);
      }
    }
  }

  // Re-apply startup flags that the user explicitly passed on the command line.
  // syncRuntimeState and session-replay hydration can both read stale persisted
  // values, so this guarantees the footer reflects the CLI intent.
  private applyStartupPermissionAndPlanToAppState(): void {
    const { startup } = this.options;
    if (startup.auto) {
      this.setAppState({ permissionMode: 'auto' });
    } else if (startup.yolo) {
      this.setAppState({ permissionMode: 'yolo' });
    }
    if (startup.plan) {
      this.setAppState({ planMode: true });
    }
  }

  // Plan mode is set by createSession — do not re-enter it here.
  private async activateRuntime(): Promise<void> {
    const session = this.requireSession();
    await session.setPermission(this.state.appState.permissionMode);
    await this.syncRuntimeState(session);
  }

  async closeSession(reason: string): Promise<void> {
    const previous = this.unloadCurrentSession(reason);
    await previous?.close();
  }

  private unloadCurrentSession(reason: string): Session | undefined {
    const previous = this.session;
    this.sessionEventUnsubscribe?.();
    this.sessionEventUnsubscribe = undefined;
    this.clearReverseRpcPanels();
    previous?.setApprovalHandler(undefined);
    previous?.setQuestionHandler(undefined);
    previous?.setCredentialHandler(undefined);
    this.approvalController.cancelAll(reason);
    this.questionController.cancelAll(reason);
    this.session = undefined;
    this.state.swarmModeEntry = undefined;
    this.harness.setTelemetryContext({ sessionId: null });
    this.setAppState({ goal: null });
    return previous;
  }

  private clearReverseRpcPanels(): void {
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
  }

  private registerSessionHandlers(session: Session): void {
    session.setApprovalHandler(
      createApprovalRequestHandler(this.approvalController, (request, response) => {
        this.appendApprovalTranscriptEntry(request, response);
      }),
    );
    session.setQuestionHandler(createQuestionAskHandler(this.questionController));
    session.setCredentialHandler(createContext7CredentialHandler(this));
  }

  async fetchSessions(scope: 'cwd' | 'all' = this.state.sessionsScope): Promise<void> {
    this.state.loadingSessions = true;
    this.state.sessionsScope = scope;
    try {
      const sessions =
        scope === 'all'
          ? await this.harness.listSessions({})
          : await this.harness.listSessions({ workDir: this.state.appState.workDir });
      this.state.sessions = sessionRowsForPicker(
        sessions,
        this.state.appState.sessionId,
        this.hasSessionContent(),
      );
    } catch {
      // Surface a warning instead of leaving the picker silently empty — the
      // user cannot tell a genuine "no sessions" from a server/network failure.
      this.state.sessions = [];
      this.showStatus(ttui('tui.sessions.fetchFailed'), 'warning');
    } finally {
      this.state.loadingSessions = false;
    }
  }

  updateTerminalTitle(): void {
    const trimmed = this.state.appState.sessionTitle?.trim() ?? '';
    const label = trimmed.length > 0 ? trimmed.slice(0, MAX_TERMINAL_TITLE_LENGTH) : PRODUCT_NAME;
    this.state.terminal.setTitle?.(label);
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

  private async showResumeOtherWorkDirHint(session: SessionRow): Promise<void> {
    this.hideSessionPicker();
    const command = `cd ${quoteShellArg(session.work_dir)} && liora --resume ${quoteShellArg(session.id)}`;
    const message = `Current session is in a different working directory.\n  To resume, run: ${command}`;
    try {
      await copyTextToClipboard(command);
      this.showStatus(`${message}\n  Command copied to clipboard`, 'warning');
    } catch {
      this.showStatus(`${message}\n  Failed to copy command to clipboard`, 'warning');
    }
  }

  private async resumeSession(targetSessionId: string): Promise<boolean> {
    if (targetSessionId === this.state.appState.sessionId && this.session !== undefined) {
      try {
        await this.session.getStatus();
        this.showStatus('Already on this session.');
        return true;
      } catch {
        // Session was closed — fall through and re-acquire it.
      }
    }
    if (this.state.appState.streamingPhase !== 'idle') {
      this.showError('Cannot switch sessions while streaming — press Esc or Ctrl-C first.');
      return false;
    }
    if (this.state.appState.isReplaying) {
      this.showError('Cannot switch sessions while history is replaying.');
      return false;
    }

    let session: Session;
    try {
      session = await this.harness.resumeSession({ id: targetSessionId });
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to resume session ${targetSessionId}: ${msg}`);
      return false;
    }

    await this.switchToSession(session, `Resumed session (${session.id}).`);
    return true;
  }

  async switchToSession(session: Session, statusMessage: string): Promise<void> {
    this.resetSessionRuntime();
    await this.setSession(session);
    await this.syncRuntimeState(session);
    this.updateTerminalTitle();
    try {
      await this.refreshDynamicSlashCommands(this.session);
    } catch {
      /* keep the switched session usable even if dynamic skills fail */
    }
    this.clearTranscriptAndRedraw();
    try {
      await this.sessionReplay.hydrateFromReplay(session);
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to replay session history: ${msg}`);
    } finally {
      this.sessionEventHandler.startSubscription();
    }
    const resumeState = session.getResumeState();
    if (resumeState?.warning !== undefined) {
      this.showStatus(`Warning: ${resumeState.warning}`, 'warning');
    }
    this.showStatus(statusMessage);
    void this.showSessionWarnings(session);
  }

  async reloadCurrentSessionView(session: Session, statusMessage: string): Promise<void> {
    this.sessionEventUnsubscribe?.();
    this.sessionEventUnsubscribe = undefined;
    this.clearReverseRpcPanels();
    session.setApprovalHandler(undefined);
    session.setQuestionHandler(undefined);
    this.approvalController.cancelAll('reloading session');
    this.questionController.cancelAll('reloading session');

    this.resetSessionRuntime();
    this.session = session;
    this.harness.setTelemetryContext({ sessionId: session.id });
    this.registerSessionHandlers(session);
    await this.syncRuntimeState(session);
    this.updateTerminalTitle();
    try {
      await this.refreshDynamicSlashCommands(session);
    } catch {
      /* keep the reloaded session usable even if dynamic skills fail */
    }
    this.sessionEventHandler.startSubscription();
    const resumeState = session.getResumeState();
    if (resumeState?.warning !== undefined) {
      this.showStatus(`Warning: ${resumeState.warning}`, 'warning');
    }
    this.showStatus(statusMessage);
    void this.showSessionWarnings(session);
  }

  async createNewSession(): Promise<void> {
    if (this.state.appState.isReplaying) {
      this.showError('Cannot start a new session while history is replaying.');
      return;
    }

    let session: Session;
    try {
      session = await this.createSessionFromCurrentState();
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to start a new session: ${msg}`);
      return;
    }

    this.resetSessionRuntime();
    this.setAppState({
      ultraworkMode: false,
      ultraworkPriorState: null,
      activityTip: null,
      isCompacting: false,
      isBackgroundCompacting: false,
      streamingPhase: 'idle',
    });
    await this.setSession(session);
    this.setAppState({ sessionId: session.id });
    this.clearTranscriptAndRedraw();
    try {
      await this.activateRuntime();
      await this.syncRuntimeState(session);
    } catch (error) {
      this.sessionEventHandler.startSubscription();
      const msg = formatErrorMessage(error);
      this.showError(`Post-create setup failed: ${msg}`);
      return;
    }
    try {
      await this.refreshDynamicSlashCommands(this.session);
    } catch {
      /* keep the new session usable even if dynamic skills fail */
    }
    this.sessionEventHandler.startSubscription();
    this.showStatus(`Started a new session (${session.id}).`);
    void this.showSessionWarnings(session);
    void this.showConfigWarningsIfAny();
  }

  /** Surface config.toml load warnings (degraded or kept-previous config) in the status bar. */
  private async showConfigWarningsIfAny(): Promise<void> {
    try {
      const { warnings } = await this.harness.getConfigDiagnostics();
      for (const warning of warnings) {
        this.showStatus(warning, 'warning');
      }
    } catch {
      /* diagnostics are best-effort */
    }
  }

  // =========================================================================
  // Transcript Rendering
  // =========================================================================

  private createTranscriptComponent(entry: TranscriptEntry): Component | null {
    if (entry.compactionData !== undefined) {
      const data = entry.compactionData;
      const block = new CompactionComponent(this.state.ui, data.instruction);
      if (data.result === 'cancelled') {
        block.markCanceled();
      } else {
        block.markDone(data.tokensBefore, data.tokensAfter);
      }
      return block;
    }

    switch (entry.kind) {
      case 'user': {
        const images = entry.imageAttachmentIds
          ?.map((id) => this.imageStore.get(id))
          .filter((a): a is ImageAttachment => a?.kind === 'image');
        return new UserMessageComponent(entry.content, images, entry.bullet, entry.timestamp);
      }
      case 'skill_activation':
        return new SkillActivationComponent(
          entry.skillName ?? entry.content,
          entry.skillArgs,
          entry.skillTrigger,
        );
      case 'plugin_command':
        return new PluginCommandComponent(
          entry.pluginId ?? '',
          entry.pluginCommandName ?? entry.content,
          entry.pluginCommandArgs,
          entry.pluginCommandTrigger,
        );
      case 'cron':
        return new CronMessageComponent(entry.content, entry.cronData ?? {});
      case 'goal':
        if (entry.goalData?.kind === 'created') {
          return new GoalSetMessageComponent();
        }
        if (entry.goalData?.kind === 'lifecycle') {
          return buildGoalMarker(entry.goalData.change, this.state.toolOutputExpanded);
        }
        return null;
      case 'assistant': {
        if (entry.content.trimStart().startsWith('✓ Goal complete')) {
          return new GoalCompletionMessageComponent(entry.content);
        }
        const component = new AssistantMessageComponent();
        component.updateContent(entry.content);
        return component;
      }
      case 'thinking': {
        const thinking = new ThinkingComponent(entry.content, true);
        if (this.state.toolOutputExpanded) thinking.setExpanded(true);
        return thinking;
      }
      case 'tool_call':
        if (entry.toolCallData) {
          const tc = new ToolCallComponent(
            entry.toolCallData,
            entry.toolCallData.result,
            this.state.ui,
            this.state.appState.workDir,
          );
          if (this.state.toolOutputExpanded) tc.setExpanded(true);
          return tc;
        }
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'status':
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'welcome':
        return null;
      default:
        return null;
    }
  }

  appendTranscriptEntry(entry: TranscriptEntry): void {
    this.state.transcriptEntries.push(entry);
    const component = this.createTranscriptComponent(entry);
    if (component) {
      markTranscriptComponent(component, entry);
      this.state.transcriptContainer.addChild(component);
    }
    const trimmed = this.trimTranscriptWindow();
    const merged = this.mergeCurrentTurnSteps();
    if (component || trimmed || merged) {
      requestTUIContentRender(this.state);
    }
  }

  private appendApprovalTranscriptEntry(
    request: ApprovalRequest,
    response: ApprovalResponse,
  ): void {
    if (
      request.toolName === 'ExitPlanMode' ||
      request.display.kind === 'plan_review' ||
      request.display.kind === 'goal_start'
    )
      return;
    const parts: string[] = [];
    switch (response.decision) {
      case 'approved':
        parts.push(response.scope === 'session' ? 'Approved for session' : 'Approved');
        break;
      case 'rejected':
        parts.push('Rejected');
        break;
      case 'cancelled':
        parts.push('Cancelled');
        break;
    }
    parts.push(`: ${request.action}`);
    if (response.feedback !== undefined && response.feedback.length > 0) {
      parts.push(` — "${response.feedback}"`);
    }
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'status',
      turnId: request.turnId === undefined ? undefined : String(request.turnId),
      renderMode: 'notice',
      content: parts.join(''),
    });
  }

  private renderWelcome(): void {
    if (
      !this.state.transcriptContainer.children.some((child) => child instanceof WelcomeComponent)
    ) {
      this.state.transcriptContainer.addChild(new WelcomeComponent(this.state.appState));
    }
    // Ambient empty-stage under welcome: vanishes on first real transcript child.
    // preferredRows tracks the live transcript region so the night sky fills
    // the empty pane (no hard 14-row cap). Suppress while session history replays.
    if (this.state.appState.isReplaying) {
      this.state.transcriptContainer.dismissIdleStage();
      return;
    }
    if (
      !this.state.transcriptContainer.children.some((child) => child instanceof IdleStageComponent)
    ) {
      this.state.transcriptContainer.addChild(
        new IdleStageComponent({
          state: this.state.appState,
          getPreferredRows: (width) => this.state.transcriptContainer.idleTargetRows(width),
        }),
      );
    }
  }

  /**
   * Take over the full UI for a cinematic splash, then restore chrome.
   * Skips immediately when shouldAnimate / motionEffectsAllowed is false.
   */
  private async playStartupSplash(): Promise<void> {
    this.disposeStartupSplash();
    const splash = new SplashComponent({
      appearance: this.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      getRows: () => Math.max(8, this.state.terminal.rows),
      requestRender: () => {
        // Layout invalidation so the native frame path repaints the takeover.
        requestTUILayoutRender(this.state);
      },
      getMorphScene: (width, rows) => {
        const stageWidth = Math.max(1, width);
        return buildSplashMorphScene({
          width,
          rows,
          appState: this.state.appState,
          headerLines: this.state.headerContainer.render(stageWidth),
          footerLines: this.state.footerContainer.render(stageWidth),
          editorLines: this.state.editorContainer.render(stageWidth),
        });
      },
      onSplashActiveChange: (active) => {
        this.splashForcesAmbient = active;
        this.appearanceController.apply();
      },
    });
    // Fast path: do not steal the UI tree when motion is off.
    if (!shouldPlaySplash(this.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES)) {
      splash.dispose();
      return;
    }

    this.splash = splash;
    const savedChildren = [...this.state.ui.children];
    this.splashSavedChildren = savedChildren;
    this.state.ui.clear();
    this.state.ui.addChild(splash);
    requestTUILayoutRender(this.state);
    try {
      await splash.play();
    } finally {
      this.disposeStartupSplash();
    }
  }

  private disposeStartupSplash(): void {
    const splash = this.splash;
    const saved = this.splashSavedChildren;
    this.splash = undefined;
    this.splashSavedChildren = undefined;
    splash?.dispose();
    if (this.splashForcesAmbient) {
      this.splashForcesAmbient = false;
      this.appearanceController.apply();
    }
    if (saved !== undefined) {
      // Flag: the next native frame must not full-clear — the last morph frame
      // is still on screen and the real UI paints over it without a black flash.
      this.state.splashJustDisposed = true;
      this.state.ui.clear();
      for (const child of saved) {
        this.state.ui.addChild(child);
      }
      this.state.ui.setFocus(this.state.editor);
      requestTUILayoutRender(this.state);
      return;
    }
    // Splash never stole the tree (skip path) — nothing to restore.
  }

  private clearTerminalInlineImages(): void {
    const sequence = encodeRendererClearInlineImages(resolveImageProtocol());
    if (sequence.length > 0) this.state.terminal.write(sequence);
  }

  private clearTranscriptAndRedraw(): void {
    this.streamingUI.discardPending();
    this.state.transcriptEntries = [];
    this.streamingUI.disposeActiveCompactionBlock();
    this.streamingUI.resetLiveText();
    this.streamingUI.resetToolUi();
    this.sessionEventHandler.stopAllMcpServerStatusSpinners();
    // Dispose disposable children (e.g. ShellRunComponent's 1s timer) before
    // dropping them, so a /clear or session switch can't leak intervals that
    // keep firing requestRender on a removed component.
    for (const child of this.state.transcriptContainer.children) {
      if (hasDispose(child)) child.dispose();
    }
    this.state.transcriptContainer.clear();
    this.state.transcriptContainer.invalidate();
    this.btwPanelController.clear();
    this.clearTerminalInlineImages();
    this.state.todoPanel.clear();
    this.state.todoPanelContainer.clear();
    this.imageStore.clear();
    this.renderWelcome();
    requestTUILayoutRender(this.state);
  }

  private isTurnBoundaryComponent(child: Component): boolean {
    if (!(child instanceof UserMessageComponent) && !(child instanceof PluginCommandComponent)) {
      return false;
    }
    const entry = getTranscriptComponentEntry(child);
    if (entry === undefined) return false;
    // Live user messages have an undefined turnId; replayed user messages get a
    // `replay:N` turnId. Both start a new turn. Steer messages carry a defined
    // non-replay turnId and are not boundaries.
    return entry.turnId === undefined || entry.turnId.startsWith('replay:');
  }

  private trimTranscriptWindow(): boolean {
    if (!TRANSCRIPT_WINDOW_ENABLED || TRANSCRIPT_MAX_TURNS <= 0) return false;
    // Session replay already caps history to its own turn limit; trimming during
    // replay would shrink it further and fight that limit.
    if (this.state.appState.isReplaying) return false;

    const children = this.state.transcriptContainer.children;

    // Trim whole turns by *position* in the child list rather than by entry
    // lookup — otherwise only the (registered) user message would be removed and
    // the rest of the turn would be left behind.
    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }

    const turns = groupTurns(this.state.transcriptEntries);

    const toRemove = turnsToTrim(turns, TRANSCRIPT_MAX_TURNS, TRANSCRIPT_HYSTERESIS);
    if (toRemove.size === 0) return false;

    let boundariesToRemove = 0;
    for (const entry of toRemove) {
      if (entry.kind === 'user' && entry.turnId === undefined) boundariesToRemove++;
    }
    if (boundariesToRemove === 0) {
      this.state.transcriptEntries = this.state.transcriptEntries.filter((e) => !toRemove.has(e));
      return true;
    }

    let boundariesSeen = 0;
    let cutoff = 0;
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) {
        if (boundariesSeen === boundariesToRemove) {
          cutoff = i;
          break;
        }
        boundariesSeen++;
      }
    }

    const componentsToRemove: Component[] = [];
    for (let i = 0; i < cutoff; i++) {
      const child = children[i]!;
      if (child instanceof WelcomeComponent) continue;
      componentsToRemove.push(child);
    }
    for (const child of componentsToRemove) {
      // pi-tui Container.removeChild (not a DOM node); `child.remove()` does not exist.
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      this.state.transcriptContainer.removeChild(child);
      if (hasDispose(child)) child.dispose();
    }

    this.state.transcriptEntries = this.state.transcriptEntries.filter((e) => !toRemove.has(e));
    return true;
  }

  mergeCurrentTurnSteps(): boolean {
    if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return false;
    const children = this.state.transcriptContainer.children;

    // Find the start of the current turn (last turn-starting user message).
    let turnStart = -1;
    for (let i = children.length - 1; i >= 0; i--) {
      if (this.isTurnBoundaryComponent(children[i]!)) {
        turnStart = i;
        break;
      }
    }
    if (turnStart < 0) return false;

    // Locate an existing summary, the assistant message, and the mergeable steps.
    let summaryIndex = -1;
    const stepIndices: number[] = [];
    for (let i = turnStart + 1; i < children.length; i++) {
      const child = children[i]!;
      if (child instanceof StepSummaryComponent) {
        summaryIndex = i;
        continue;
      }
      if (child instanceof AssistantMessageComponent) continue;
      stepIndices.push(i);
    }

    if (stepIndices.length <= TRANSCRIPT_KEEP_RECENT_STEPS) return false;
    const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
    const toMergeIndices = stepIndices.slice(0, mergeCount);

    let thinkingCount = 0;
    let toolCount = 0;
    for (const idx of toMergeIndices) {
      const child = children[idx]!;
      if (child instanceof ThinkingComponent) thinkingCount++;
      else if (child instanceof ToolCallComponent) toolCount++;
    }
    if (thinkingCount === 0 && toolCount === 0) return false;

    let summary: StepSummaryComponent;
    if (summaryIndex >= 0) {
      summary = children[summaryIndex] as StepSummaryComponent;
      summary.addCounts(thinkingCount, toolCount);
    } else {
      summary = new StepSummaryComponent();
      summary.addCounts(thinkingCount, toolCount);
    }

    // Rebuild children: keep everything except the merged steps, with the summary
    // sitting right after the user message.
    const toMergeSet = new Set(toMergeIndices);
    const newChildren: Component[] = [];
    for (let i = 0; i <= turnStart; i++) newChildren.push(children[i]!);
    newChildren.push(summary);
    for (let i = turnStart + 1; i < children.length; i++) {
      if (i === summaryIndex) continue;
      if (toMergeSet.has(i)) continue;
      newChildren.push(children[i]!);
    }

    for (const idx of toMergeIndices) {
      const child = children[idx]!;
      if (hasDispose(child)) child.dispose();
    }

    children.splice(0, children.length, ...newChildren);
    return true;
  }

  mergeAllTurnSteps(): void {
    if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return;
    const children = this.state.transcriptContainer.children;

    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }
    if (boundaries.length === 0) return;

    const newChildren: Component[] = [];
    const toDispose: Component[] = [];
    for (let i = 0; i < boundaries[0]!; i++) newChildren.push(children[i]!);

    for (let t = 0; t < boundaries.length; t++) {
      const turnStart = boundaries[t]!;
      const turnEnd = t + 1 < boundaries.length ? boundaries[t + 1]! : children.length;
      newChildren.push(children[turnStart]!);

      let summaryIndex = -1;
      const stepIndices: number[] = [];
      for (let i = turnStart + 1; i < turnEnd; i++) {
        const child = children[i]!;
        if (child instanceof StepSummaryComponent) summaryIndex = i;
        else if (child instanceof AssistantMessageComponent) continue;
        else stepIndices.push(i);
      }

      if (stepIndices.length > TRANSCRIPT_KEEP_RECENT_STEPS) {
        const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
        const toMergeIndices = stepIndices.slice(0, mergeCount);
        let thinkingCount = 0;
        let toolCount = 0;
        for (const idx of toMergeIndices) {
          const child = children[idx]!;
          if (child instanceof ThinkingComponent) thinkingCount++;
          else if (child instanceof ToolCallComponent) toolCount++;
        }
        let summary: StepSummaryComponent;
        if (summaryIndex >= 0) {
          summary = children[summaryIndex] as StepSummaryComponent;
          summary.addCounts(thinkingCount, toolCount);
        } else {
          summary = new StepSummaryComponent();
          summary.addCounts(thinkingCount, toolCount);
        }
        newChildren.push(summary);
        for (const idx of toMergeIndices) toDispose.push(children[idx]!);
        const toMergeSet = new Set(toMergeIndices);
        for (let i = turnStart + 1; i < turnEnd; i++) {
          if (i === summaryIndex) continue;
          if (toMergeSet.has(i)) continue;
          newChildren.push(children[i]!);
        }
      } else {
        for (let i = turnStart + 1; i < turnEnd; i++) newChildren.push(children[i]!);
      }
    }

    for (const child of toDispose) {
      if (hasDispose(child)) child.dispose();
    }
    children.splice(0, children.length, ...newChildren);
  }

  showStatus(message: string, color?: ColorToken): void {
    this.state.transcriptContainer.addChild(new StatusMessageComponent(message, color));
    requestTUILayoutRender(this.state);
  }

  showNotice(
    title: string,
    detail?: string,
    options?: slashCommands.ShowNoticeOptions,
  ): void {
    const coalesceKey = options?.coalesceKey;
    if (coalesceKey !== undefined) {
      const { children } = this.state.transcriptContainer;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child instanceof NoticeMessageComponent && child.coalesceKey === coalesceKey) {
          children.splice(index, 1);
        }
      }
    }
    this.state.transcriptContainer.addChild(
      new NoticeMessageComponent(title, detail, coalesceKey),
    );
    requestTUILayoutRender(this.state);
  }

  showError(message: string): void {
    this.showStatus(`Error: ${message}`, 'error');
  }

  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return this.showProgressSpinner(label);
  }

  showProgressSpinner(label: string): LoginProgressSpinnerHandle {
    const tint = (s: string): string => currentTheme.fg('primary', s);
    const spinner = new MoonLoader(this.state.ui, 'braille', tint, label);
    this.state.transcriptContainer.addChild(new Spacer(1));
    this.state.transcriptContainer.addChild(spinner);
    requestTUIContentRender(this.state);
    return {
      stop: ({ ok, label: finalLabel }) => {
        spinner.stop();
        const tone = ok ? 'success' : 'error';
        const symbol = ok ? '✓' : '✗';
        spinner.setText(currentTheme.fg(tone, `${symbol} ${finalLabel}`));
        requestTUILayoutRender(this.state);
      },
      setLabel: (nextLabel) => {
        spinner.setLabel(nextLabel);
      },
    };
  }

  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle {
    openUrl(auth.verificationUriComplete);
    this.state.transcriptContainer.addChild(
      new DeviceCodeBoxComponent({
        title: 'Sign in to SuperLiora',
        url: auth.verificationUriComplete,
        code: auth.userCode,
        hint: 'Press Ctrl-C to cancel',
      }),
    );
    requestTUIContentRender(this.state);
    return this.showLoginProgressSpinner('Waiting for authorization…');
  }

  // =========================================================================
  // Panes / Presentation State
  // =========================================================================

  updateActivityPane(): void {
    const effectiveMode = this.resolveActivityPaneMode();
    const tipKind = loadingTipKind(effectiveMode);
    // Pick a fresh loading tip when the loading kind changes. The same kind
    // covers waiting/tool (both moon spinners) and any intermediate thinking
    // phase, so a continuous burst of tool calls does not flip tips. Clear the
    // cache only when there is no loading UI at all.
    if (effectiveMode === 'idle' || effectiveMode === 'session' || effectiveMode === 'hidden') {
      this.currentLoadingTip = undefined;
    } else if (tipKind !== undefined) {
      const pinnedTip = this.state.appState.activityTip ?? undefined;
      if (pinnedTip !== undefined) {
        if (
          this.currentLoadingTip === undefined ||
          this.currentLoadingTip.kind !== tipKind ||
          this.currentLoadingTip.tip !== pinnedTip ||
          !this.currentLoadingTip.pinned
        ) {
          this.currentLoadingTip = { kind: tipKind, tip: pinnedTip, pinned: true };
        }
      } else if (
        this.currentLoadingTip === undefined ||
        this.currentLoadingTip.kind !== tipKind ||
        this.currentLoadingTip.pinned
      ) {
        const previousKey = this.currentLoadingTip?.tipKey;
        const picked = pickRandomWorkingTip(previousKey);
        this.currentLoadingTip = {
          kind: tipKind,
          tip: picked === undefined ? undefined : tipText(picked),
          tipKey: picked?.key,
          pinned: false,
        };
      }
    }
    this.syncTerminalProgress(this.shouldShowTerminalProgress(effectiveMode));
    const placeSpinnerInAgentSwarm = this.shouldPlaceActivitySpinnerInAgentSwarm(effectiveMode);
    const activityModeKey = `${effectiveMode}:${placeSpinnerInAgentSwarm ? 'swarm' : 'pane'}`;

    if (
      activityModeKey === this.lastActivityMode &&
      (effectiveMode === 'waiting' || effectiveMode === 'thinking' || effectiveMode === 'tool')
    ) {
      if (placeSpinnerInAgentSwarm) {
        this.syncAgentSwarmActivitySpinner(this.state.activitySpinner?.instance);
      }
      return;
    }

    this.lastActivityMode = activityModeKey;
    this.state.activityContainer.clear();

    switch (effectiveMode) {
      case 'hidden':
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        requestTUILayoutRender(this.state);
        return;
      case 'waiting': {
        const spinner = this.ensureActivitySpinner('moon');
        this.syncAgentSwarmActivitySpinner(placeSpinnerInAgentSwarm ? spinner : undefined);
        if (placeSpinnerInAgentSwarm) break;
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'waiting',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'thinking': {
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'thinking',
          }),
        );
        this.motionBeats.play({
          name: 'thinking_enter',
          seed: 'thinking',
          title: 'Thinking',
          nowMs: appearanceAnimationNow(),
          theatreActive: isMotionTheatreActive(this.state.appState),
        });
        break;
      }
      case 'composing': {
        const spinner = this.ensureActivitySpinner('comet', 'working...', (s) =>
          currentTheme.fg('primary', s),
        );
        this.syncAgentSwarmActivitySpinner(undefined);
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'composing',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'tool': {
        const spinner = this.ensureActivitySpinner('moon');
        this.syncAgentSwarmActivitySpinner(placeSpinnerInAgentSwarm ? spinner : undefined);
        if (placeSpinnerInAgentSwarm) break;
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'tool',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'idle':
      case 'session': {
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        break;
      }
    }
    requestTUIContentRender(this.state);
  }

  private resolveActivityPaneMode(): EffectiveActivityPaneMode {
    if (this.state.activeDialog === 'session-picker') return 'hidden';
    if (this.state.livePane.pendingApproval !== null) return 'hidden';
    if (this.state.appState.isCompacting) return 'hidden';
    if (this.state.livePane.pendingQuestion !== null) return 'hidden';

    const streamingPhase = this.state.appState.streamingPhase;

    // A running `!` shell command shows the moon spinner (same as `waiting`)
    // until it finishes, signalling that input is busy / queued.
    if (streamingPhase === 'shell') return 'waiting';

    if (this.state.livePane.mode === 'idle') {
      if (streamingPhase === 'thinking' || streamingPhase === 'composing') {
        return streamingPhase;
      }
    }

    return this.state.livePane.mode;
  }

  updateQueueDisplay(): void {
    this.state.queueContainer.clear();
    const queued = this.state.queuedMessages;
    if (queued.length === 0) {
      this.queueSettleSelectionIdentity = undefined;
      this.queueSettleStartedAtMs = undefined;
      return;
    }

    const selectedIndex = Math.max(0, queued.length - 1);
    const settle = resolveHostOwnedQueueSettleStartedAtMs({
      selectionIdentity: queuePaneSelectionIdentity(queued, selectedIndex),
      previousSelectionIdentity: this.queueSettleSelectionIdentity,
      previousSettleStartedAtMs: this.queueSettleStartedAtMs,
      nowMs: appearanceAnimationNow(),
    });
    this.queueSettleSelectionIdentity = settle.selectionIdentity;
    this.queueSettleStartedAtMs = settle.settleStartedAtMs;

    this.state.queueContainer.addChild(
      new QueuePaneComponent({
        messages: queued,
        isCompacting: this.state.appState.isCompacting,
        isStreaming: this.state.appState.streamingPhase !== 'idle',
        canSteerImmediately: !this.deferUserMessages,
        selectedIndex,
        settleStartedAtMs: settle.settleStartedAtMs,
      }),
    );
  }

  toggleToolOutputExpansion(): void {
    this.state.toolOutputExpanded = !this.state.toolOutputExpanded;
    const children = this.state.transcriptContainer.children;

    // A component is expandable only if it sits at or after the start of the
    // (totalTurns - expandTurns)-th turn — i.e. it belongs to one of the most
    // recent `expandTurns` turns. Position-based so it also covers streaming
    // components that have no entry in the metadata map.
    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }
    const expandCutoff =
      TRANSCRIPT_EXPAND_TURNS <= 0
        ? children.length
        : boundaries.length > TRANSCRIPT_EXPAND_TURNS
          ? boundaries[boundaries.length - TRANSCRIPT_EXPAND_TURNS]!
          : 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (!isExpandable(child)) continue;
      child.setExpanded(this.state.toolOutputExpanded && i >= expandCutoff);
    }
    requestTUIContentRender(this.state);
  }

  toggleTodoPanelExpansion(): void {
    this.state.todoPanel.toggleExpanded();
    requestTUIContentRender(this.state);
  }

  private async detachRunningShellCommand(): Promise<void> {
    // Only one `!` command runs at a time (input is queued while busy).
    const next = this.shellOutputStreams.entries().next();
    if (next.done) {
      this.showDetachHint('No shell command running.');
      return;
    }
    const [commandId, stream] = next.value;
    if (stream.taskId === undefined) {
      this.showDetachHint('Command is still starting — try again.');
      return;
    }
    const session = this.session;
    if (session === undefined) return;
    try {
      const info = await session.detachBackgroundTask(stream.taskId);
      if (info === undefined) {
        this.showDetachHint('Command already finished.');
        return;
      }
    } catch (error) {
      this.showError(`Failed to move to background: ${formatErrorMessage(error)}`);
      return;
    }
    // Finalize the card as backgrounded and drop the stream so the eventual
    // runShellCommand resolution (which carries background metadata) is a no-op
    // instead of overwriting this view.
    stream.component.finishBackgrounded();
    stream.entry.content = 'Moved to background.';
    this.shellOutputStreams.delete(commandId);
    // The backgrounded command's notification turn (started by agent-core via
    // appendSystemReminderAndNotify) owns the streaming phase and drains the
    // queue when it completes, so we intentionally leave both untouched here.
    this.showDetachHint(ttui('tui.footer.detachHint'));
  }

  async detachCurrentForegroundTask(): Promise<void> {
    // A running `!` shell command takes priority over agent foreground tasks.
    if (this.shellOutputStreams.size > 0) {
      await this.detachRunningShellCommand();
      return;
    }

    const session = this.session;
    if (session === undefined) {
      this.showError(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }

    let tasks: readonly BackgroundTaskInfo[];
    try {
      // activeOnly defaults to true; foreground running tasks are non-terminal
      // and therefore included. We filter to `detached === false` ourselves.
      tasks = await session.listBackgroundTasks();
    } catch (error) {
      this.showError(`Failed to list tasks: ${formatErrorMessage(error)}`);
      return;
    }

    const targets = pickForegroundTasks(tasks);
    if (targets.length === 0) {
      this.showDetachHint('No foreground task running.');
      return;
    }

    let detached = 0;
    let alreadyFinished = 0;
    for (const target of targets) {
      try {
        const info = await session.detachBackgroundTask(target.taskId);
        if (info === undefined) alreadyFinished++;
        else detached++;
      } catch (error) {
        this.showError(`Failed to detach ${target.taskId}: ${formatErrorMessage(error)}`);
      }
    }

    let hint: string;
    if (detached === 0 && alreadyFinished > 0) {
      hint = alreadyFinished === 1 ? 'Task already finished.' : 'Tasks already finished.';
    } else if (detached === targets.length) {
      hint = detached === 1 ? 'Moved 1 task to background.' : `Moved ${detached} tasks to background.`;
    } else {
      hint = `Moved ${detached} of ${targets.length} tasks to background.`;
    }
    if (detached > 0) hint = `${hint} /tasks to view.`;
    this.showDetachHint(hint);
  }

  /** Show a one-shot footer hint that auto-clears after DETACH_HINT_DISPLAY_MS. */
  private showDetachHint(hint: string): void {
    if (this.detachHintClearTimer !== undefined) {
      clearTimeout(this.detachHintClearTimer);
      this.detachHintClearTimer = undefined;
    }
    this.state.footer.setTransientHint(hint);
    const timer = setTimeout(() => {
      this.detachHintClearTimer = undefined;
      // Don't clobber a newer transient hint (e.g. the exit-confirmation
      // prompt) that took over while this timer was pending.
      if (this.state.footer.getTransientHint() !== hint) return;
      this.state.footer.setTransientHint(null);
      requestTUIContentRender(this.state);
    }, DETACH_HINT_DISPLAY_MS);
    timer.unref?.();
    this.detachHintClearTimer = timer;
    requestTUIContentRender(this.state);
  }

  updateEditorBorderHighlight(text?: string): void {
    const trimmed = (text ?? this.state.editor.getText()).trimStart();
    const isBash = this.state.appState.inputMode === 'bash';
    const ultrawork = this.state.appState.ultraworkMode === true;
    const highlighted =
      this.state.appState.planMode || ultrawork || isBash || trimmed.startsWith('/');
    const prevHighlighted = this.state.editor.borderHighlighted;
    this.state.editor.borderHighlighted = highlighted;
    // Shell mode: fixed hue. Ultrawork: live multi-hue glow. Plan/slash: primary.
    if (isBash) {
      this.state.editor.borderColor = (s: string) => currentTheme.fg('shellMode', s);
    } else if (ultrawork) {
      // Native layout resolves the live glow hex on animation frames. Do not
      // re-bind chalk + force a second full paint on every keystroke.
      const hex = resolveUltraworkBorderGlowHex(appearanceAnimationNow());
      this.state.editor.borderColor = (s: string) => chalk.hex(hex).bold(s);
    } else if (highlighted) {
      this.state.editor.borderColor = (s: string) => currentTheme.fg('primary', s);
    } else {
      this.state.editor.borderColor = (s: string) => currentTheme.fg('border', s);
    }
    // Only repaint when the highlight *state* flips (plan/slash/bash/ultrawork).
    // Ultrawork chase is driven by the animation scheduler, not onChange.
    if (prevHighlighted === highlighted) return;
    requestTUIContentRender(this.state);
  }

  async applyTheme(themeName: ThemeName, resolved?: ResolvedTheme): Promise<void> {
    const palette = await getColorPalette(themeName === 'auto' ? (resolved ?? 'dark') : themeName);
    currentTheme.setPalette(palette);
    this.setAppState({ theme: themeName });
    this.appearanceController.apply();
    this.updateEditorBorderHighlight();
    // Force every historical message to re-render so Markdown/Text caches
    // (which hold old ANSI colour codes) are cleared.
    this.state.transcriptContainer.invalidate();
    requestTUILayoutRender(this.state);
  }

  refreshTerminalThemeTracking(): void {
    this.stopTerminalThemeTracking();
    if (!isBuiltInTheme(this.state.appState.theme) || this.state.appState.theme !== 'auto') return;

    this.terminalThemeTrackingDispose = installTerminalThemeTracking(this.state, (resolved) => {
      void this.applyResolvedAutoTheme(resolved);
    });
  }

  private stopTerminalThemeTracking(): void {
    this.terminalThemeTrackingDispose?.();
    this.terminalThemeTrackingDispose = undefined;
  }

  private async applyResolvedAutoTheme(resolved: ResolvedTheme): Promise<void> {
    if (this.state.appState.theme !== 'auto') return;
    const palette = getBuiltInPalette(resolved);
    if (currentTheme.palette === palette) return;
    currentTheme.setPalette(palette);
    this.appearanceController.apply();
    this.updateEditorBorderHighlight();
    // Repaint already-rendered transcript entries (status/markdown caches hold
    // old ANSI codes), matching applyTheme()'s behaviour.
    this.state.transcriptContainer.invalidate();
    requestTUILayoutRender(this.state);
  }

  private shouldShowTerminalProgress(effectiveMode: EffectiveActivityPaneMode): boolean {
    if (this.state.appState.isCompacting) return true;
    return (
      effectiveMode === 'waiting' ||
      effectiveMode === 'thinking' ||
      effectiveMode === 'composing' ||
      effectiveMode === 'tool'
    );
  }

  private shouldPlaceActivitySpinnerInAgentSwarm(
    effectiveMode: EffectiveActivityPaneMode,
  ): boolean {
    return (
      this.sessionEventHandler.hasActiveAgentSwarmToolCall() &&
      (effectiveMode === 'waiting' || effectiveMode === 'tool')
    );
  }

  private syncAgentSwarmActivitySpinner(spinner: MoonLoader | undefined): void {
    this.sessionEventHandler.syncAgentSwarmActivitySpinner(spinner);
  }

  private syncTerminalProgress(active: boolean): void {
    if (!this.state.terminalState.supportsProgress) return;
    if (this.state.terminalState.progressActive === active) return;
    this.state.terminal.setProgress?.(active);
    this.state.terminalState.progressActive = active;
  }

  private ensureActivitySpinner(
    style: SpinnerStyle,
    label = '',
    colorFn?: (s: string) => string,
  ): MoonLoader {
    if (this.state.activitySpinner?.style !== style) {
      this.stopActivitySpinner();
    }

    if (this.state.activitySpinner === null) {
      const instance = new MoonLoader(this.state.ui, style, colorFn, label);
      this.state.activitySpinner = { instance, style };
      return instance;
    }

    this.state.activitySpinner.instance.setLabel(label);
    if (colorFn !== undefined) {
      this.state.activitySpinner.instance.setColorFn(colorFn);
    }
    return this.state.activitySpinner.instance;
  }

  private stopActivitySpinner(): void {
    if (this.state.activitySpinner !== null) {
      this.state.activitySpinner.instance.stop();
      this.state.activitySpinner = null;
    }
  }

  // =========================================================================
  // Dialogs / Selectors
  // =========================================================================

  mountEditorReplacement(panel: Component & Focusable): void {
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(panel);
    this.state.ui.setFocus(panel);
    this.mountNativeInputModal(panel);
    // Track that a command-driven dialog owns the editor area so background
    // approval/question events do not clobber it mid-flow (BUG-7). Help and
    // session-picker set their own specific dialog id after this call.
    if (this.state.activeDialog === null) this.state.activeDialog = 'command';
    requestTUIContentRender(this.state);
  }

  restoreEditor(): void {
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.state.ui.setFocus(this.state.editor);
    this.nativeInputModalDispose?.();
    this.nativeInputModalDispose = undefined;
    this.nativeInputRouter?.focusEditor();
    // Only clear a generic command-dialog marker. Help/session-picker manage
    // their own `activeDialog` lifecycle and may already be null here.
    if (this.state.activeDialog === 'command') this.state.activeDialog = null;
    requestTUIContentRender(this.state);
    // Flush any reverse-RPC panel that was deferred while a command dialog was
    // open (BUG-7). Approval takes priority, then question.
    const approval = this.deferredApproval;
    if (approval !== undefined) {
      this.deferredApproval = undefined;
      this.showApprovalPanel(approval);
      return;
    }
    const question = this.deferredQuestion;
    if (question !== undefined) {
      this.deferredQuestion = undefined;
      this.showQuestionDialog(question);
    }
  }

  private mountNativeInputModal(panel: Component & Focusable): void {
    const inputRouter = this.nativeInputRouter;
    if (inputRouter === undefined || panel.handleInput === undefined) return;
    this.nativeInputModalDispose?.();
    const id = `editor-replacement:${String(++this.nativeInputModalSequence)}`;
    const handleInput = panel.handleInput.bind(panel);
    this.nativeInputModalDispose = inputRouter.pushLegacyModalTarget({
      id,
      handleInput: (data) => {
        handleInput(data);
      },
    });
  }

  restoreInputText(text: string): void {
    this.restoreEditor();
    this.state.editor.setText(text);
    this.updateEditorBorderHighlight(text);
    requestTUIContentRender(this.state);
  }

  /** Ctrl-X: stash the current draft, or pop the latest stash when the editor is empty. */
  stashPromptToggle(): void {
    const editor = this.state.editor;
    const text = editor.getText();
    if (text.trim().length > 0) {
      this.promptStash.push({ text, mode: editor.inputMode });
      editor.setText('');
      this.updateEditorBorderHighlight('');
      this.showStatus(ttui('tui.stash.stashed', { count: String(this.promptStash.size) }));
      requestTUIContentRender(this.state);
      return;
    }
    const entry = this.promptStash.pop();
    if (entry === undefined) {
      this.showStatus(ttui('tui.stash.empty'));
      return;
    }
    this.restoreInputText(entry.text);
    // Restore the stashed mode like queue recall does, so a draft saved in
    // shell mode comes back ready to run as a `!` command.
    const mode = entry.mode;
    if (editor.inputMode !== mode) {
      editor.inputMode = mode;
      editor.onInputModeChange?.(mode);
    }
    this.updateQueueDisplay();
    requestTUILayoutRender(this.state);
    this.showStatus(ttui('tui.stash.restored', { count: String(this.promptStash.size) }));
  }

  // =========================================================================
  // History search (Ctrl-R), command palette (Ctrl-Space),
  // transcript search (Ctrl-F), retry last turn (Ctrl-Y)
  // =========================================================================

  showHistorySearch(): void {
    if (this.state.activeDialog !== null) return;
    void this.openHistorySearch();
  }

  private async openHistorySearch(): Promise<void> {
    let entries: { content: string }[] = [];
    try {
      entries = await loadInputHistory(getInputHistoryFile(this.state.appState.workDir));
    } catch {
      entries = [];
    }
    // Most-recent-first ordering for search UX.
    const items = [...new Set(entries.map((e) => e.content))].reverse();
    const dialog = new HistorySearchDialogComponent({
      items,
      onSelect: (text) => {
        this.restoreEditor();
        this.state.editor.setText(text);
        this.updateEditorBorderHighlight(text);
        requestTUIContentRender(this.state);
      },
      onCancel: () => {
        this.restoreEditor();
      },
    });
    this.mountEditorReplacement(dialog);
  }

  showCommandPalette(): void {
    if (this.state.activeDialog !== null) return;
    const commands = this.getSlashCommands('primary');
    const entries: PaletteEntry[] = commands
      .filter((cmd) => cmd.visibility !== 'hidden')
      .map((cmd) => ({
        kind: 'command' as const,
        value: cmd.name,
        label: `/${cmd.name}`,
        description: cmd.description,
      }));
    // A few high-value session actions.
    const actions: PaletteEntry[] = [
      { kind: 'action', value: 'new', label: '/new', description: 'Start a new session' },
      { kind: 'action', value: 'sessions', label: '/sessions', description: 'Switch session' },
      { kind: 'action', value: 'model', label: '/model', description: 'Switch model' },
      { kind: 'action', value: 'help', label: '/help', description: 'Show help' },
    ];
    const palette = new CommandPaletteComponent({
      entries: [...entries, ...actions],
      onSelect: (entry) => {
        this.restoreEditor();
        const text = entry.kind === 'action' ? `/${entry.value}` : `/${entry.value}`;
        // Run the command through the normal dispatch path.
        slashCommands.dispatchInput(this, text);
      },
      onCancel: () => {
        this.restoreEditor();
      },
    });
    this.mountEditorReplacement(palette);
  }

  showTranscriptSearch(): void {
    if (this.state.activeDialog !== null) return;
    const entries = this.state.transcriptEntries
      .map((entry, index) => {
        // Strip ANSI/control noise from searchable text.
        const text = entry.content.replace(/\u001B\[[0-9;]*m/g, '').trim();
        return { index, text };
      })
      .filter((entry) => entry.text.length > 0);
    const dialog = new TranscriptSearchDialogComponent({
      entries,
      onSelect: (index) => {
        // Keep the dialog open so the user can jump to more matches; just
        // scroll the matching entry into view.
        this.scrollToTranscriptIndex(index);
      },
      onCancel: () => {
        this.restoreEditor();
      },
    });
    this.mountEditorReplacement(dialog);
  }

  private scrollToTranscriptIndex(index: number): void {
    const entry = this.state.transcriptEntries[index];
    if (entry === undefined) return;
    // Exact jump: resolve the entry's first line in the current transcript
    // layout and move the viewport start there. Resolving the hit-test
    // context also warms the cached transcript layout.
    const context = resolveTranscriptHitTestContext(this.state);
    if (context !== undefined) {
      const line = resolveTranscriptEntryLineOffset(this.state, entry.id, context.stageWidth);
      if (line !== undefined) {
        jumpTranscriptViewportToLine(this.state.transcriptViewport, line);
        requestTUIContentRender(this.state);
        return;
      }
    }
    // Roughly map a transcript entry index to a scroll position. The viewport
    // is line-based; we approximate by scrolling to the entry proportionally.
    const total = this.state.transcriptEntries.length;
    if (total === 0) return;
    // Jump to bottom first, then up by the offset of entries after the target.
    this.state.transcriptViewport.scroll('bottom');
    const entriesAfter = total - 1 - index;
    // Each entry is at least one rendered line; scroll up by a few lines per
    // entry as a heuristic. The viewport clamps automatically.
    for (let i = 0; i < entriesAfter * 3; i++) {
      this.state.transcriptViewport.scroll('line-up');
    }
    requestTUIContentRender(this.state);
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
    this.sendMessageInternal(session, this.lastUserInput);
  }

  setLastTurnFailed(failed: boolean): void {
    this.lastTurnFailed = failed;
  }

  showHelpPanel(args = ''): void {
    const mode = this.helpModeFromArgs(args);
    this.state.activeDialog = 'help';
    this.mountEditorReplacement(
      new HelpPanelComponent({
        commands: this.getSlashCommands(mode),
        intro: mode === 'diagnostics'
          ? 'Advanced QA commands for SuperLiora harness development.'
          : mode === 'advanced'
            ? advancedHelpIntro()
          : undefined,
        commandSectionTitle: mode === 'diagnostics'
          ? 'Diagnostic commands'
          : mode === 'advanced'
            ? 'Advanced Ultrawork controls'
            : undefined,
        shortcuts: mode === 'advanced' ? advancedKeyboardShortcuts() : undefined,
        onClose: () => {
          this.hideHelpPanel();
        },
      }),
    );
  }

  private hideHelpPanel(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  showFileExplorer(): void {
    const workDir = this.state.appState.workDir;
    const listing = listProjectFiles(workDir);
    const nodes = buildFileTree(listing.paths);
    this.state.activeDialog = 'files';
    this.mountEditorReplacement(
      new FileExplorerComponent({
        workDir,
        nodes,
        truncated: listing.truncated,
        source: listing.source,
        onPick: (relativePath) => {
          this.hideFileExplorer();
          this.state.editor.insertTextAtCursor(`${relativePath} `);
          requestTUILayoutRender(this.state);
        },
        onPreview: (relativePath) => {
          this.showFileViewer(relativePath);
        },
        onClose: () => {
          this.hideFileExplorer();
        },
      }),
    );
  }

  private hideFileExplorer(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  /**
   * Handle files dropped onto the terminal via Kitty DnD protocol.
   * Opens the file explorer focused on the dropped file's directory.
   */
  private handleFileDrop(paths: readonly string[]): void {
    if (paths.length === 0) return;

    // Log the drop event
    this.activityFeed.push('file', `파일 드롭: ${paths.length}개 항목`, paths[0]);

    // If workspace is enabled, focus the file explorer panel
    if (this.workspaceController?.isEnabled()) {
      const fileExplorer = this.workspaceController.panelManager.getPanels().find(
        (p) => p.id === 'file-explorer',
      );
      if (fileExplorer) {
        this.workspaceController.panelManager.focusPanel(fileExplorer.instanceId);
        // Request render to show the focused panel
        this.state.ui.requestRender();
      }
    }
  }

  private lastDiffReport: GitDiffReport | undefined;
  private lastDiffFilter = '';

  showDiffReview(report: GitDiffReport, filter: string): void {
    this.lastDiffReport = report;
    this.lastDiffFilter = filter;
    this.state.activeDialog = 'diff-review';
    this.mountEditorReplacement(
      new DiffReviewComponent({
        report,
        filter,
        onOpenFile: (relativePath) => {
          this.hideDiffReview();
          this.showFileViewer(relativePath, () => {
            if (this.lastDiffReport !== undefined) {
              this.showDiffReview(this.lastDiffReport, this.lastDiffFilter);
            }
          });
        },
        onClose: () => {
          this.hideDiffReview();
        },
      }),
    );
  }

  private hideDiffReview(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  showCommitBrowser(report: GitLogReport, filter: string): void {
    this.state.activeDialog = 'commit-browser';
    this.mountEditorReplacement(
      new CommitBrowserComponent({
        report,
        filter,
        onOpenCommit: (commit) => {
          this.hideCommitBrowser();
          const files = collectCommitDiff(this.state.appState.workDir, commit.hash);
          if (files === null || files.length === 0) {
            this.showStatus(`No diff for ${commit.hash.slice(0, 7)}.`, 'warning');
            return;
          }
          const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
          const totalDeleted = files.reduce((sum, file) => sum + file.deleted, 0);
          this.showDiffReview(
            {
              branch: commit.hash.slice(0, 7),
              files,
              totalAdded,
              totalDeleted,
              truncated: false,
            },
            '',
          );
        },
        onClose: () => {
          this.hideCommitBrowser();
        },
      }),
    );
  }

  private hideCommitBrowser(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  showErrors(): void {
    if (this.state.activeDialog !== null) return;
    const items = collectTranscriptErrors(this.state.transcriptEntries);
    if (items.length === 0) {
      this.showStatus(ttui('tui.errors.empty'));
      return;
    }
    this.state.activeDialog = 'error-navigator';
    this.mountEditorReplacement(
      new ErrorNavigatorComponent({
        items,
        onSelect: (item) => {
          // Keep the dialog open so the user can jump to more errors; just
          // scroll the failing entry into view.
          this.scrollToTranscriptIndex(item.index);
        },
        onCancel: () => {
          this.hideErrorNavigator();
        },
      }),
    );
  }

  private hideErrorNavigator(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  showSearchResults(results: SearchResults): void {
    this.state.activeDialog = 'search';
    this.mountEditorReplacement(
      new SearchResultsComponent({
        results,
        onOpenMatch: (match) => {
          this.hideSearchResults();
          this.showFileViewer(
            match.path,
            () => {
              this.showSearchResults(results);
            },
            match.line,
          );
        },
        onClose: () => {
          this.hideSearchResults();
        },
      }),
    );
  }

  private hideSearchResults(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  private showFileViewer(
    relativePath: string,
    onViewerClose?: () => void,
    initialLine?: number,
  ): void {
    const result = loadFileForViewer(resolve(this.state.appState.workDir, relativePath));
    switch (result.kind) {
      case 'text': {
        this.state.activeDialog = 'file-viewer';
        this.mountEditorReplacement(
          new FileViewerComponent({
            relativePath,
            content: result.content,
            bytes: result.bytes,
            palette: currentTheme.palette,
            initialLine,
            onClose: () => {
              if (onViewerClose !== undefined) onViewerClose();
              else this.returnToFileExplorer();
            },
            onBlame: (blamePath) => {
              // showBlame() bails while a dialog is active, so tear the
              // viewer down first (same mechanics as hideFileExplorer).
              this.state.activeDialog = null;
              this.restoreEditor();
              this.showBlame(blamePath);
            },
          }),
        );
        return;
      }
      case 'binary':
        this.showStatus(`${relativePath} is binary — preview unavailable.`, 'warning');
        return;
      case 'too-large': {
        const mb = (result.bytes / 1024 / 1024).toFixed(1);
        this.showStatus(`${relativePath} is ${mb} MB — too large to preview.`, 'warning');
        return;
      }
      case 'error':
        this.showStatus(`${relativePath}: ${result.message}`, 'error');
        return;
    }
  }

  private returnToFileExplorer(): void {
    this.showFileExplorer();
  }

  showWebContent(rawUrl: string | undefined): void {
    if (this.state.activeDialog !== null) return;
    const target = (rawUrl ?? '').trim();
    if (target.length === 0) {
      this.showError(ttui('tui.web.usage'));
      return;
    }
    this.showStatus(ttui('tui.web.fetching', { url: target }));
    void (async () => {
      try {
        const content = await fetchWebContent(target);
        if (this.state.activeDialog !== null) return;
        this.state.activeDialog = 'file-viewer';
        this.mountEditorReplacement(
          new FileViewerComponent({
            relativePath: content.title ?? content.url,
            content: content.body,
            bytes: Buffer.byteLength(content.body, 'utf8'),
            palette: currentTheme.palette,
            onClose: () => {
              this.state.activeDialog = null;
              this.restoreEditor();
            },
          }),
        );
      } catch (error) {
        this.showError(formatErrorMessage(error));
      }
    })();
  }

  showBlame(rawPath: string | undefined): void {
    if (this.state.activeDialog !== null) return;
    const target = (rawPath ?? '').trim();
    if (target.length === 0) {
      this.showError(ttui('tui.blame.usage'));
      return;
    }
    this.showStatus(ttui('tui.blame.loading', { path: target }));
    void (async () => {
      try {
        const lines = await collectGitBlame(target, { cwd: this.state.appState.workDir });
        if (this.state.activeDialog !== null) return;
        this.state.activeDialog = 'blame';
        this.mountEditorReplacement(
          new BlamePanelComponent({
            lines,
            title: target,
            palette: currentTheme.palette,
            onClose: () => {
              this.state.activeDialog = null;
              this.restoreEditor();
            },
          }),
        );
      } catch (error) {
        this.showError(formatErrorMessage(error));
      }
    })();
  }

  private helpModeFromArgs(args: string): SlashCommandHelpMode {
    const normalized = args.trim().toLowerCase();
    if (normalized === 'diagnostics' || normalized === 'diagnostic' || normalized === 'internal') {
      return 'diagnostics';
    }
    return normalized === 'advanced' || normalized === 'manual' ? 'advanced' : 'primary';
  }

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

  async showSessionPicker(): Promise<void> {
    await this.openSessionPicker({
      applyStartupModes: false,
      closeOnCancel: false,
      forwardEditorExit: false,
    });
  }

  private async bootstrapFromPicker(): Promise<void> {
    await this.openSessionPicker({
      applyStartupModes: true,
      closeOnCancel: true,
      forwardEditorExit: true,
    });
  }

  private async openSessionPicker(options: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  }): Promise<void> {
    this.sessionPickerOptions = options;
    await this.fetchSessions('cwd');
    this.mountSessionPicker({
      applyStartupModes: options.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (options.closeOnCancel) void this.stop();
      },
      onCtrlC: options.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: options.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  private async toggleSessionPickerScope(selectedSessionId: string): Promise<void> {
    const requestToken = ++this.sessionPickerScopeRequestToken;
    const nextScope = this.state.sessionsScope === 'cwd' ? 'all' : 'cwd';
    await this.fetchSessions(nextScope);
    if (requestToken !== this.sessionPickerScopeRequestToken) return;
    if (this.state.activeDialog !== 'session-picker') return;
    this.mountSessionPicker({
      initialSelectedSessionId: selectedSessionId,
      applyStartupModes: this.sessionPickerOptions.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (this.sessionPickerOptions.closeOnCancel) void this.stop();
      },
      onCtrlC: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  hideSessionPicker(): void {
    this.sessionPickerScopeRequestToken += 1;
    this.editorKeyboard.clearPendingExit();
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  openUndoSelector(): void {
    void slashCommands.handleUndoCommand(this, '');
  }

  private mountSessionPicker(options: {
    readonly onCancel: () => void;
    readonly onCtrlC?: () => void;
    readonly onCtrlD?: () => void;
    readonly initialSelectedSessionId?: string;
    // CLI mode flags (--auto/--yolo/--plan) target the session picked at
    // startup (bare --session); later /sessions switches keep the picked
    // session's own persisted modes.
    readonly applyStartupModes?: boolean;
  }): void {
    this.state.activeDialog = 'session-picker';
    this.mountEditorReplacement(
      new SessionPickerComponent({
        sessions: this.state.sessions,
        loading: this.state.loadingSessions,
        currentSessionId: this.state.appState.sessionId,
        scope: this.state.sessionsScope,
        initialSelectedSessionId: options.initialSelectedSessionId,
        pageSize: 50,
        onSelect: (session: SessionRow) => {
          void this.handleSessionPickerSelect(session, options.applyStartupModes === true).catch(
            (error) => {
              this.showError(`Failed to apply startup flags: ${formatErrorMessage(error)}`);
            },
          );
        },
        onCancel: options.onCancel,
        onCtrlC: options.onCtrlC,
        onCtrlD: options.onCtrlD,
        onToggleScope: (selectedSessionId: string) => {
          void this.toggleSessionPickerScope(selectedSessionId);
        },
      }),
    );
  }

  private async handleSessionPickerSelect(
    session: SessionRow,
    applyStartupModes: boolean,
  ): Promise<void> {
    if (resolve(session.work_dir) !== resolve(this.state.appState.workDir)) {
      await this.showResumeOtherWorkDirHint(session);
      if (applyStartupModes) await this.stop(0);
      return;
    }

    const switched = await this.resumeSession(session.id);
    if (!switched) return;
    if (applyStartupModes) {
      await this.applyStartupModesToResumedSession(this.requireSession());
      this.applyStartupPermissionAndPlanToAppState();
    }
    this.hideSessionPicker();
  }

  private showApprovalPanel(payload: ApprovalPanelData): void {
    // If a command-driven dialog (API-key input, provider picker, …) owns the
    // editor area, defer the approval so we don't clobber the in-flight command
    // flow (BUG-7). It is shown once the dialog closes via restoreEditor().
    if (this.state.activeDialog === 'command') {
      this.deferredApproval = payload;
      return;
    }
    this.patchLivePane({ pendingApproval: { data: payload } });
    notifyUserAttentionOnce(this.state, `approval:${payload.id}`, {
      title: 'SuperLiora approval required',
      body: payload.tool_name,
    });
    const panel = new ApprovalPanelComponent(
      { data: payload },
      (response: ApprovalPanelResponse) => {
        this.approvalController.respond(adaptPanelResponse(response));
      },
      () => {
        this.toggleToolOutputExpansion();
      },
      (block) => {
        this.openApprovalPreview(panel, block);
      },
    );
    this.activeApprovalPanel = panel;
    this.mountEditorReplacement(panel);
  }

  private hideApprovalPanel(): void {
    // If the full-screen preview is open, fold it back first so the saved-
    // children stack stays consistent with what mountEditorReplacement set up.
    if (this.approvalPreview !== undefined) this.closeApprovalPreview();
    this.activeApprovalPanel = undefined;
    this.patchLivePane({ pendingApproval: null });
    this.restoreEditor();
  }

  // Mounts the full-screen approval preview viewer on top of the current
  // approval panel. Uses the same nested-takeover pattern as
  // openTaskOutputViewer: we snapshot the root container's children, swap
  // in the viewer, and restore on close. The approval panel instance is
  // kept around in `activeApprovalPanel` so its selection state survives.
  private openApprovalPreview(panel: ApprovalPanelComponent, block: ApprovalPreviewBlock): void {
    if (this.approvalPreview !== undefined) return;
    const savedChildren = [...this.state.ui.children];
    const viewer = new ApprovalPreviewViewer(
      {
        block,
        onClose: () => {
          this.closeApprovalPreview();
        },
      },
      this.state.terminal,
    );
    this.state.ui.clear();
    this.state.ui.addChild(viewer);
    this.state.ui.setFocus(viewer);
    requestTUILayoutRender(this.state);
    this.approvalPreview = { component: viewer, savedChildren, panel };
  }

  private closeApprovalPreview(): void {
    const preview = this.approvalPreview;
    if (preview === undefined) return;
    this.approvalPreview = undefined;
    this.state.ui.clear();
    for (const child of preview.savedChildren) {
      this.state.ui.addChild(child);
    }
    this.state.ui.setFocus(preview.panel);
    requestTUILayoutRender(this.state);
  }

  private showQuestionDialog(payload: QuestionPanelData): void {
    // Defer while a command-driven dialog is open (BUG-7, same as approval).
    if (this.state.activeDialog === 'command') {
      this.deferredQuestion = payload;
      return;
    }
    this.patchLivePane({ pendingQuestion: { data: payload } });
    notifyUserAttentionOnce(this.state, `question:${payload.id}`, {
      title: 'SuperLiora needs your answer',
      body: payload.questions[0]?.question,
    });
    const dialog = new QuestionDialogComponent(
      { data: payload },
      (response) => {
        this.questionController.respond(response);
      },
      6,
      () => {
        this.toggleToolOutputExpansion();
      },
    );
    this.mountEditorReplacement(dialog);
  }

  private hideQuestionDialog(): void {
    this.patchLivePane({ pendingQuestion: null });
    this.restoreEditor();
  }
}

function nativeRendererDiagnosticsOverlayEnabled(): boolean {
  return truthyEnv(process.env['SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS']);
}

function truthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

/** Footer mode badge toggles → plan_enter/exit + mode_enter/exit (ultrawork, swarm, yolo). */
function collectFooterModeBeats(
  prev: AppState,
  patch: Partial<AppState>,
): Array<{
  readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
  readonly title: string;
}> {
  const beats: Array<{
    readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
    readonly title: string;
  }> = [];
  if ('planMode' in patch && patch.planMode !== undefined && patch.planMode !== prev.planMode) {
    beats.push({ name: patch.planMode ? 'plan_enter' : 'plan_exit', title: 'plan' });
  }
  if (
    'ultraworkMode' in patch &&
    patch.ultraworkMode !== undefined &&
    patch.ultraworkMode !== prev.ultraworkMode
  ) {
    beats.push({
      name: patch.ultraworkMode ? 'mode_enter' : 'mode_exit',
      title: 'ultrawork',
    });
  }
  if ('swarmMode' in patch && patch.swarmMode !== undefined && patch.swarmMode !== prev.swarmMode) {
    beats.push({ name: patch.swarmMode ? 'mode_enter' : 'mode_exit', title: 'swarm' });
  }
  if (
    'permissionMode' in patch &&
    patch.permissionMode !== undefined &&
    patch.permissionMode !== prev.permissionMode
  ) {
    const wasYolo = prev.permissionMode === 'yolo';
    const nowYolo = patch.permissionMode === 'yolo';
    if (wasYolo !== nowYolo) {
      beats.push({ name: nowYolo ? 'mode_enter' : 'mode_exit', title: 'yolo' });
    }
  }
  return beats;
}
