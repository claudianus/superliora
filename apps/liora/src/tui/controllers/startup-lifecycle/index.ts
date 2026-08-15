import type { Session } from '@superliora/sdk';

import { scheduleHeadlessForceExit } from '#/cli/headless-exit';
import { raceWithTimeout } from '#/cli/run-prompt-io';
import { TUI_CLEANUP_TIMEOUT_MS, TUI_FORCE_EXIT_GRACE_MS } from '#/constant/app';
import {
  requestTUIScrollRender,
} from '../../utils/render/frame-render';
import { scheduleTranscriptScrollSettleRefresh } from '../../utils/render/scroll-settle-refresh';
import { writeTuiSessionState } from '../../utils/tui-session-state';
import {
  scrollTranscriptViewport as applyTranscriptViewportScroll,
  type TranscriptScrollAction,
} from '../../features/transcript/transcript-viewport';
import { loadStartupBanner } from './banner';
import { finishStartupSession, showSessionWarnings } from './finish';
import {
  attachStartupNativeRendererCallback,
  disposeStartupTerminalTracking,
  ensureStartupNativeInputRouter,
  mountStartupFooter,
  mountStartupHeader,
  startStartupBackgroundFdAutocomplete,
  startStartupEventLoop,
} from './native-renderer';
import {
  maybeStartOnboarding,
  prepareStartupExperimentalFeatures,
  refreshProviderModelsInBackground,
} from './onboarding';
import { initStartupSession } from './session-init';
import {
  emergencyStartupTerminalExit,
  registerStartupSignalHandlers,
  unregisterStartupSignalHandlers,
} from './signals';
import type { StartupLifecycleHost } from './types';
import { mountIntentComposer } from '../../features/control-tower/conductor-ux';
import { restoreMountedTuiStdioGuard } from '../../utils/stdio/tui-stdio-guard';

export type { StartupLifecycleHost } from './types';

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
    ui.addChild(this.host.state.missionControlContainer);
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
    // Best-effort: land queue/stash/draft before tearing the session down so a
    // clean exit (and most SIGINT/SIGTERM paths) still resume with work intact.
    try {
      const { flushPromptInputState } = await import('../../utils/prompt-input-state');
      flushPromptInputState(host);
      await writeTuiSessionState(host).catch(() => undefined);
      // Give the fire-and-forget write a short window to land.
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    } catch {
      // Never block shutdown on persistence failures.
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
    // Return the terminal before awaiting session/harness cleanup. Otherwise a
    // stuck MCP/background/hook close keeps alternate-screen/raw mode up and
    // /exit feels frozen.
    await host.state.renderer.drainInput();
    host.state.ui.stop();
    restoreMountedTuiStdioGuard();

    const forceExitTimer = scheduleHeadlessForceExit(
      process,
      () => exitCode ?? 0,
      TUI_CLEANUP_TIMEOUT_MS + TUI_FORCE_EXIT_GRACE_MS,
    );
    try {
      await raceWithTimeout(
        (async () => {
          await host.closeSession('shutting down');
          await host.harness.close();
        })(),
        TUI_CLEANUP_TIMEOUT_MS,
      );
      host.sessionEventHandler.resetRuntimeState();
      host.tasksBrowserController.close();
      host.usageMonitor.dispose();
      host.promptIntelligence.dispose();
      host.disposables.disposeAll();
      if (host.onExit) {
        await host.onExit(exitCode);
      }
    } finally {
      clearTimeout(forceExitTimer);
    }
  }

  registerSignalHandlers(): void {
    registerStartupSignalHandlers(this.host, {
      emergencyTerminalExit: (exitCode) => this.emergencyTerminalExit(exitCode),
      stop: (exitCode) => this.host.stop(exitCode),
    });
  }

  unregisterSignalHandlers(): void {
    unregisterStartupSignalHandlers(this.host);
  }

  emergencyTerminalExit(exitCode = 129): never {
    return emergencyStartupTerminalExit(this.host, exitCode);
  }

  scrollTranscriptViewport(action: TranscriptScrollAction): boolean {
    const changed = applyTranscriptViewportScroll(this.host.state.transcriptViewport, action);
    if (changed) {
      requestTUIScrollRender(this.host.state);
      // After fling (top→bottom), pure-scroll paints placeholders for cold
      // cards; settle content paint materializes the final visible window.
      scheduleTranscriptScrollSettleRefresh(this.host.state);
    }
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
    await prepareStartupExperimentalFeatures(this.host);
    void this.refreshProviderModelsInBackground();
    return initStartupSession(this.host);
  }

  async initMainTui(): Promise<boolean> {
    const { host } = this;
    const shouldReplayHistory = await this.init();
    mountStartupFooter(host);
    mountStartupHeader(host);
    host.setupAutocomplete();
    void host.loadPersistedInputHistory();
    host.state.editorContainer.clear();
    host.state.editorContainer.addChild(host.state.editor);
    host.state.ui.setFocus(host.state.editor);
    mountIntentComposer({
      state: host.state,
      session: host.session,
      showStatus: (msg, color) => host.showStatus(msg, color),
      jobBoardController: host.jobBoardController,
    });
    this.ensureNativeInputRouter();
    this.attachNativeRendererCallback();
    void maybeStartOnboarding(host).catch(() => {});
    return shouldReplayHistory;
  }

  async loadBanner(): Promise<void> {
    await loadStartupBanner(this.host);
  }

  async showSessionWarnings(session: Session): Promise<void> {
    await showSessionWarnings(this.host, session);
  }

  async refreshProviderModelsInBackground(): Promise<void> {
    await refreshProviderModelsInBackground(this.host);
  }

  async finishStartup(shouldReplayHistory: boolean): Promise<void> {
    await finishStartupSession(this.host, shouldReplayHistory);
  }

  private attachNativeRendererCallback(): void {
    attachStartupNativeRendererCallback(this.host);
  }

  private startEventLoop(): void {
    startStartupEventLoop(this.host, {
      scrollTranscriptViewport: (action) => this.scrollTranscriptViewport(action),
    });
  }

  /** Public for tests that call `init()` without `initMainTui()`. */
  ensureNativeInputRouter(): void {
    ensureStartupNativeInputRouter(this.host, {
      scrollTranscriptViewport: (action) => this.scrollTranscriptViewport(action),
    });
  }

  private startBackgroundFdAutocomplete(): void {
    startStartupBackgroundFdAutocomplete(this.host);
  }

  private disposeTerminalTracking(): void {
    disposeStartupTerminalTracking(this.host);
  }
}
