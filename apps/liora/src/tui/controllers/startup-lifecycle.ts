import type { CreateSessionOptions, LioraHarness, Session } from '@superliora/sdk';
import { resolve } from 'pathe';

import {
  encodeNativeInputAsLegacySequence,
  LioraNativeRootUI,
  NativeTerminalSession,
  type NativeInputEvent,
  type NativeInputKey,
} from '#/tui/renderer';
import { ensureFdPath } from '#/utils/process/fd-detect';

import { BannerProvider } from '../banner/banner-provider';
import { readBannerDisplayState, writeBannerDisplayState } from '../banner/state';
import { setExperimentalFeatures } from '../commands';
import * as slashCommands from '../commands/dispatch';
import { BannerComponent } from '../components/chrome/banner';
import type { TodoBoardScrollAction } from '../components/chrome/todo-panel';
import { WelcomeComponent } from '../components/chrome/welcome';
import type { SessionLoadingOverlayComponent } from '../components/dialogs/session-loading-overlay';
import { DEFAULT_ONBOARDING_PREFERENCES } from '../config';
import { setKittyGraphicsChannel } from '../media/kitty-graphics-channel';
import { currentTheme } from '../theme';
import type { ColorToken } from '../theme';
import type { LioraTUIOptions } from '../types';
import type { TUIState } from '../tui-state';
import { isDeadTerminalError } from '../utils/dead-terminal';
import type { DisposableRegistry } from '../utils/disposables';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
  requestTUIScrollRender,
} from '../utils/frame-render';
import {
  createTUIStateNativeInputRouter,
  type TUIStateNativeInputRouter,
} from '../utils/native-input-router';
import { createTUIStateNativeRenderCallback } from '../utils/native-layout-frame';
import { combineStartupNotice, isOAuthLoginRequiredError } from '../utils/startup';
import { installTerminalFocusTracking } from '../utils/terminal-focus';
import { detectTmuxKeyboardWarning } from '../utils/tmux-keyboard';
import { getTUIStateNativeTodoRect } from '../utils/transcript-hit-test';
import {
  scrollTranscriptViewport as applyTranscriptViewportScroll,
  type TranscriptScrollAction,
} from '../utils/transcript-viewport';
import { ttui } from '../utils/tui-i18n';
import type { AppearanceController } from './appearance';
import type { AuthFlowController } from './auth-flow';
import { ClipboardImageHintController } from './clipboard-image-hint';
import type { DialogsController } from './dialogs';
import type { EditorKeyboardController } from './editor-keyboard';
import type { PanesController } from './panes';
import type { PromptIntelligenceController } from './prompt-intelligence';
import type { SessionBrowserController } from './session-browser';
import type { SessionEventHandler } from './session-event-handler';
import type { SessionReplayRenderer } from './session-replay';
import type { StreamingUIController } from './streaming-ui';
import type { TasksBrowserController } from './tasks-browser';
import type { TranscriptRenderController } from './transcript-render';
import type { UsageMonitorController } from './usage-monitor';

type MutableCreateSessionOptions = {
  -readonly [P in keyof CreateSessionOptions]: CreateSessionOptions[P];
};

/** Host surface required by TUI startup, shutdown, and signal handling. */
export interface StartupLifecycleHost {
  harness: LioraHarness;
  options: LioraTUIOptions;
  session: Session | undefined;
  state: TUIState;
  aborted: boolean;
  signalCleanupHandlers: Array<() => void>;
  isShuttingDown: boolean;
  eventLoopStarted: boolean;
  startupNotice: string | undefined;
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  clipboardImageHintController: ClipboardImageHintController | undefined;
  terminalFocusTrackingDispose: (() => void) | undefined;
  fdPath: string | null;
  fdDownloadStarted: boolean;
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  nativeRendererDiagnosticsHudEnabled: boolean;
  readonly reverseRpcDisposers: Array<() => void>;
  readonly disposables: DisposableRegistry;
  readonly transcriptRender: TranscriptRenderController;
  readonly authFlow: AuthFlowController;
  readonly appearanceController: AppearanceController;
  readonly sessionBrowser: SessionBrowserController;
  readonly sessionReplay: SessionReplayRenderer;
  readonly sessionEventHandler: SessionEventHandler;
  readonly usageMonitor: UsageMonitorController;
  readonly editorKeyboard: EditorKeyboardController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly promptIntelligence: PromptIntelligenceController;
  readonly dialogs: DialogsController;
  readonly panes: PanesController;
  readonly streamingUI: StreamingUIController;

