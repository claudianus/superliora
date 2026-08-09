import type { CreateSessionOptions, LioraHarness, Session } from '@superliora/sdk';
import { maybeWarmCodemapAtSessionStart } from '@superliora/sdk';
import { resolve } from 'pathe';

import type { Component, Focusable } from '#/tui/renderer';

import type { LioraSlashCommand } from '../../commands';
import type { SessionLoadingPhase } from '../../components/dialogs/session/session-loading-overlay';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { createContext7CredentialHandler } from '../../reverse-rpc/credential/handler';
import type { ApprovalController } from '../../reverse-rpc/approval/controller';
import { createApprovalRequestHandler } from '../../reverse-rpc/approval/handler';
import type { QuestionController } from '../../reverse-rpc/question/controller';
import { createQuestionAskHandler } from '../../reverse-rpc/question/handler';
import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import { contextWorkingSetSnapshotFromLoopControl } from '../../utils/agent/context-working-set';
import { cacheMeterFromHitRate } from '../../utils/cache/cache-glance';
import { formatErrorMessage } from '../../utils/event-payload';
import { resetGoalSoftAdvisoryLedger } from '../../utils/goal/goal-soft-advisory-glance';
import {
  flushPromptInputState,
  restorePromptInputState,
  type PromptInputRuntimeHost,
} from '../../utils/prompt-input-state';
import {
  pruneTuiSessionToolOutputViewports,
  restoreTuiSessionState,
  writeTuiSessionState,
} from '../../utils/tui-session-state';
import type { PromptStash } from '../../utils/prompt-stash';
import { formatConfigDiagnosticsNotice } from '../../utils/session/config-diagnostics-notice';
import { maybeAnnounceInterruptedJobs } from '../../features/control-tower/interrupted-banner';
import { formatSessionResumeWarningNotice } from '../../utils/session/session-resume-warning-notice';
import { ttui } from '../../utils/tui-i18n';
import type { BtwPanelController } from '../panes/btw-panel';
import type { SessionEventHandler } from '../session-event/handler';
import type { SessionReplayRenderer } from '../session-replay/index';
import type { StreamingUIController } from '../streaming-ui/index';
import type { TasksBrowserController } from '../panes/tasks-browser';
import type { TranscriptRenderController } from '../transcript/transcript-render';

type MutableCreateSessionOptions = {
  -readonly [P in keyof CreateSessionOptions]: CreateSessionOptions[P];
};

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Host surface required by session attach / switch / create / close. */
export interface SessionLifecycleHost extends PromptInputRuntimeHost {
  state: TUIState;
  session: Session | undefined;
  sessionEventUnsubscribe: (() => void) | undefined;
  aborted: boolean;
  lastUserInput: string | undefined;
  skillCommands: LioraSlashCommand[];
  pluginCommands: LioraSlashCommand[];
  readonly skillCommandMap: Map<string, string>;
  readonly pluginCommandMap: Map<string, string>;
  readonly harness: LioraHarness;
  readonly promptStash: PromptStash;
  readonly sessionEventHandler: SessionEventHandler;
  readonly sessionReplay: SessionReplayRenderer;
  readonly streamingUI: StreamingUIController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly btwPanelController: BtwPanelController;
  readonly approvalController: ApprovalController;
  readonly questionController: QuestionController;
  readonly transcriptRender: TranscriptRenderController;
  readonly reverseRpcPanels: { clearReverseRpcPanels(): void; cancelPendingReverseRpc(reason: string): void };
  readonly controlTowerDesk?: import('../../features/control-tower/job-desk-events').ControlTowerJobDesk;

