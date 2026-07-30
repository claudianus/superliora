import { writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import chalk from 'chalk';
import {
  encodeNativeInputAsLegacySequence,
  encodeRendererClearInlineImages,
  LioraNativeRootUI,
  NativeTerminalSession,
  type Component,
  type Focusable,
  type NativeInputEvent,
  type NativeInputKey,
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
import type { TodoBoardScrollAction } from './components/chrome/todo-panel';
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
import { CommandHubComponent } from './components/dialogs/command-hub';
import { FileExplorerComponent } from './components/dialogs/file-explorer';
import { DiffReviewComponent } from './components/dialogs/diff-review';
import { CommitBrowserComponent } from './components/dialogs/commit-browser';
import { ErrorNavigatorComponent } from './components/dialogs/error-navigator';
import { FileViewerComponent } from './components/dialogs/file-viewer';
import { SearchResultsComponent } from './components/dialogs/search-results';
import { QuestionDialogComponent } from './components/dialogs/question-dialog';
import { SessionPickerComponent, type SessionRow } from './components/dialogs/session-picker';
import {
  SessionLoadingOverlayComponent,
  type SessionLoadingPhase,
} from './components/dialogs/session-loading-overlay';
import { AgentDashboardComponent } from './components/dialogs/agent-dashboard';
import { ExtensionsModalComponent } from './components/dialogs/extensions-modal';
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
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  type TuiConfig,
} from './config';
import {
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
import { DialogsController } from './controllers/dialogs';
import { MessageDispatchController } from './controllers/message-dispatch';
import { PanesController } from './controllers/panes';
import { SessionLifecycleController } from './controllers/session-lifecycle';
import { SessionReplayRenderer, type SessionReplayHost } from './controllers/session-replay';
import { StreamingUIController } from './controllers/streaming-ui';
import { TasksBrowserController } from './controllers/tasks-browser';
import { TranscriptRenderController } from './controllers/transcript-render';
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
import { refreshShikiPalette } from './components/media/shiki-ansi';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
import {
  appearanceAnimationNow,
  resolveUltraworkBorderGlowHex,
} from './utils/appearance-effects';
import { noteErrorFeedback } from './utils/feedback-vfx';
import {
  createTUIStateNativeInputRouter,
  type TUIStateNativeInputRouter,
} from './utils/native-input-router';
import {
  createTUIStateNativeRenderCallback,
} from './utils/native-layout-frame';
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
import { isDeadTerminalError } from './utils/dead-terminal';
import { DisposableRegistry } from './utils/disposables';
import { formatErrorMessage } from './utils/event-payload';
import { contextWorkingSetSnapshotFromLoopControl } from './utils/context-working-set';
import type { CenterModalMountOptions } from './utils/center-modal';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
  requestTUIScrollRender,
} from './utils/frame-render';
import { createMotionBeatController, isMotionTheatreActive } from './utils/motion-beats';
import { pickForegroundTasks } from './utils/foreground-task';
import { collectTranscriptErrors } from './utils/transcript-errors';
import { ImageAttachmentStore, type ImageAttachment } from './utils/image-attachment-store';
import { resolveImageProtocol } from './utils/image-protocol-detect';
import { hasPatchChanges } from './utils/object-patch';
import { PromptStash } from './utils/prompt-stash';
import { sessionRowsForPicker } from './utils/session-picker-rows';
import {
  dashboardRowsFromSessions,
  type DashboardSessionRow,
  type DashboardSessionStatus,
  type DashboardStatusHints,
} from './utils/agent-dashboard-rows';
import {
  resolveExtensionsTab,
  type ExtensionsSnapshot,
  type ExtensionsTabId,
} from './utils/extensions-rows';
import {
  buildClaudeImportPlan,
  formatClaudeImportSummary,
  resolveClaudeImportRoots,
  type ClaudeImportScanEntry,
} from './utils/claude-import';
import { combineStartupNotice, isOAuthLoginRequiredError } from './utils/startup';
import { installTerminalFocusTracking } from './utils/terminal-focus';
import { notifyUserAttentionOnce } from './utils/terminal-notification';
import { installTerminalThemeTracking } from './utils/terminal-theme';
import { detectTmuxKeyboardWarning } from './utils/tmux-keyboard';
import { getTranscriptComponentEntry, markTranscriptComponent } from './utils/transcript-component-metadata';
import { getTUIStateNativeTodoRect } from './utils/transcript-hit-test';
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
  readonly updateNotice?: { readonly currentVersion: string; readonly targetVersion: string; readonly installCommand: string };
  /** Optional session metadata (e.g. worktree) stamped on createSession. */
  readonly sessionMetadata?: import('@superliora/sdk').JsonObject;
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
  private readonly approvalController = new ApprovalController();
  private readonly questionController = new QuestionController();
  private readonly reverseRpcDisposers: Array<() => void> = [];
  skillCommands: readonly LioraSlashCommand[] = [];
  private pluginCommands: readonly LioraSlashCommand[] = [];
  readonly skillCommandMap = new Map<string, string>();
  readonly pluginCommandMap = new Map<string, string>();
  readonly imageStore = new ImageAttachmentStore();
  private fdPath: string | null = detectFdPath();
  private fdDownloadStarted = false;
  sessionEventUnsubscribe: (() => void) | undefined;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages = false;
  aborted = false;
  private terminalFocusTrackingDispose: (() => void) | undefined;
  private clipboardImageHintController: ClipboardImageHintController | undefined;
  private signalCleanupHandlers: Array<() => void> = [];
  private isShuttingDown = false;
  /** Central registry for timers, intervals, listeners, and watchers. */
  private readonly disposables = new DisposableRegistry();
  private eventLoopStarted = false;
  private startupNotice: string | undefined;
  /** Startup cinematic splash; disposed after play or on shutdown. */
  splash: SplashComponent | undefined;
  /** UI children saved while the full-screen splash owns the tree. */
  splashSavedChildren: (typeof this.state.ui.children)[number][] | undefined;
  /** While true, ambient schedule stays armed even if interaction gates pause it. */
  splashForcesAmbient = false;
  private lastHistoryContent: string | undefined;
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
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  nativeInputModalSequence = 0;
  centerModalSequence = 0;
  /** Live Command Hub instance while the center-modal stack owns it. */
  openCommandHub: CommandHubComponent | undefined;
  private nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();
  private readonly sessionStartTime = Date.now();

  /** Timer that auto-clears the one-shot "moved to background" footer hint. */
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;

  /** Last user-submitted text, for `/retry` / Hub → Chat → Retry. */
  lastUserInput: string | undefined;
  /** True when the most recent turn ended in an error; cleared on a clean turn. */
  private lastTurnFailed = false;

  // The currently-mounted approval panel, if any. Kept so the full-screen
  // preview viewer can restore focus to the exact same instance (and its
  // selection / feedback state) when it closes.
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
  // Deferred reverse-RPC payloads that arrived while a command-driven dialog
  // owned the editor area. Once the dialog closes (restoreEditor), the pending
  // approval/question is shown — preventing mid-flow clobbering (BUG-7).
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
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
    this.sessionReplay = new SessionReplayRenderer(this as unknown as SessionReplayHost);
    this.sessionLifecycle = new SessionLifecycleController(this);
    this.messageDispatch = new MessageDispatchController(this);
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

  getSlashCommands(mode: SlashCommandHelpMode = 'primary'): readonly LioraSlashCommand[] {
    const builtins = sortSlashCommands(BUILTIN_SLASH_COMMANDS).filter((command) =>
      isExperimentalFlagEnabled(command.experimentalFlag),
    );
    const visibleBuiltins = slashCommandsForHelp(builtins, mode);
    return mode === 'diagnostics'
      ? visibleBuiltins
      : [...visibleBuiltins, ...this.skillCommands, ...this.pluginCommands];
  }

  /** Lets controllers (e.g. `DialogsController`) run a slash command without importing `dispatch` themselves. */
  dispatchSlash(command: string): void {
    slashCommands.dispatchInput(this, command);
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

  async refreshSkillCommands(session?: SkillListSession): Promise<void> {
    if (session === undefined) {
      this.skillCommands = [];
      this.skillCommandMap.clear();
      this.setupAutocomplete();
      return;
    }

    let skills;
    try {
      skills = await session.listSkills();
    } catch {
      // Keep any previously loaded skills; still rebuild the provider so static
      // slash commands stay wired after a failed RPC.
      this.setupAutocomplete();
      return;
    }
    // Drop stale results if the active session rotated while listSkills was in flight.
    if (this.session !== undefined && session !== this.session) {
      this.setupAutocomplete();
      return;
    }

    const skillCommands = buildSkillSlashCommands(skills);
    // Cap the static slash menu so huge skill catalogs stay scannable; deeper
    // matches still arrive via dynamic `/skill:` search.
    const MAX_STATIC_SKILL_COMMANDS = 64;
    this.skillCommands = [...skillCommands.commands].slice(0, MAX_STATIC_SKILL_COMMANDS);
    this.skillCommandMap.clear();
    for (const [commandName, skillName] of skillCommands.commandMap) {
      if (this.skillCommands.some((cmd) => cmd.name === commandName)) {
        this.skillCommandMap.set(commandName, skillName);
      }
    }
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

  async refreshDynamicSlashCommands(session?: Session): Promise<void> {
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
    const trimmed = skillQuery.trim();
    let skills;
    try {
      // Bare `/skill:` (or whitespace-only) reuses listSkills so the menu can
      // surface activatable skills even when the static cache is still empty.
      skills =
        trimmed.length === 0
          ? await session.listSkills()
          : await session.searchSkills(trimmed, { limit: 12 });
    } catch {
      return [];
    }
    if (signal.aborted) return [];
    const skillCommands = buildSkillSlashCommands(skills);
    for (const [commandName, skillName] of skillCommands.commandMap) {
      this.skillCommandMap.set(commandName, skillName);
    }
    // Cap dynamic results so the autocomplete menu stays scannable.
    return skillCommands.commands.slice(0, 12);
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
        this.transcriptRender.renderWelcome();
        // Cinematic splash after the renderer loop is live, before Welcome.
        await this.transcriptRender.playStartupSplash();
        void this.loadBanner();
        this.startBackgroundFdAutocomplete();
        await this.finishStartup(shouldReplayHistory);
      } catch (error) {
        this.transcriptRender.disposeStartupSplash();
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
    if (!hasProvider) {
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
            'Text, image, and video generation enabled; harness tools run server-side on qwen3.7/3.8 models.',
          'success',
        );
      } else {
        // Route through the normal slash-command dispatch so /login's unified
        // provider picker opens on first run.
        slashCommands.dispatchInput(this, '/login');
        return;
      }
    }

    // One-shot Command Hub intro after login/provider is sorted.
    // Skip when the user already typed something — don't steal the prompt.
    const onboarding = this.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
    const editorBusy = (this.state.editor.getText?.() ?? '').trim().length > 0;
    if (!onboarding.hubIntroSeen && !editorBusy) {
      this.showCommandHub({ intro: true });
    }
  }

  private attachNativeRendererCallback(): void {
    if (!(this.state.ui instanceof LioraNativeRootUI)) return;
    const nativeRootUI = this.state.ui;
    if (this.nativeInputRouter !== undefined) {
      nativeRootUI.setInputRouter(this.nativeInputRouter.router);
    }
    const diagnosticsOverlay = () => this.nativeRendererDiagnosticsHudEnabled;
    nativeRootUI.setRenderCallback(
      createTUIStateNativeRenderCallback(this.state, {
        diagnosticsOverlay,
        onAuthoritativeFrame: () => {
          this.appearanceController.reapplyTerminalPalette();
        },
      }),
    );
    // Toasts must repaint on show/hide even while the transcript auto-frame
    // hold is active; 'manual' is exempt from that hold.
    this.state.toast.onChanged = () => {
      nativeRootUI.renderer.requestRender('manual');
    };
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
      scrollTodoPanel: (event) => this.scrollTodoPanelAtMouse(event),
      // App shortcuts (especially `?` → Hub) must run before native text mutation.
      handlePreEditorInput: (event) => {
        if (event.type !== 'key' || event.eventType === 'release') return false;
        // Alt+navigation scrolls the todo board while it overflows; when the
        // board cannot scroll the event keeps its previous editor meaning.
        if (event.alt && this.scrollTodoPanelByKey(event.key)) return true;
        const legacy = encodeNativeInputAsLegacySequence(event);
        if (legacy === undefined) return false;
        return this.state.editor.tryHandleAppShortcut?.(legacy) === true;
      },
    });
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
      // Cold-start resume: paint the premium loading modal as soon as the
      // splash yields so large histories never sit on a silent empty editor.
      const session = this.requireSession();
      const ownsColdStartOverlay = !this.isSessionLoadingOverlayActive();
      if (ownsColdStartOverlay) {
        this.beginSessionLoading(session.id, ttui('tui.sessionLoading.title'));
        this.reportSessionLoading({
          phase: 'loading',
          progress: 0.22,
          sessionId: session.id,
          detail: ttui('tui.sessionLoading.phase.loading'),
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      try {
        await this.sessionReplay.hydrateFromReplay(session);
        this.applyStartupPermissionAndPlanToAppState();
      } finally {
        // hydrate ends only when *it* opened the modal; we own this cold-start one.
        if (ownsColdStartOverlay) {
          this.endSessionLoading();
        }
      }
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
        this.showStatus('No goals in queue to resume.', 'textMuted');
        return;
      }

      // Remove the goal from the queue before starting it
      await removeGoalQueueItem(session, { goalId: firstGoal.id });

      // Start the goal using the goal command handler
      this.showStatus(`🎯 Resuming goal: ${firstGoal.objective.slice(0, 100)}...`, 'textMuted');

      // Send the goal objective as a user input to start the goal
      this.sendNormalUserInput(`/goal ${firstGoal.objective}`, {
        displayText: `🎯 ${firstGoal.objective.slice(0, 50)}...`,
      });
    } catch (error) {
      this.showStatus(`Failed to resume goal from queue: ${String(error)}`, 'error');
    }
  }

  async showSessionWarnings(session: Session): Promise<void> {
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
    if (this.options.sessionMetadata !== undefined) {
      createSessionOptions.metadata = this.options.sessionMetadata;
    }
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
    this.dialogs.stopSessionLoadingPulse();
    this.sessionLoadingOverlay = undefined;
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
    this.transcriptRender.disposeStartupSplash();
    this.appearanceController.dispose();
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
    this.panes.stopTerminalThemeTracking();
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
      this.state.terminal.rows,
      selection.isDragging || selection.hasSelection,
    );
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    const changed = applyTranscriptViewportScroll(this.state.transcriptViewport, action);
    if (changed) requestTUIScrollRender(this.state);
    return changed;
  }

  /**
   * Wheel scrolls that land on the todo board move the board's viewport.
   * Returns false when the pointer is outside the board or the board has
   * no overflow to scroll, so the transcript viewport keeps its current
   * behavior for every other wheel event.
   */
  private scrollTodoPanelAtMouse(event: NativeInputEvent): boolean {
    if (event.type !== 'mouse') return false;
    const rect = getTUIStateNativeTodoRect(this.state);
    if (rect === undefined) return false;
    if (
      event.x < rect.x ||
      event.x >= rect.x + rect.width ||
      event.y < rect.y ||
      event.y >= rect.y + rect.height
    ) {
      return false;
    }
    const action: TodoBoardScrollAction | undefined =
      event.button === 'wheel-up'
        ? 'line-up'
        : event.button === 'wheel-down'
          ? 'line-down'
          : undefined;
    if (action === undefined) return false;
    if (!this.state.todoPanel.scrollBoard(action)) return false;
    requestTUILayoutRender(this.state);
    return true;
  }

  /**
   * Alt+↑/↓ scrolls the board one row; Alt+PageUp/PageDown page it;
   * Alt+Home/End jump to the edges. Only consumed while the board actually
   * moves, so unbound alt keys keep reaching the editor untouched.
   */
  private scrollTodoPanelByKey(key: NativeInputKey): boolean {
    let action: TodoBoardScrollAction | undefined;
    switch (key) {
      case 'up':
        action = 'line-up';
        break;
      case 'down':
        action = 'line-down';
        break;
      case 'pageup':
        action = 'page-up';
        break;
      case 'pagedown':
        action = 'page-down';
        break;
      case 'home':
        action = 'top';
        break;
      case 'end':
        action = 'bottom';
        break;
      default:
        return false;
    }
    if (!this.state.todoPanel.scrollBoard(action)) return false;
    requestTUILayoutRender(this.state);
    return true;
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
    this.messageDispatch.handleUserInput(text);
  }

  dispatchSlashInput(text: string): void {
    slashCommands.dispatchInput(this, text);
  }

  runShellCommandFromInput(command: string): void {
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
    this.messageDispatch.sendNormalUserInput(text, options);
  }

  supportsCurrentModelCapability(capability: string): boolean {
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

  async persistInputHistory(text: string): Promise<void> {
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
    this.messageDispatch.sendQueuedMessage(session, item);
  }

  requestQueuedGoalPromotion(): void {
    this.sessionEventHandler.requestQueuedGoalPromotion();
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    this.messageDispatch.sendSkillActivation(session, skillName, skillArgs);
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

  steerMessage(session: Session, input: string[]): void {
    this.messageDispatch.steerMessage(session, input);
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
    const goalChanged = 'goal' in patch;
    const modeBeats = collectFooterModeBeats(this.state.appState, patch);
    Object.assign(this.state.appState, patch);
    if ('planMode' in patch || 'ultraworkMode' in patch) this.updateEditorBorderHighlight();
    if ('appearance' in patch) this.appearanceController.apply();
    if (
      this.openCommandHub !== undefined &&
      ('planMode' in patch ||
        'swarmMode' in patch ||
        'ultraworkMode' in patch ||
        'premiumQualityMode' in patch ||
        'permissionMode' in patch ||
        'model' in patch ||
        'thinkingLevel' in patch ||
        'streamingPhase' in patch ||
        'isCompacting' in patch)
    ) {
      this.dialogs.refreshOpenCommandHub();
    }
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
    if (goalChanged) {
      this.syncGoalMonitorPanel();
    }
    this.updateActivityPane();
    if (busyChanged) {
      this.updateQueueDisplay();
      this.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (additionalDirsChanged) this.setupAutocomplete();
    if (becameIdle) this.promptIntelligence.notifyIdle();
    requestTUIContentRender(this.state);
  }

  /**
   * Keep the chrome todo/goal panel mounted for live goals even when the
   * TodoList is empty, and unmount when both are gone.
   */
  syncGoalMonitorPanel(): void {
    this.state.todoPanel.setGoal(this.state.appState.goal);
    this.state.todoPanelContainer.clear();
    if (!this.state.todoPanel.isEmpty()) {
      this.state.todoPanelContainer.addChild(this.state.todoPanel);
    }
    requestTUILayoutRender(this.state);
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
    if (this.state.appState.isReplaying || this.isSessionLoadingOverlayActive()) {
      this.showError(ttui('tui.sessionLoading.busy'));
      return false;
    }

    this.beginSessionLoading(targetSessionId);
    this.reportSessionLoading({
      phase: 'loading',
      progress: 0.2,
      detail: ttui('tui.sessionLoading.phase.loading'),
      sessionId: targetSessionId,
    });
    let session: Session;
    try {
      session = await this.harness.resumeSession({ id: targetSessionId });
    } catch (error) {
      this.endSessionLoading();
      const msg = formatErrorMessage(error);
      this.showError(`Failed to resume session ${targetSessionId}: ${msg}`);
      return false;
    }

    try {
      await this.switchToSession(session, `Resumed session (${session.id}).`);
      return true;
    } finally {
      this.endSessionLoading();
    }
  }

  async switchToSession(session: Session, statusMessage: string): Promise<void> {
    return this.sessionLifecycle.switchToSession(session, statusMessage);
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
  private scrollToTranscriptIndex(index: number): void {
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
    if (this.state.appState.isReplaying || this.isSessionLoadingOverlayActive()) {
      this.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    void this.runWithBusyOverlay(
      {
        title: ttui('tui.sessionLoading.scanning'),
        detail: ttui('tui.sessionLoading.scanning'),
        phase: 'working',
      },
      async () => {
        const workDir = this.state.appState.workDir;
        // Paint overlay before the sync FS walk blocks the event loop.
        await new Promise<void>((resolve) => setImmediate(resolve));
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
      },
    );
  }

  private hideFileExplorer(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
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

  helpModeFromArgs(args: string): SlashCommandHelpMode {
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
  /** Editor-area modal while resume RPC + history hydrate run. */
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  sessionLoadingPulseTimer: ReturnType<typeof setInterval> | undefined;

  async showSessionPicker(): Promise<void> {
    if (this.state.appState.isReplaying || this.isSessionLoadingOverlayActive()) {
      this.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    await this.openSessionPicker({
      applyStartupModes: false,
      closeOnCancel: false,
      forwardEditorExit: false,
    });
  }

  /**
   * Agent Dashboard MVP — groups sessions into 입력 필요 / 작업 중 / 대기.
   * Enter attaches (resume) the selected session. last_prompt is masked.
   */
  async showAgentDashboard(): Promise<void> {
    if (this.state.appState.isReplaying || this.isSessionLoadingOverlayActive()) {
      this.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    this.state.loadingSessions = true;
    let summaries: Awaited<ReturnType<LioraHarness['listSessions']>> = [];
    try {
      summaries = await this.runWithBusyOverlay(
        {
          title: ttui('tui.sessionLoading.dashboard'),
          detail: ttui('tui.sessionLoading.dashboard'),
          phase: 'working',
        },
        async () => this.harness.listSessions({ workDir: this.state.appState.workDir }),
      );
      // Keep session-picker cache in sync for other dialogs.
      this.state.sessions = sessionRowsForPicker(
        summaries,
        this.state.appState.sessionId,
        this.hasSessionContent(),
      );
    } catch {
      this.state.sessions = [];
      this.showStatus(ttui('tui.sessions.fetchFailed'), 'warning');
    } finally {
      this.state.loadingSessions = false;
    }

    const statusHints = this.buildDashboardStatusHints(summaries.map((s) => s.id));
    const rows = dashboardRowsFromSessions(summaries, {
      currentSessionId: this.state.appState.sessionId,
      currentSessionHasContent: this.hasSessionContent(),
      statusHints,
    });

    this.state.activeDialog = 'agent-dashboard';
    this.mountEditorReplacement(
      new AgentDashboardComponent({
        sessions: rows,
        loading: false,
        currentSessionId: this.state.appState.sessionId,
        onSelect: (session: DashboardSessionRow) => {
          void this.handleAgentDashboardSelect(session).catch((error) => {
            this.showError(`세션 연결 실패: ${formatErrorMessage(error)}`);
          });
        },
        onCancel: () => {
          this.hideAgentDashboard();
        },
      }),
    );
  }

  hideAgentDashboard(): void {
    if (this.state.activeDialog === 'agent-dashboard') {
      this.state.activeDialog = null;
    }
    this.editorKeyboard.clearPendingExit();
    this.restoreEditor();
  }

  /**
   * AC6 Extensions modal — plugins / hooks / skills / MCP tabs + Claude import.
   * Claude import is allowlist-only (.claude / ~/.claude); no permission bypass.
   */
  async showExtensionsModal(args?: string): Promise<void> {
    const raw = (args ?? '').trim().toLowerCase();
    if (raw === 'claude' || raw === 'import-claude' || raw === 'import') {
      await this.runClaudeImportInventory();
      return;
    }

    const initialTab: ExtensionsTabId = resolveExtensionsTab(raw);

    let snapshot: ExtensionsSnapshot = { plugins: [], skills: [], mcpServers: [] };
    try {
      const session = this.requireSession();
      snapshot = await this.runWithBusyOverlay(
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
      this.showError(`확장 목록 불러오기 실패: ${formatErrorMessage(error)}`);
      // Still open empty modal so operators can reach Claude import (i).
    }

    this.mountCenterModal(
      new ExtensionsModalComponent({
        snapshot,
        initialTab,
        onAction: (action) => {
          void this.handleExtensionsAction(action).catch((error) => {
            this.showError(`확장 동작 실패: ${formatErrorMessage(error)}`);
          });
        },
        onCancel: () => {
          this.hideExtensionsModal();
        },
      }),
      { mode: 'replace' },
    );
    this.state.activeDialog = 'extensions';
  }

  hideExtensionsModal(): void {
    if (this.state.activeDialog === 'extensions') {
      this.state.activeDialog = null;
    }
    this.editorKeyboard.clearPendingExit();
    if (this.state.centerModalStack.length > 0) {
      this.closeAllCenterModals();
      return;
    }
    this.restoreEditor();
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
        await slashCommands.handlePluginsCommand(this, '');
        return;
      case 'open-mcp':
        this.hideExtensionsModal();
        // MCP management lives under plugins panel today.
        await slashCommands.handlePluginsCommand(this, '');
        return;
      case 'import-claude':
        this.hideExtensionsModal();
        await this.runClaudeImportInventory();
        return;
      case 'activate-skill': {
        this.hideExtensionsModal();
        const name = action.skillName.trim();
        if (name.length === 0) return;
        // Invoke skill via slash path without elevating permissions.
        this.sendNormalUserInput(`/${name}`, { displayText: `/${name}` });
        return;
      }
      case 'noop':
        return;
    }
  }

  /**
   * Scan allowlisted Claude roots and print inventory only.
   * Does not apply settings or bypass deny chains (FedRAMP AC6).
   */
  private async runClaudeImportInventory(): Promise<void> {
    const workDir = this.state.appState.workDir;
    const roots = resolveClaudeImportRoots(workDir);
    const entries: ClaudeImportScanEntry[] = [];

    const nodeFs = await import('node:fs');
    const nodePath = await import('node:path');
    const readdirSync = nodeFs.readdirSync.bind(nodeFs);
    const statSync = nodeFs.statSync.bind(nodeFs);
    const join = nodePath.join.bind(nodePath);
    const relative = nodePath.relative.bind(nodePath);

    const walk = (
      rootPath: string,
      rootKind: 'project' | 'global',
      maxDepth: number,
      depth = 0,
    ): void => {
      if (depth > maxDepth) return;
      let dirents: import('node:fs').Dirent[];
      try {
        dirents = readdirSync(rootPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (dirent.name === '.' || dirent.name === '..') continue;
        // Skip obvious secret / env files during inventory.
        if (
          /^\.env/i.test(dirent.name) ||
          /\.(pem|key|p12|pfx)$/i.test(dirent.name)
        ) {
          continue;
        }
        const absolutePath = join(rootPath, dirent.name);
        let isDir = dirent.isDirectory();
        if (!isDir && !dirent.isFile()) {
          try {
            isDir = statSync(absolutePath).isDirectory();
          } catch {
            continue;
          }
        }
        if (isDir) {
          walk(absolutePath, rootKind, maxDepth, depth + 1);
          continue;
        }
        entries.push({
          absolutePath,
          // Classify against root-relative path so global ~/.claude entries work.
          relativePath: relative(rootPath, absolutePath),
          rootKind,
        });
      }
    };

    for (const root of roots) {
      walk(root.path, root.kind, 3);
    }

    const plan = buildClaudeImportPlan(workDir, entries);
    const summary = formatClaudeImportSummary(plan);
    // Multi-line detail in transcript-friendly status path (paths/counts only).
    for (const line of summary.split('\n')) {
      if (line.trim().length > 0) this.showStatus(line, 'textMuted');
    }
  }

  private buildDashboardStatusHints(
    sessionIds: readonly string[],
  ): DashboardStatusHints {
    const hints: Record<string, DashboardSessionStatus> = {};
    const currentId = this.state.appState.sessionId;
    for (const id of sessionIds) {
      if (id !== currentId) continue;
      if (this.state.livePane.pendingApproval !== null) {
        hints[id] = 'needs_input';
      } else if (this.state.appState.streamingPhase !== 'idle') {
        hints[id] = 'working';
      } else {
        hints[id] = 'idle';
      }
    }
    return hints;
  }

  private async handleAgentDashboardSelect(session: DashboardSessionRow): Promise<void> {
    // Reuse session-picker attach path: workdir check + resume.
    const asRow: SessionRow = {
      id: session.id,
      title: session.title,
      last_prompt: session.last_prompt,
      work_dir: session.work_dir,
      updated_at: session.updated_at,
      metadata: session.metadata,
    };
    if (resolve(session.work_dir) !== resolve(this.state.appState.workDir)) {
      await this.showResumeOtherWorkDirHint(asRow);
      return;
    }
    const switched = await this.resumeSession(session.id);
    if (!switched) return;
    this.hideAgentDashboard();
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
    if (this.state.appState.isReplaying || this.isSessionLoadingOverlayActive()) {
      this.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
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
    if (this.state.centerModalStack.length > 0) {
      this.closeAllCenterModals();
      return;
    }
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
    this.mountCenterModal(
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
        onRename: (session: SessionRow, newTitle: string) =>
          this.renameSessionFromPicker(session, newTitle),
        onToggleScope: (selectedSessionId: string) => {
          void this.toggleSessionPickerScope(selectedSessionId);
        },
      }),
      { mode: 'replace' },
    );
    this.state.activeDialog = 'session-picker';
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

  /**
   * Rename a session straight from the picker (Ctrl+R). Mirrors the `/title`
   * command's cap and error handling, then patches the cached picker rows so
   * the new title shows without a refetch. Rethrows so the picker keeps the
   * old title on failure.
   */
  private async renameSessionFromPicker(session: SessionRow, newTitle: string): Promise<void> {
    const title = newTitle.slice(0, 200);
    try {
      await this.harness.renameSession({ id: session.id, title });
    } catch (error) {
      this.showError(`Failed to rename session: ${formatErrorMessage(error)}`);
      throw error;
    }
    const index = this.state.sessions.findIndex((row) => row.id === session.id);
    if (index >= 0) {
      const previous = this.state.sessions[index];
      if (previous !== undefined) {
        this.state.sessions[index] = { ...previous, title };
      }
    }
    if (session.id === this.state.appState.sessionId) {
      this.setAppState({ sessionTitle: title });
      this.updateTerminalTitle();
    }
    this.showStatus(`Session renamed to: ${title}`);
  }

  showApprovalPanel(payload: ApprovalPanelData): void {
    // If a command-driven dialog (API-key input, provider picker, …) owns the
    // editor area, defer the approval so we don't clobber the in-flight command
    // flow (BUG-7). It is shown once the dialog closes via restoreEditor().
    if (
      this.state.activeDialog === 'command' ||
      this.state.activeDialog === 'center-modal' ||
      this.state.centerModalStack.length > 0
    ) {
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
        // Recover plan text from numbered brief when present so L12: comments enrich.
        const planFromDisplay = payload.display
          .filter((block): block is { type: 'brief'; text: string } => block.type === 'brief')
          .map((block) => block.text)
          .join('\n');
        this.approvalController.respond(
          adaptPanelResponse(response, {
            plan: planFromDisplay.length > 0 ? planFromDisplay : undefined,
          }),
        );
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

  showQuestionDialog(payload: QuestionPanelData): void {
    // Defer while a command-driven dialog is open (BUG-7, same as approval).
    if (
      this.state.activeDialog === 'command' ||
      this.state.activeDialog === 'center-modal' ||
      this.state.centerModalStack.length > 0
    ) {
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