  onExit?: (exitCode?: number) => Promise<void>;

  setupAutocomplete(): void;
  loadPersistedInputHistory(): Promise<void>;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  setSession(session: Session): Promise<void>;
  syncRuntimeState(session: Session): Promise<void>;
  closeSession(reason: string): Promise<void>;
  requireSession(): Session;
  showStatus(msg: string, color?: ColorToken): void;
  showCommandHub(options?: { readonly intro?: boolean }): void;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  isSessionLoadingOverlayActive(): boolean;
  beginSessionLoading(sessionId?: string, title?: string): void;
  reportSessionLoading(patch: {
    readonly phase?: import('../components/dialogs/session-loading-overlay').SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void;
  endSessionLoading(): void;
  refreshTerminalThemeTracking(): void;
  readonly appStateController: { supportsCurrentModelCapability(capability: string): boolean };
  stop(exitCode?: number): Promise<void>;
}

/**
 * TUI startup, shutdown, signal handling, and native-renderer adapter wiring.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class StartupLifecycleController {
  constructor(private readonly host: StartupLifecycleHost) {}

  buildLayout(): void {
    const { ui } = this.host.state;
    ui.clear();
    ui.addChild(this.host.state.transcriptContainer);
    ui.addChild(this.host.state.activityContainer);
    ui.addChild(this.host.state.todoPanelContainer);
    ui.addChild(this.host.state.queueContainer);
    ui.addChild(this.host.state.btwPanelContainer);
    ui.addChild(this.host.state.editorContainer);
  }

  async start(): Promise<void> {
    const { host } = this;
    this.registerSignalHandlers();
    try {
      const shouldReplayHistory = await this.initMainTui();
      this.startEventLoop();
      try {
        host.transcriptRender.renderWelcome();
        await host.transcriptRender.playStartupSplash();
        void this.loadBanner();
        this.startBackgroundFdAutocomplete();
        await this.finishStartup(shouldReplayHistory);
      } catch (error) {
        host.transcriptRender.disposeStartupSplash();
        this.disposeTerminalTracking();
        host.state.renderer.stop();
        throw error;
      }
    } catch (error) {
      this.unregisterSignalHandlers();
      throw error;
    }
  }

  async stop(exitCode?: number): Promise<void> {
    const { host } = this;
    if (host.isShuttingDown) return;
    host.isShuttingDown = true;
    this.unregisterSignalHandlers();
    host.dialogs.stopSessionLoadingPulse();
    host.sessionLoadingOverlay = undefined;
    host.aborted = true;
    host.streamingUI.discardPending();
    host.editorKeyboard.clearPendingExit();
    if (host.detachHintClearTimer !== undefined) {
      clearTimeout(host.detachHintClearTimer);
      host.detachHintClearTimer = undefined;
    }
    for (const dispose of host.reverseRpcDisposers) {
      dispose();
    }
    host.reverseRpcDisposers.length = 0;
    this.disposeTerminalTracking();
    host.transcriptRender.disposeStartupSplash();
    host.appearanceController.dispose();
    host.state.footer.dispose();
    host.state.header.dispose();
    await host.closeSession('shutting down');
    await host.harness.close();
    host.sessionEventHandler.resetRuntimeState();
    host.tasksBrowserController.close();
    host.usageMonitor.dispose();
    host.promptIntelligence.dispose();
    host.disposables.disposeAll();
    await host.state.renderer.drainInput();
    host.state.ui.stop();
    if (host.onExit) {
      await host.onExit(exitCode);
    }
  }

  registerSignalHandlers(): void {
    const { host } = this;
    this.unregisterSignalHandlers();

    const exitHandler = (): void => {
      try {
        NativeTerminalSession.writeRestoreSequencesSync(process.stdout);
      } catch {
        // Swallow — must never throw at process exit.
      }
    };
    process.on('exit', exitHandler);
    host.signalCleanupHandlers.push(() => {
      process.off('exit', exitHandler);
    });

    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    if (process.platform !== 'win32') {
      signals.push('SIGHUP');
    }

    for (const signal of signals) {
      const handler = (): void => {
        if (signal === 'SIGHUP') {
          host.harness.emergencyFlushSync();
          this.emergencyTerminalExit();
          return;
        }
        const code = 128 + (signal === 'SIGINT' ? 2 : 15);
        host.stop(code).then(
          () => {
            process.exit(code);
          },
          () => {
            this.emergencyTerminalExit(code);
          },
        );
      };
      process.prependListener(signal, handler);
      host.signalCleanupHandlers.push(() => {
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
    host.signalCleanupHandlers.push(() => {
      process.stdout.off('error', terminalErrorHandler);
    });
    host.signalCleanupHandlers.push(() => {
      process.stderr.off('error', terminalErrorHandler);
    });
  }

  unregisterSignalHandlers(): void {
    const { host } = this;
    const handlers = host.signalCleanupHandlers;
    host.signalCleanupHandlers = [];
    for (const cleanup of handlers) cleanup();
  }

  emergencyTerminalExit(exitCode = 129): never {
    const { host } = this;
    host.isShuttingDown = true;
    this.unregisterSignalHandlers();
    try {
      host.harness.emergencyFlushSync();
    } catch {
      // Swallow — we are exiting regardless.
    }
    process.exit(exitCode);
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    const changed = applyTranscriptViewportScroll(this.host.state.transcriptViewport, action);
    if (changed) requestTUIScrollRender(this.host.state);
    return changed;
  }

  async getStartupMcpMs(): Promise<number> {
    const session = this.host.session;
    if (session === undefined) return 0;
    try {
      const metrics = await session.getMcpStartupMetrics();
      return metrics.durationMs;
    } catch {
      return 0;
    }
  }

  async init(): Promise<boolean> {
    const { host } = this;
    setExperimentalFeatures(await host.harness.getExperimentalFeatures(), true);
    await host.authFlow.refreshAvailableModels();
    void this.refreshProviderModelsInBackground();

    const { startup } = host.options;
    const { workDir } = host.state.appState;
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
          : host.state.appState.permissionMode,
      planMode: startup.plan,
    };
    if (host.options.sessionMetadata !== undefined) {
      createSessionOptions.metadata = host.options.sessionMetadata;
    }
    if (host.state.appState.additionalDirs.length > 0) {
      createSessionOptions.additionalDirs = [...host.state.appState.additionalDirs];
    }

    try {
      if (isResumeStartup) {
        if (startup.sessionFlag === '') {
          host.state.startupState = 'picker';
          return false;
        }

        if (startup.sessionFlag !== undefined) {
          const sessions = await host.harness.listSessions({
            sessionId: startup.sessionFlag,
            workDir,
          });
          const target = sessions[0];
          if (target === undefined) {
            throw new Error(`Session "${startup.sessionFlag}" not found.`);
          }
          if (resolve(target.workDir) !== resolve(workDir)) {
            host.state.renderer.stop();
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
          session = await host.harness.resumeSession({
            id: startup.sessionFlag,
            additionalDirs: createSessionOptions.additionalDirs,
          });
          shouldReplayHistory = true;
        } else {
          const sessions = await host.harness.listSessions({ workDir });
          const target = sessions[0];
          if (target !== undefined) {
            session = await host.harness.resumeSession({
              id: target.id,
              additionalDirs: createSessionOptions.additionalDirs,
            });
            shouldReplayHistory = true;
          } else {
            session = await host.harness.createSession(createSessionOptions);
            host.startupNotice = combineStartupNotice(
              host.startupNotice,
              `No sessions to continue under "${workDir}"; starting a fresh session.`,
            );
          }
        }
      } else {
        session = await host.harness.createSession(createSessionOptions);
      }
      if (session !== undefined && shouldReplayHistory) {
        await host.sessionBrowser.applyStartupModesToResumedSession(session);
        if (startup.model !== undefined) {
          await session.setModel(startup.model);
        }
      }
    } catch (error) {
      if (!isOAuthLoginRequiredError(error)) throw error;
      host.authFlow.enterLoginRequiredStartupState();
      return false;
    }

    if (session === undefined) {
      throw new Error('Startup session was not initialized.');
    }
    await host.setSession(session);
    await host.syncRuntimeState(session);
    await host.refreshDynamicSlashCommands(session);
    host.sessionBrowser.applyStartupPermissionAndPlanToAppState();
    host.state.startupState = 'ready';
    return shouldReplayHistory;
  }

  async initMainTui(): Promise<boolean> {
    const { host } = this;
    const shouldReplayHistory = await this.init();
    this.mountFooter();
    this.mountHeader();
    host.setupAutocomplete();
    void host.loadPersistedInputHistory();
    host.state.editorContainer.clear();
    host.state.editorContainer.addChild(host.state.editor);
    host.state.ui.setFocus(host.state.editor);
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();
    void this.maybeStartOnboarding().catch(() => {});
    return shouldReplayHistory;
  }

  async loadBanner(): Promise<void> {
    const { host } = this;
    const provider = new BannerProvider(host.state.appState.version);
    const displayState = await readBannerDisplayState();
    const now = new Date();
    const banner = await provider.load(fetch, {
      state: displayState,
      now,
    });
    host.state.appState.banner = banner;
    if (banner === null) return;

    this.renderBanner();
    requestTUILayoutRender(host.state);

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

  async showSessionWarnings(session: Session): Promise<void> {
    const { host } = this;
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

  private renderBanner(): void {
    const { host } = this;
    if (host.state.appState.banner === null || host.state.appState.banner === undefined) {
      return;
    }
    if (host.state.transcriptContainer.children.some((child) => child instanceof BannerComponent)) {
      return;
    }
    const welcomeIndex = host.state.transcriptContainer.children.findIndex(
      (child) => child instanceof WelcomeComponent,
    );
    const banner = new BannerComponent(host.state.appState.banner);
    if (welcomeIndex >= 0) {
      host.state.transcriptContainer.children.splice(welcomeIndex + 1, 0, banner);
    } else {
      host.state.transcriptContainer.children.unshift(banner);
    }
    host.state.transcriptContainer.invalidate();
  }

  private async maybeStartOnboarding(): Promise<void> {
    const { host } = this;
    const config = await host.harness.getConfig({ reload: true });
    const hasProvider =
      config.defaultModel !== undefined ||
      Object.keys(config.providers ?? {}).length > 0;
    if (!hasProvider) {
      const qwenKey = process.env['QWEN_TOKEN_PLAN_API_KEY']?.trim();
      if (qwenKey !== undefined && qwenKey.length > 0) {
        const { applyQwenTokenPlanProvider } = await import('#/tui/utils/qwen-token-plan');
        applyQwenTokenPlanProvider(config, qwenKey);
        await host.harness.setConfig({
          providers: config.providers,
          models: config.models,
          defaultModel: config.defaultModel,
          defaultThinking: config.defaultThinking,
        });
        await host.authFlow.refreshConfigAfterLogin();
        host.showStatus(
          'Qwen Cloud (Token Plan) auto-configured from QWEN_TOKEN_PLAN_API_KEY. ' +
            'Text, image, and video generation enabled; harness tools run server-side on qwen3.7/3.8 models.',
          'success',
        );
      } else {
        slashCommands.dispatchInput(host as never, '/login');
        return;
      }
    }

    const onboarding = host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
    const editorBusy = (host.state.editor.getText?.() ?? '').trim().length > 0;
    if (!onboarding.hubIntroSeen && !editorBusy) {
      host.showCommandHub({ intro: true });
    }
  }

  private attachNativeRendererCallback(): void {
    const { host } = this;
    if (!(host.state.ui instanceof LioraNativeRootUI)) return;
    const nativeRootUI = host.state.ui;
    if (host.nativeInputRouter !== undefined) {
      nativeRootUI.setInputRouter(host.nativeInputRouter.router);
    }
    const diagnosticsOverlay = () => host.nativeRendererDiagnosticsHudEnabled;
    nativeRootUI.setRenderCallback(
      createTUIStateNativeRenderCallback(host.state, {
        diagnosticsOverlay,
        onAuthoritativeFrame: () => {
          host.appearanceController.reapplyTerminalPalette();
        },
      }),
    );
    host.state.toast.onChanged = () => {
      nativeRootUI.renderer.requestRender('manual');
    };
  }

  private startEventLoop(): void {
    const { host } = this;
    host.state.renderer.start();
    setKittyGraphicsChannel((sequence) => {
      host.state.terminal.write(sequence);
    });
    host.eventLoopStarted = true;
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();
    this.startClipboardImageHintController();
    host.terminalFocusTrackingDispose = installTerminalFocusTracking(host.state);
    host.refreshTerminalThemeTracking();
  }

  private ensureNativeInputRouter(): void {
    const { host } = this;
    host.nativeInputRouter ??= createTUIStateNativeInputRouter(host.state, {
      scrollTranscriptViewport: (action) => this.scrollTranscriptViewport(action),
      scrollTodoPanel: (event) => this.scrollTodoPanelAtMouse(event),
      handlePreEditorInput: (event) => {
        if (event.type !== 'key' || event.eventType === 'release') return false;
        if (event.alt && this.scrollTodoPanelByKey(event.key)) return true;
        const legacy = encodeNativeInputAsLegacySequence(event);
        if (legacy === undefined) return false;
        return host.state.editor.tryHandleAppShortcut?.(legacy) === true;
      },
    });
  }

  private stopNativeRendererAdapters(): void {
    const { host } = this;
    host.nativeInputModalDispose?.();
    host.nativeInputModalDispose = undefined;
    host.nativeInputRouter?.dispose();
    host.nativeInputRouter = undefined;
  }

  private startClipboardImageHintController(): void {
    const { host } = this;
    host.clipboardImageHintController = new ClipboardImageHintController({
      ui: host.state.ui,
      footer: host.state.footer,
      getModelSupportsImage: () => host.appStateController.supportsCurrentModelCapability('image_in'),
      requestRender: () => {
        requestTUIContentRender(host.state);
      },
    });
    host.clipboardImageHintController.start();
  }

  private startBackgroundFdAutocomplete(): void {
    const { host } = this;
    if (host.fdPath !== null || host.fdDownloadStarted) return;
    host.fdDownloadStarted = true;

    void ensureFdPath()
      .then((fdPath) => {
        if (fdPath === null) return;
        host.fdPath = fdPath;
        host.setupAutocomplete();
      })
      .catch(() => {});
  }

  async refreshProviderModelsInBackground(): Promise<void> {
    const { host } = this;
    try {
      const result = await host.authFlow.refreshProviderModels();
      for (const c of result.changed) {
        if (c.added <= 0) continue;
        host.showStatus(`${c.providerName} · +${String(c.added)} model${c.added > 1 ? 's' : ''}.`);
      }
      for (const f of result.failed) {
        host.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
      }
    } catch {
      // Best-effort: startup must not crash on background refresh failures.
    }
  }

  async finishStartup(shouldReplayHistory: boolean): Promise<void> {
    const { host } = this;
    if (host.startupNotice !== undefined) {
      host.showStatus(host.startupNotice);
      host.startupNotice = undefined;
    }
    void this.showTmuxKeyboardWarningIfNeeded();
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
      void this.showSessionWarnings(host.session);
    }
    void host.sessionBrowser.fetchSessions();
    if (host.session !== undefined) {
      host.sessionBrowser.updateTerminalTitle();
    }
    void host.refreshDynamicSlashCommands(host.session);
    host.usageMonitor.start();
    if (host.options.startup.resumeGoal === true) {
      void this.resumeGoalFromQueue();
    }
  }

  private async resumeGoalFromQueue(): Promise<void> {
    const { host } = this;
    const session = host.session;
    if (session === undefined) return;

    try {
      const { readGoalQueue, removeGoalQueueItem } = await import('../goal-queue-store');
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

  private async showTmuxKeyboardWarningIfNeeded(): Promise<void> {
    const { host } = this;
    try {
      const warning = await detectTmuxKeyboardWarning();
      if (warning === undefined || host.aborted) return;
      host.showStatus(warning, 'warning');
    } catch {
      // Best-effort: startup must not block on warning retrieval.
    }
  }

  private disposeTerminalTracking(): void {
    const { host } = this;
    this.stopNativeRendererAdapters();
    setKittyGraphicsChannel(undefined);
    host.eventLoopStarted = false;
    host.panes.stopTerminalThemeTracking();
    host.clipboardImageHintController?.stop();
    host.clipboardImageHintController = undefined;
    host.terminalFocusTrackingDispose?.();
    host.terminalFocusTrackingDispose = undefined;
  }

  private scrollTodoPanelAtMouse(event: NativeInputEvent): boolean {
    const { host } = this;
    if (event.type !== 'mouse') return false;
    const rect = getTUIStateNativeTodoRect(host.state);
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
    if (!host.state.todoPanel.scrollBoard(action)) return false;
    requestTUILayoutRender(host.state);
    return true;
  }

  private scrollTodoPanelByKey(key: NativeInputKey): boolean {
    const { host } = this;
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
    if (!host.state.todoPanel.scrollBoard(action)) return false;
    requestTUILayoutRender(host.state);
    return true;
  }

  private mountFooter(): void {
    const { host } = this;
    if (!host.state.footerContainer.children.includes(host.state.footer)) {
      host.state.footerContainer.addChild(host.state.footer);
    }
    if (!host.state.ui.children.includes(host.state.footerContainer)) {
      host.state.ui.addChild(host.state.footerContainer);
    }
  }

  private mountHeader(): void {
    const { host } = this;
    if (!host.state.headerContainer.children.includes(host.state.header)) {
      host.state.headerContainer.addChild(host.state.header);
    }
    if (!host.state.ui.children.includes(host.state.headerContainer)) {
      host.state.ui.addChild(host.state.headerContainer);
    }
  }
}
