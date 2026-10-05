import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { LioraHarness, Session } from '@superliora/sdk';

import { PRODUCT_NAME } from '#/constant/app';
import type { ColorToken, ThemeName } from '#/tui/theme';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';

import type { AuthFlowController } from '../../controllers/auth/auth-flow';
import type { BtwPanelController } from '../../controllers/panes/btw-panel';
import type { StreamingUIController } from '../../controllers/streaming-ui/index';
import type { TasksBrowserController } from '../../controllers/panes/tasks-browser';
import type { JobBoardController } from '../../controllers/panes/job-board';
import type { WorkerDockController } from '../../controllers/worker-dock/controller';
import type { ResolvedTheme } from '../../theme/colors';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { MotionBeatController } from '../../utils/render/motion-beats';
import type {
  AppState,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptDetailLevel,
  TranscriptEntry,
} from '../../types';
import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import { handleAccountsCommand } from '../auth/accounts';
import { handleGithubConnectCommand } from '../auth/github-connect';
import { handleLoginCommand, handleLogoutCommand } from '../auth/login';
import { handleBtwCommand } from '../btw';
import { handleAutoCommand, handlePermissionCommand, handleYoloCommand, showPermissionPicker } from '../config/permission/permission';
import { handleAppearanceCommand } from '../config/appearance/appearance';
import { handlePerformanceCommand } from '../config/appearance/performance';
import { handleLocaleCommand } from '../config/locale/locale';
import { handleCompactCommand } from '../session/compact';
import { handleEditorCommand, handleThemeCommand } from '../config/appearance/editor-theme';
import { handleModelCommand } from '../config/model/model';
import { handleFastCommand } from '../config/fast';
import { handleThinkingCommand } from '../config/thinking/thinking';
import { showSettingsSelector } from '../config/settings';
import { handleJobCommand, handleJobsCommand } from '../jobs';
import { showDiff } from '../session/diff';
import { showLog } from '../log';
import { showQuota, showStatusReport, showUsage } from '../info/info';
import { handleHostSetupCommand } from '../info/host-setup';
import { handleAddDirCommand } from '../session/add-dir';
import { handleFolderCommand } from '../session/folder';
import { parseSlashInput } from './parse';
import type {
  RendererDiagnosticsOverlayCommand,
  RendererTraceCommand,
} from '../../controllers/diagnostics/renderer-status';
import type { BuiltinSlashCommandName } from './registry';
import { handleReloadCommand, handleReloadTuiCommand } from '../session/reload';
import { resolveSlashCommandInput, slashBusyMessage } from './resolve';
import {
  handleExportMdCommand,
  handleForkCommand,
  handleTitleCommand,
} from '../session/session';
import { showSearch } from '../search';

import { handleRewindCommand } from '../session/rewind';
import { handleTranscriptCommand } from '../session/transcript';
import { handleNeatCommand } from '../session/neat';
import { handleUndoCommand } from '../session/undo';
import { handleQueueCommand } from '../session/queue';
import { handleUpgradeCommand, parseUpgradeSlashArgs } from '../info/upgrade';

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

export interface ShowNoticeOptions {
  /** Replace any existing notice in the transcript with the same coalesce key. */
  readonly coalesceKey?: string;
}

