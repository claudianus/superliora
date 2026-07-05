import { writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  detectNativeTerminalImageProtocol,
  encodeRendererClearInlineImages,
  LioraNativeRootUI,
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
  PromptPart,
  Session,
} from '@superliora/sdk';
import { resolve } from 'pathe';

import type { CLIOptions } from '#/cli/options';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import { appendInputHistory, loadInputHistory } from '#/utils/history/input-history';
import { openUrl } from '#/utils/open-url';
import { getInputHistoryFile } from '#/utils/paths';
import { detectFdPath, ensureFdPath } from '#/utils/process/fd-detect';
import { quoteShellArg } from '#/utils/shell-quote';

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
import { WelcomeComponent } from './components/chrome/welcome';
import { pickRandomWorkingTip } from './components/chrome/working-tips';
import {
  ApprovalPanelComponent,
  type ApprovalPanelResponse,
} from './components/dialogs/approval-panel';
import {
  ApprovalPreviewViewer,
  type ApprovalPreviewBlock,
} from './components/dialogs/approval-preview';
import { CompactionComponent } from './components/dialogs/compaction';
import {
  ADVANCED_HELP_INTRO,
  ADVANCED_KEYBOARD_SHORTCUTS,
  HelpPanelComponent,
} from './components/dialogs/help-panel';
import { QuestionDialogComponent } from './components/dialogs/question-dialog';
import { SessionPickerComponent, type SessionRow } from './components/dialogs/session-picker';
import {
  FileMentionProvider,
  type SlashAutocompleteCommand,
} from './components/editor/file-mention-provider';