  setAppState(patch: Partial<AppState>): void;
  updateTerminalTitle(): void;
  updateQueueDisplay(): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  clearTranscriptAndRedraw(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice?(
    title: string,
    detail: string,
    options?: { readonly coalesceKey?: string },
  ): void;
  showSessionWarnings(session: Session): Promise<void>;
  isSessionLoadingOverlayActive(): boolean;
  runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T>;
  reportSessionLoading(patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void;
}

/**
 * Session attach / switch / create / close orchestration.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class SessionLifecycleController {
  constructor(private readonly host: SessionLifecycleHost) {}

  requireSession(): Session {
    if (this.host.session === undefined) {
      throw new Error(NO_ACTIVE_SESSION_MESSAGE);
    }
    return this.host.session;
  }

  getCurrentSessionId(): string {
    return this.host.state.appState.sessionId;
  }

  hasSessionContent(): boolean {
    return this.host.state.transcriptEntries.length > 0;
  }

  registerSessionHandlers(session: Session): void {
    const { host } = this;
    session.setApprovalHandler(
      createApprovalRequestHandler(host.approvalController, (request, response) => {
        host.transcriptRender.appendApprovalTranscriptEntry(request, response);
      }),
    );
    session.setQuestionHandler(createQuestionAskHandler(host.questionController));
    session.setCredentialHandler(createContext7CredentialHandler(host));
  }

  resetSessionRuntime(): void {
    const { host } = this;
    host.aborted = false;
    host.streamingUI.discardPending();
    // Drop in-memory queue/stash only — do NOT flush empty state to the previous
    // session's disk. The next session's durable prompt-input-state is restored
    // after setSession / hydrate.
    host.state.queuedMessages = [];
    host.promptStash.clear();
    host.streamingUI.resetToolCallState();
    host.streamingUI.resetToolUi();
    host.sessionEventHandler.resetRuntimeState();
    host.skillCommands = [];
    host.skillCommandMap.clear();
    host.pluginCommands = [];
    host.pluginCommandMap.clear();
    host.tasksBrowserController.close();
    host.btwPanelController.clear();
    host.state.footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 0 });
    host.streamingUI.setTodoList([]);
    host.streamingUI.setTurnId(undefined);
    resetGoalSoftAdvisoryLedger(host.state.appState.sessionId);
    host.setAppState({ mcpServersSummary: null, goalSoftAdvisory: null });
    host.streamingUI.setStep(0);
    host.streamingUI.resetLiveText();
    host.updateQueueDisplay();
  }

  async setSession(session: Session): Promise<void> {
    const { host } = this;
    if (host.session === session) {
      host.harness.setTelemetryContext({ sessionId: session.id });
      this.registerSessionHandlers(session);
      this.syncAdditionalDirs(session);
      return;
    }
    const previous = this.unloadCurrentSession('switching session');
    await previous?.close();
    host.session = session;
    // Keep TUI workspace aligned when forking into a worktree (different workDir).
    if (resolve(session.workDir) !== resolve(host.state.appState.workDir)) {
      host.state.appState.workDir = session.workDir;
    }
    host.harness.setTelemetryContext({ sessionId: session.id });
    this.registerSessionHandlers(session);
    this.syncAdditionalDirs(session);
    maybeWarmCodemapAtSessionStart(session.workDir);
  }

  async syncRuntimeState(session: Session = this.requireSession()): Promise<void> {
    const { host } = this;
    const [status, goalResult, config] = await Promise.all([
      session.getStatus(),
      session.getGoal(),
      host.harness.getConfig({ reload: false }).catch(() => null),
    ]);
    host.setAppState({
      sessionId: session.id,
      model: status.model ?? '',
      thinking: status.thinkingLevel !== 'off',
      thinkingLevel: status.thinkingLevel,
      permissionMode: status.permission,
      planMode: status.planMode,
      premiumQualityMode: status.premiumQualityMode ?? false,
      contextTokens: status.contextTokens,
      maxContextTokens: status.maxContextTokens,
      contextUsage: status.contextUsage,
      contextOS: status.contextOS ?? null,
      autoDream: status.autoDream ?? null,
      providerRouteStatus: status.providerRouteStatus ?? null,
      sessionTitle: session.summary?.title ?? null,
      goal: goalResult.goal,
      ...(cacheMeterFromHitRate(status.cacheHitRate, status.cacheWarmStreak) != null
        ? { cacheMeter: cacheMeterFromHitRate(status.cacheHitRate, status.cacheWarmStreak)! }
        : {}),
      ...(status.circuitBreakers !== undefined
        ? { circuitBreakers: status.circuitBreakers }
        : {}),
      ...(config !== null
        ? {
            workingSet: contextWorkingSetSnapshotFromLoopControl({
              maxWorkingSetTokens: config.loopControl?.maxWorkingSetTokens,
              asyncWorkingSetTokens: config.loopControl?.asyncWorkingSetTokens,
            }),
          }
        : {}),
    });
    this.syncAdditionalDirs(session);
  }

  async closeSession(reason: string): Promise<void> {
    await writeTuiSessionState(this.host).catch(() => undefined);
    // F10: stale worktree CTA before the session handle is dropped.
    try {
      const { maybeAnnounceStaleWorktrees } = await import(
        '../../features/control-tower/job-hygiene'
      );
      await maybeAnnounceStaleWorktrees(this.host);
    } catch {
      /* best-effort */
    }
    const previous = this.unloadCurrentSession(reason);
    await previous?.close();
  }

  async switchToSession(session: Session, statusMessage: string): Promise<void> {
    const { host } = this;
    // Persist the outgoing session's queue/draft before wiping runtime memory.
    flushPromptInputState(host);
    await writeTuiSessionState(host).catch(() => undefined);
    this.resetSessionRuntime();
    await this.setSession(session);
    await this.syncRuntimeState(session);
    host.updateTerminalTitle();
    try {
      await host.refreshDynamicSlashCommands(host.session);
    } catch {
      /* keep the switched session usable even if dynamic skills fail */
    }
    host.state.toolOutputViewports.clear();
    await restoreTuiSessionState(host);
    host.clearTranscriptAndRedraw();
    try {
      await host.sessionReplay.hydrateFromReplay(session);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(`Failed to replay session history: ${msg}`);
    } finally {
      pruneTuiSessionToolOutputViewports(host);
      host.sessionEventHandler.startSubscription();
    }
    await restorePromptInputState(host).catch(() => undefined);
    await writeTuiSessionState(host).catch(() => undefined);
    const resumeState = session.getResumeState();
    if (resumeState?.warning !== undefined) {
      // Loop49a: named notice on cold resume after history hydrate.
      const notice = formatSessionResumeWarningNotice(resumeState.warning);
      host.showNotice?.(notice.title, notice.detail, {
        coalesceKey: notice.coalesceKey,
      });
      host.showStatus(notice.status, 'warning');
    }
    host.showStatus(statusMessage);
    void host.showSessionWarnings(session);
    void maybeAnnounceInterruptedJobs(host, session);
  }

  async createNewSession(): Promise<void> {
    const { host } = this;
    if (host.state.appState.isReplaying || host.isSessionLoadingOverlayActive()) {
      host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }

    await host.runWithBusyOverlay(
      {
        title: ttui('tui.sessionLoading.creating'),
        detail: ttui('tui.sessionLoading.creating'),
        phase: 'working',
      },
      async () => {
        let session: Session;
        try {
          session = await this.createSessionFromCurrentState();
        } catch (error) {
          const msg = formatErrorMessage(error);
          host.showError(`Failed to start a new session: ${msg}`);
          return;
        }

        // Save the previous session's draft/queue before starting clean.
        flushPromptInputState(host);
        await writeTuiSessionState(host).catch(() => undefined);
        this.resetSessionRuntime();
        host.setAppState({
          activityTip: null,
          isCompacting: false,
          isBackgroundCompacting: false,
          streamingPhase: 'idle',
          // New session has no goal yet; clear before redraw so the monitor
          // does not reappear from the previous session's snapshot.
          goal: null,
        });
        await this.setSession(session);
        host.setAppState({ sessionId: session.id });
        host.clearTranscriptAndRedraw();
        host.reportSessionLoading({
          phase: 'finishing',
          progress: 0.85,
          detail: ttui('tui.sessionLoading.phase.finishing'),
          sessionId: session.id,
        });
        try {
          await this.activateRuntime();
          await this.syncRuntimeState(session);
        } catch (error) {
          host.sessionEventHandler.startSubscription();
          const msg = formatErrorMessage(error);
          host.showError(`Post-create setup failed: ${msg}`);
          return;
        }
        try {
          await host.refreshDynamicSlashCommands(host.session);
        } catch {
          /* keep the new session usable even if dynamic skills fail */
        }
        host.sessionEventHandler.startSubscription();
        host.showStatus(`Started a new session (${session.id}).`);
        void host.showSessionWarnings(session);
        void this.showConfigWarningsIfAny();
      },
    );
  }

  private syncAdditionalDirs(session: Session): void {
    const additionalDirs = session.summary?.additionalDirs ?? [];
    if (sameStringArrays(this.host.state.appState.additionalDirs, additionalDirs)) return;
    this.host.setAppState({ additionalDirs: [...additionalDirs] });
  }

  private async createSessionFromCurrentState(): Promise<Session> {
    const { host } = this;
    const model = host.state.appState.model.trim();
    if (model.length === 0) {
      throw new Error(LLM_NOT_SET_MESSAGE);
    }
    const options: MutableCreateSessionOptions = {
      workDir: host.state.appState.workDir,
      model,
      thinking:
        host.session === undefined
          ? undefined
          : (host.state.appState.thinkingLevel ??
            (host.state.appState.thinking ? 'on' : 'off')),
      permission: host.state.appState.permissionMode,
      planMode: host.state.appState.planMode,
    };
    if (host.state.appState.additionalDirs.length > 0) {
      options.additionalDirs = [...host.state.appState.additionalDirs];
    }
    return host.harness.createSession(options);
  }

  // Plan mode is set by createSession — do not re-enter it here.
  private async activateRuntime(): Promise<void> {
    const session = this.requireSession();
    await session.setPermission(this.host.state.appState.permissionMode);
    await this.syncRuntimeState(session);
  }

  private unloadCurrentSession(reason: string): Session | undefined {
    const { host } = this;
    const previous = host.session;
    host.sessionEventUnsubscribe?.();
    host.sessionEventUnsubscribe = undefined;
    host.reverseRpcPanels.clearReverseRpcPanels();
    previous?.setApprovalHandler(undefined);
    previous?.setQuestionHandler(undefined);
    previous?.setCredentialHandler(undefined);
    host.reverseRpcPanels.cancelPendingReverseRpc(reason);
    host.session = undefined;
    host.state.toolOutputViewports.clear();
    host.harness.setTelemetryContext({ sessionId: null });
    host.setAppState({ goal: null });
    return previous;
  }

  /**
   * Loop47a: surface config.toml diagnostics as a named notice (status alone
   * was easy to miss). Soft warnings vs keep-previous hard degradation.
   */
  private async showConfigWarningsIfAny(): Promise<void> {
    try {
      const { warnings } = await this.host.harness.getConfigDiagnostics();
      if (warnings.length === 0) return;
      const notice = formatConfigDiagnosticsNotice(warnings);
      if (notice === undefined) return;
      if (this.host.showNotice !== undefined) {
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
      }
      this.host.showStatus(notice.status, 'warning');
    } catch {
      /* diagnostics are best-effort */
    }
  }
}