export interface SlashCommandHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: LioraHarness;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages: boolean;

  setAppState(patch: Partial<AppState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: ShowNoticeOptions): void;
  /** Apply transcript density live (PREMIUM.md §7.9); /appearance persists it. */
  setTranscriptDetail(level: TranscriptDetailLevel): void;
  /** Apply neat (structured-first) tool rendering live; /appearance persists it. */
  setNeatMode(enabled: boolean): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  mountCenterModal(
    panel: Component & Focusable,
    options?: { readonly mode?: 'push' | 'replace'; readonly label?: string },
  ): void;
  closeCenterModal(): void;
  closeAllCenterModals?(): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  focusPendingApprovalPanel(): boolean;
  showApprovalPanel(payload: import('../../reverse-rpc/types').ApprovalPanelData): void;
  refreshSlashCommandAutocomplete(): void;
  showCommandHub?(options?: { readonly initialQuery?: string; readonly intro?: boolean }): void;

  // Session
  requireSession(): Session;
  switchToSession(session: Session, message: string): Promise<void>;
  reloadCurrentSessionView(session: Session, message: string): Promise<void>;
  beginSessionRequest(): void;
  failSessionRequest(message: string): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;

  // UI
  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle;
  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle;
  showProgressSpinner(label: string): LoginProgressSpinnerHandle;
  isSessionLoadingOverlayActive(): boolean;
  beginSessionLoading(sessionId?: string, title?: string): void;
  reportSessionLoading(patch: {
    readonly phase?: 'opening' | 'loading' | 'building' | 'finishing' | 'ready' | 'working';
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void;
  endSessionLoading(): void;
  /** Run work under the premium busy overlay (locks input, shows progress). */
  runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: 'opening' | 'loading' | 'building' | 'finishing' | 'ready' | 'working';
    },
    work: () => Promise<T> | T,
  ): Promise<T>;

  // Theme
  applyTheme(theme: ThemeName, resolved?: ResolvedTheme): Promise<void>;
  refreshTerminalThemeTracking(): void;

  // Dispatch
  stop(exitCode?: number): Promise<void>;
  setExitOpenUrl(url: string): void;
  retryLastTurn(): Promise<void>;
  clearQueuedMessages(): void;
  showHelpPanel(args?: string): void;
  showFileExplorer(): void;
  showDiffReview(report: GitDiffReport, filter: string): void;
  showCommitBrowser(report: GitLogReport, filter: string): void;
  showErrors(): void;
  showSearchResults(results: SearchResults): void;
  showWebContent(url: string | undefined): void;
  showBlame(path: string | undefined): void;
  setNativeRendererDiagnosticsOverlay(command: RendererDiagnosticsOverlayCommand): void;
  setNativeRendererTrace(command: RendererTraceCommand): void;
  createNewSession(): Promise<void>;
  openWorkspace(dir: string, options?: { readonly resumeSessionId?: string }): Promise<void>;
  showSessionPicker(): Promise<void>;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;

  // Controller refs
  readonly streamingUI: StreamingUIController;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly jobBoardController: JobBoardController;
  readonly controlTowerDesk?: {
    markInboxRead(): void;
    maybeShowInterruptedBanner(force?: boolean): void;
    applySnapshots(jobs: readonly import('@superliora/protocol').JobSnapshot[]): void;
    publishFromStore(): void;
  };
  readonly workerDock: WorkerDockController;
  readonly authFlow: AuthFlowController;
  /** Transition beat queue for visible UI state changes. */
  readonly motionBeats: MotionBeatController;
}

// ---------------------------------------------------------------------------
// Dispatch — entry point from handleUserInput
// ---------------------------------------------------------------------------

export function dispatchInput(host: SlashCommandHost, text: string): void {
  if (parseSlashInput(text) !== null) {
    void executeSlashCommand(host, text);
    return;
  }
  host.sendNormalUserInput(text);
}

async function executeSlashCommand(host: SlashCommandHost, input: string): Promise<void> {
  const parsedCommand = parseSlashInput(input);
  const intent = resolveSlashCommandInput({
    input,
    isStreaming: host.state.appState.streamingPhase !== 'idle',
    isCompacting: host.state.appState.isCompacting,
  });

  switch (intent.kind) {
    case 'not-command':
      return;
    case 'blocked':
      host.track('input_command_invalid', { reason: 'blocked', command: intent.commandName });
      host.showError(slashBusyMessage(intent.commandName, intent.reason));
      return;
    case 'message':
      host.sendNormalUserInput(intent.input);
      return;
    case 'builtin':
      host.track('input_command', { command: intent.name });
      if (intent.name === 'new' && parsedCommand?.name === 'clear') {
        host.track('clear');
      }
      try {
        await handleBuiltInSlashCommand(host, intent.name, intent.args);
      } catch (error) {
        host.showError(formatErrorMessage(error));
      }
      return;
  }
}