import { AssistantMessageComponent } from './components/messages/assistant-message';
import { BackgroundAgentStatusComponent } from './components/messages/background-agent-status';
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
import { QueuePaneComponent } from './components/panes/queue-pane';
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
import { SessionEventHandler } from './controllers/session-event-handler';
import { SessionReplayRenderer } from './controllers/session-replay';
import { StreamingUIController } from './controllers/streaming-ui';
import { TasksBrowserController } from './controllers/tasks-browser';
import { adaptPanelResponse } from './reverse-rpc/approval/adapter';
import { ApprovalController } from './reverse-rpc/approval/controller';
import { createApprovalRequestHandler } from './reverse-rpc/approval/handler';
import { registerReverseRPCHandlers } from './reverse-rpc/index';
import { QuestionController } from './reverse-rpc/question/controller';
import { createQuestionAskHandler } from './reverse-rpc/question/handler';
import type { ApprovalPanelData, QuestionPanelData } from './reverse-rpc/types';
import { currentTheme, getColorPalette, getBuiltInPalette, isBuiltInTheme } from './theme';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
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
  type TranscriptEntry,
  type TUIStartupOptions,
  type TUIStartupState,
} from './types';
import { hasDispose, isExpandable } from './utils/component-capabilities';
import { isDeadTerminalError } from './utils/dead-terminal';
import { formatErrorMessage } from './utils/event-payload';
import { pickForegroundTasks } from './utils/foreground-task';
import { ImageAttachmentStore, type ImageAttachment } from './utils/image-attachment-store';
import { extractMediaAttachments } from './utils/image-placeholder';
import { hasPatchChanges } from './utils/object-patch';
import { sessionRowsForPicker } from './utils/session-picker-rows';
import { combineStartupNotice, isOAuthLoginRequiredError } from './utils/startup';
import { installTerminalFocusTracking } from './utils/terminal-focus';
import { notifyUserAttentionOnce } from './utils/terminal-notification';
import { installTerminalThemeTracking } from './utils/terminal-theme';
import { detectTmuxKeyboardWarning } from './utils/tmux-keyboard';
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
  const startupPermission: PermissionMode = input.cliOptions.auto
    ? 'auto'
    : input.cliOptions.yolo
      ? 'yolo'
      : 'manual';
  return {
    model: '',
    workDir: input.workDir,
    additionalDirs: [...(input.additionalDirs ?? [])],
    sessionId: '',
    permissionMode: startupPermission,
    planMode: input.cliOptions.plan,
    ultraworkMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    activityTip: null,
    theme: input.tuiConfig.theme,
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
  private eventLoopStarted = false;
  private startupNotice: string | undefined;
  private lastActivityMode: string | undefined;
  private currentLoadingTip: { kind: LoadingTipKind; tip: string | undefined; pinned: boolean } | undefined =
    undefined;
  private lastHistoryContent: string | undefined;
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
  readonly editorKeyboard: EditorKeyboardController;
  private nativeInputRouter: TUIStateNativeInputRouter | undefined;
  private nativeInputModalDispose: (() => void) | undefined;
  private nativeInputModalSequence = 0;
  private nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();

  /** Timer that auto-clears the one-shot "moved to background" footer hint. */
  private detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;

  // The currently-mounted approval panel, if any. Kept so the full-screen
  // preview viewer can restore focus to the exact same instance (and its
  // selection / feedback state) when it closes.
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
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
      },
    };
    this.options = tuiOptions;
    this.startupNotice = startupInput.startupNotice;
    this.state = createTUIState(tuiOptions);

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
        this.state.renderer.requestRender();
      },
      shouldRenderAnimation: () => this.shouldRenderAmbientAnimationFrame(),
    });
    this.btwPanelController = new BtwPanelController(this);
    this.sessionEventHandler = new SessionEventHandler(this);
    this.sessionReplay = new SessionReplayRenderer(this);
    this.tasksBrowserController = new TasksBrowserController(this);
    this.editorKeyboard = new EditorKeyboardController(this, this.imageStore);
    this.editorKeyboard.install();
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
        this.startBackgroundFdAutocomplete();
        await this.finishStartup(shouldReplayHistory);
      } catch (error) {
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
    this.state.ui.requestRender();

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

    // Mount only after init() succeeds; see mountFooter().
    this.mountFooter();
    this.renderWelcome();
    void this.loadBanner();
    this.setupAutocomplete();
    void this.loadPersistedInputHistory();
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.state.ui.setFocus(this.state.editor);
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();
    return shouldReplayHistory;
  }

  private attachNativeRendererCallback(): void {
    if (!(this.state.ui instanceof LioraNativeRootUI)) return;
    if (this.nativeInputRouter !== undefined) {
      this.state.ui.setInputRouter(this.nativeInputRouter.router);
    }
    const diagnosticsOverlay = () => this.nativeRendererDiagnosticsHudEnabled;
    this.state.ui.setRenderCallback(
      createTUIStateNativeRenderCallback(this.state, { diagnosticsOverlay }),
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

  private startEventLoop(): void {
    this.state.renderer.start();
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

    this.state.renderer.requestRender(true);
    this.showStatus(`Native renderer diagnostics HUD: ${enabled ? 'ON' : 'OFF'}.`);
  }

  private nativeRendererDiagnosticsSnapshot() {
    return this.state.renderer.nativeRuntime?.diagnostics;
  }

  private resetNativeRendererDiagnostics(): boolean {
    const renderer = this.state.renderer.nativeRuntime;
    if (renderer === undefined) return false;
    renderer.resetStats();
    this.state.renderer.requestRender(true);
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
    this.state.renderer.requestRender(true);
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
        this.state.renderer.requestRender();
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
    const warning = await detectTmuxKeyboardWarning();
    if (warning === undefined || this.aborted) return;
    this.showStatus(warning, 'warning');
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
      permission: startup.auto ? 'auto' : startup.yolo ? 'yolo' : undefined,
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
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
    this.reverseRpcDisposers.length = 0;
    this.disposeTerminalTracking();
    this.appearanceController.dispose();
    await this.closeSession('shutting down');
    await this.harness.close();
    this.sessionEventHandler.stopAllMcpServerStatusSpinners();
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

    const signals: NodeJS.Signals[] = ['SIGTERM'];
    if (process.platform !== 'win32') {
      signals.push('SIGHUP');
    }

    for (const signal of signals) {
      const handler = (): void => {
        if (signal === 'SIGHUP') {
          this.emergencyTerminalExit();
          return;
        }
        // Registering a SIGTERM listener disables Node's default exit(143),
        // so we must reinstate it after stop() or on failure.
        this.stop(143).then(
          () => {
            process.exit(143);
          },
          () => {
            this.emergencyTerminalExit(143);
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
    process.exit(exitCode);
  }

  private disposeTerminalTracking(): void {
    this.stopNativeRendererAdapters();
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
    return shouldRenderAmbientAnimationFrame(
      this.state.transcriptViewport.followOutput,
      this.state.terminal.rows,
    );
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    const changed = applyTranscriptViewportScroll(this.state.transcriptViewport, action);
    if (changed) this.state.renderer.requestRender('transcript-scroll');
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
    if (this.state.ui.children.includes(this.state.footerContainer)) return;
    this.state.ui.addChild(this.state.footerContainer);
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
    // Shell commands (`! …`) are not prompts — keep them out of input history
    // so ↑ recall never surfaces a bare command stripped of its `!`.
    if (!wasBashMode) {
      void this.persistInputHistory(text);
    }
    if (wasBashMode) {
      // Only one foreground action at a time: queue the shell command while
      // another shell command is running or an agent turn is in progress.
      if (this.state.appState.streamingPhase !== 'idle') {
        this.enqueueMessage(text, undefined, 'bash');
        this.updateQueueDisplay();
        this.state.ui.requestRender();
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
      this.state.ui.requestRender();
    });
    this.shellOutputStreams.set(commandId, { entry: outputEntry, component: outputComponent });
    this.state.transcriptEntries.push(outputEntry);
    markTranscriptComponent(outputComponent, outputEntry);
    this.state.transcriptContainer.addChild(outputComponent);
    // Treat command execution as a streaming phase so input queues, the activity
    // pane shows the moon spinner, and ctrl+b is enabled while it runs.
    this.setAppState({ streamingPhase: 'shell' });
    this.state.ui.requestRender();

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
    this.state.ui.requestRender();
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
      for (const entry of entries) {
        this.state.editor.addToHistory(entry.content);
      }
      this.lastHistoryContent = entries.at(-1)?.content;
    } catch {
      // best-effort
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
    } catch {
      this.lastHistoryContent = trimmed;
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
    });

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
    Object.assign(this.state.appState, patch);
    if ('planMode' in patch || 'ultraworkMode' in patch) this.updateEditorBorderHighlight();
    if ('appearance' in patch) this.appearanceController.apply();
    this.state.footer.setState(this.state.appState);
    this.updateActivityPane();
    if (busyChanged) {
      this.updateQueueDisplay();
      this.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (additionalDirsChanged) this.setupAutocomplete();
    this.state.ui.requestRender();
  }

  patchLivePane(patch: Partial<LivePaneState>): void {
    if (!hasPatchChanges(this.state.livePane, patch)) return;
    Object.assign(this.state.livePane, patch);
    this.updateActivityPane();
    this.state.ui.requestRender();
  }

  resetLivePane(): void {
    this.state.livePane = { ...INITIAL_LIVE_PANE };
    this.updateActivityPane();
    this.state.ui.requestRender();
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
      swarmMode: status.swarmMode ?? false,
      contextTokens: status.contextTokens,
      maxContextTokens: status.maxContextTokens,
      contextUsage: status.contextUsage,
      providerRouteStatus: status.providerRouteStatus ?? null,
      sessionTitle: session.summary?.title ?? null,
      goal: goalResult.goal,
    });
    this.syncAdditionalDirs(session);
  }

  // Apply --auto/--yolo/--plan startup flags to a resumed session. The resumed
  // session may already be in plan mode from its persisted records, and
  // re-entering plan mode throws, so only enable it when it is not active yet.
  // setPermission is idempotent and needs no such guard.
  private async applyStartupModesToResumedSession(session: Session): Promise<void> {
    const { startup } = this.options;
    if (startup.auto) {
      await session.setPermission('auto');
    } else if (startup.yolo) {
      await session.setPermission('yolo');
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
      /* silently ignore */
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
    if (targetSessionId === this.state.appState.sessionId) {
      this.showStatus('Already on this session.');
      return true;
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
    await this.setSession(session);
    this.setAppState({ sessionId: session.id });
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
    this.clearTranscriptAndRedraw();
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
        return new UserMessageComponent(entry.content, images, entry.bullet);
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
      this.state.ui.requestRender();
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
      this.state.transcriptContainer.children.some((child) => child instanceof WelcomeComponent)
    ) {
      return;
    }
    const welcome = new WelcomeComponent(this.state.appState);
    this.state.transcriptContainer.addChild(welcome);
  }

  private clearTerminalInlineImages(): void {
    const sequence = encodeRendererClearInlineImages(
      detectNativeTerminalImageProtocol(process.env),
    );
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
    this.btwPanelController.clear();
    this.clearTerminalInlineImages();
    this.state.todoPanel.clear();
    this.state.todoPanelContainer.clear();
    this.imageStore.clear();
    this.renderWelcome();
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
    this.state.ui.requestRender();
  }

  showNotice(title: string, detail?: string): void {
    this.state.transcriptContainer.addChild(new NoticeMessageComponent(title, detail));
    this.state.ui.requestRender();
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
    this.state.ui.requestRender();
    return {
      stop: ({ ok, label: finalLabel }) => {
        spinner.stop();
        const tone = ok ? 'success' : 'error';
        const symbol = ok ? '✓' : '✗';
        spinner.setText(currentTheme.fg(tone, `${symbol} ${finalLabel}`));
        this.state.ui.requestRender();
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
    this.state.ui.requestRender();
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
        const previousTip = this.currentLoadingTip?.tip;
        this.currentLoadingTip = {
          kind: tipKind,
          tip: pickRandomWorkingTip(previousTip)?.text,
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
        this.state.ui.requestRender();
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
        break;
      }
      case 'composing': {
        const spinner = this.ensureActivitySpinner('braille', 'working...', (s) =>
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
    this.state.ui.requestRender();
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
    if (queued.length === 0) return;

    this.state.queueContainer.addChild(
      new QueuePaneComponent({
        messages: queued,
        isCompacting: this.state.appState.isCompacting,
        isStreaming: this.state.appState.streamingPhase !== 'idle',
        canSteerImmediately: !this.deferUserMessages,
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
    this.state.ui.requestRender();
  }

  toggleTodoPanelExpansion(): void {
    this.state.todoPanel.toggleExpanded();
    this.state.ui.requestRender();
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
    this.showDetachHint('Moved to background. /tasks to view.');
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
    this.detachHintClearTimer = setTimeout(() => {
      this.detachHintClearTimer = undefined;
      // Don't clobber a newer transient hint (e.g. the exit-confirmation
      // prompt) that took over while this timer was pending.
      if (this.state.footer.getTransientHint() !== hint) return;
      this.state.footer.setTransientHint(null);
      this.state.ui.requestRender();
    }, DETACH_HINT_DISPLAY_MS);
    this.state.ui.requestRender();
  }

  updateEditorBorderHighlight(text?: string): void {
    const trimmed = (text ?? this.state.editor.getText()).trimStart();
    const isBash = this.state.appState.inputMode === 'bash';
    const highlighted =
      this.state.appState.planMode ||
      (this.state.appState.ultraworkMode ?? false) ||
      isBash ||
      trimmed.startsWith('/');
    this.state.editor.borderHighlighted = highlighted;
    // Shell mode gets its own hue; plan-mode and slash context stay primary.
    const borderToken = isBash ? 'shellMode' : highlighted ? 'primary' : 'border';
    this.state.editor.borderColor = (s: string) => currentTheme.fg(borderToken, s);
    this.state.ui.requestRender();
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
    this.state.ui.requestRender(true);
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
    this.state.ui.requestRender(true);
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
    this.state.ui.requestRender();
  }

  restoreEditor(): void {
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.state.ui.setFocus(this.state.editor);
    this.nativeInputModalDispose?.();
    this.nativeInputModalDispose = undefined;
    this.nativeInputRouter?.focusEditor();
    this.state.ui.requestRender();
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
    this.state.ui.requestRender();
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
            ? ADVANCED_HELP_INTRO
          : undefined,
        commandSectionTitle: mode === 'diagnostics'
          ? 'Diagnostic commands'
          : mode === 'advanced'
            ? 'Advanced Ultrawork controls'
            : undefined,
        shortcuts: mode === 'advanced' ? ADVANCED_KEYBOARD_SHORTCUTS : undefined,
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
    this.state.ui.requestRender(true);
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
    this.state.ui.requestRender(true);
  }

  private showQuestionDialog(payload: QuestionPanelData): void {
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