async function handleBuiltInSlashCommand(
  host: SlashCommandHost,
  name: BuiltinSlashCommandName,
  args: string,
): Promise<void> {
  switch (name) {
    case 'exit':
      void host.stop();
      return;
    case 'help':
      host.showHelpPanel(args);
      return;
    case 'files':
      host.showFileExplorer();
      return;
    case 'search':
      showSearch(host, args);
      return;
    case 'web':
      host.showWebContent(args);
      return;
    case 'blame':
      host.showBlame(args);
      return;
    case 'version':
      host.showStatus(ttui('tui.hub.version', { product: PRODUCT_NAME, version: host.state.appState.version }));
      return;
    case 'new':
      await host.createNewSession();
      requestTUILayoutRender(host.state);
      return;
    case 'sessions':
      void host.showSessionPicker();
      return;
    case 'jobs':
      handleJobsCommand(host, args);
      return;
    case 'job':
      handleJobCommand(host, args);
      return;
    case 'add-dir':
      await handleAddDirCommand(host, args);
      return;
    case 'folder':
      await handleFolderCommand(host, args);
      return;
    case 'reload':
      await handleReloadCommand(host);
      return;
    case 'reload-tui':
      await handleReloadTuiCommand(host);
      return;
    case 'editor':
      await handleEditorCommand(host, args);
      return;
    case 'theme':
      await handleThemeCommand(host, args);
      return;
    case 'appearance':
      await handleAppearanceCommand(host, args);
      return;
    case 'performance':
      await handlePerformanceCommand(host, args);
      return;
    case 'locale':
      await handleLocaleCommand(host, args);
      return;
    case 'model':
      await handleModelCommand(host, args);
      return;
    case 'thinking':
      await handleThinkingCommand(host, args);
      return;
    case 'fast':
      await handleFastCommand(host, args);
      return;
    case 'permission':
      void handlePermissionCommand(host, args);
      return;
    case 'settings':
      showSettingsSelector(host);
      return;
    case 'usage':
      void showUsage(host);
      return;
    case 'quota':
      void showQuota(host);
      return;
    case 'status':
      void showStatusReport(host);
      return;
    case 'host-setup':
    case 'windows-setup':
    case 'macos-setup':
    case 'linux-setup':
    case 'vibe-setup':
    case 'terminal-setup':
      await handleHostSetupCommand(host, args);
      return;
    case 'diff':
      showDiff(host, args);
      return;
    case 'log':
      showLog(host, args);
      return;
    case 'errors':
      host.showErrors();
      return;
    case 'upgrade':
      // Canonical name is `upgrade`; `/update` resolves here via aliases.
      // `/upgrade --main` (or `main`) skips published releases for tip of origin/main.
      await handleUpgradeCommand(host, {}, parseUpgradeSlashArgs(args));
      return;
    case 'btw':
      await handleBtwCommand(host, args);
      return;
    case 'transcript':
      await handleTranscriptCommand(host, args);
      return;
    case 'neat':
      await handleNeatCommand(host, args);
      return;
    case 'title':
      await handleTitleCommand(host, args);
      return;
    case 'yolo':
      await handleYoloCommand(host, args);
      return;
    case 'auto':
      await handleAutoCommand(host, args);
      return;
    case 'compact':
      await handleCompactCommand(host, args);
      return;
    case 'queue':
      handleQueueCommand(host, args);
      return;
    case 'fork':
      await handleForkCommand(host, args);
      return;
    case 'export-md':
      await handleExportMdCommand(host, args);
      return;
    case 'login':
      await handleLoginCommand(host);
      return;
    case 'github-connect':
      await handleGithubConnectCommand(host);
      return;
    case 'logout':
      await handleLogoutCommand(host);
      return;
    case 'accounts':
      await handleAccountsCommand(host);
      return;
    case 'undo':
      await handleUndoCommand(host, args);
      return;
    case 'rewind':
      handleRewindCommand(host);
      return;
    case 'retry':
      await host.retryLastTurn();
      return;
    default:
      host.showError(ttui('tui.hub.unknownSlash', { name: String(name) }));
      return;
  }
}
