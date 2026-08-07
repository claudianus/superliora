import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { LioraHarness, Session } from '@superliora/sdk';

import { PRODUCT_NAME } from '#/constant/app';
import type { ColorToken, ThemeName } from '#/tui/theme';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';

import { LLM_NOT_SET_MESSAGE } from '../../constant/liora-tui';
import type { AuthFlowController } from '../../controllers/auth/auth-flow';
import type { BtwPanelController } from '../../controllers/panes/btw-panel';
import type { StreamingUIController } from '../../controllers/streaming-ui/index';
import type { TasksBrowserController } from '../../controllers/panes/tasks-browser';
import type { JobBoardController } from '../../controllers/panes/job-board';
import type { MissionControlController } from '../../controllers/mission-control/controller';
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
import { handleAccountsCommand } from '../auth/accounts';
import { handleLoginCommand, handleLogoutCommand } from '../auth/login';
import { handleBtwCommand } from '../btw';
import { handleAutoCommand, handlePermissionCommand, handleYoloCommand, showPermissionPicker } from '../config/permission/permission';
import { handleAppearanceCommand } from '../config/appearance/appearance';
import { handleAskCommand } from '../config/plan/ask';
import { handleCompactCommand, handlePlanCommand } from '../config/plan/plan';
import { handleRefineCommand } from '../refine';
import { handleContextCommand } from '../config/context/context';
import { handleEditorCommand, handleThemeCommand } from '../config/appearance/editor-theme';
import { handleMediaCommand } from '../config/media/media';
import { handleModelCommand, showModelPicker } from '../config/model/model';
import { handleThinkingCommand } from '../config/thinking/thinking';
import { showExperimentsPanel } from '../config/experiments/experiments';
import { showSettingsSelector, showHarnessPanel } from '../config/settings';
import { showHarnessEyesReadiness } from '../config/eyes/eyes-settings';
import { showToolsInventory } from '../config/harness/harness-tools';
import { handleGoalCommand } from '../goal';
import { handleCronCommand } from '../cron';
import { handleAgentsCommand } from '../agents';
import { handleJobCommand, handleJobsCommand } from '../jobs';
import { showDiff } from '../session/diff';
import { showLog } from '../log';
import { showContextOsReport, showMcpServers, showQuota, showStatusReport, showUsage } from '../info/info';
import { handleAddDirCommand } from '../session/add-dir';
import { handleAquariumCommand } from '../aquarium';
import { handleFeedCommand } from '../feed';
import { handleMemoryCommand } from '../memory/memory';
import { handlePersonaCommand } from '../persona';
import { parseSlashInput } from './parse';
import { handlePluginsCommand } from '../plugins/plugins';
import { handlePremiumQualityCommand } from '../premium';
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
  handleInitCommand,
  handleTitleCommand,
} from '../session/session';
import { showSearch } from '../search';

import { handleLoopCommand } from '../loop';
import { handleRewindCommand } from '../session/rewind';
import { handleTranscriptCommand } from '../session/transcript';
import { handleNeatCommand } from '../session/neat';
import { handleUndoCommand } from '../session/undo';
import { handleUpgradeCommand } from '../info/upgrade';

// ---------------------------------------------------------------------------
// Re-exports — keep existing consumers working
// ---------------------------------------------------------------------------

export { handleLoginCommand, handleLogoutCommand } from '../auth/login';
export { handleBtwCommand } from '../btw';
export { handleAddDirCommand } from '../session/add-dir';
export { handleAutoCommand, handlePermissionCommand, handleYoloCommand, showPermissionPicker } from '../config/permission/permission';
export { handleAppearanceCommand } from '../config/appearance/appearance';
export { handleAskCommand, setAskMode } from '../config/plan/ask';
export { handleCompactCommand, handlePlanCommand } from '../config/plan/plan';
export { handleEditorCommand, handleThemeCommand } from '../config/appearance/editor-theme';
export { handleModelCommand, showModelPicker } from '../config/model/model';
export { handleThinkingCommand } from '../config/thinking/thinking';
export { showExperimentsPanel } from '../config/experiments/experiments';
export { showSettingsSelector } from '../config/settings';
export { showMcpServers, showQuota, showStatusReport, showUsage } from '../info/info';
export { handleMemoryCommand } from '../memory/memory';
export { handlePersonaCommand } from '../persona';
export { handlePluginsCommand } from '../plugins/plugins';
export { handleReloadCommand, handleReloadTuiCommand } from '../session/reload';
export { handleGoalCommand } from '../goal';
export {
  handleExportMdCommand,
  handleForkCommand,
  handleInitCommand,
  handleTitleCommand,
} from '../session/session';
export { handleUndoCommand } from '../session/undo';
export { handleRewindCommand } from '../session/rewind';
export { handleLoopCommand } from '../loop';

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
  requestQueuedGoalPromotion?(): void;

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
  showSessionPicker(): Promise<void>;
  showExtensionsModal(args?: string): Promise<void>;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void;
  activatePluginCommand(
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ): void;
  readonly skillCommandMap: Map<string, string>;
  readonly pluginCommandMap: Map<string, string>;
  refreshSkillCommands?(session?: Session): Promise<void>;
  refreshDynamicSlashCommands?(session?: Session): Promise<void>;

  // Controller refs
  readonly streamingUI: StreamingUIController;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly jobBoardController: JobBoardController;
  readonly missionControl: MissionControlController;
  readonly authFlow: AuthFlowController;
  /** Transition beat queue (status open, plan enter/exit, …). */
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
  if (host.state.appState.streamingPhase !== 'idle' || host.state.appState.isCompacting) {
    host.sendNormalUserInput(text);
    return;
  }
  // No pre-agent routing: natural language goes straight to the main agent,
  // which delegates through the Job ledger on the Conductor lane.
  host.sendNormalUserInput(text);
}

async function executeSlashCommand(host: SlashCommandHost, input: string): Promise<void> {
  const parsedCommand = parseSlashInput(input);
  const intent = resolveSlashCommandInput({
    input,
    skillCommandMap: host.skillCommandMap,
    pluginCommandMap: host.pluginCommandMap,
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
    case 'invalid':
      host.track('input_command_invalid', {
        reason: intent.reason,
        command: intent.commandName,
      });
      host.showError(`Invalid slash command: /${intent.commandName}`);
      return;
    case 'skill': {
      const session = host.session;
      if (host.state.appState.model.trim().length === 0 || session === undefined) {
        host.showError(LLM_NOT_SET_MESSAGE);
        return;
      }
      host.track('input_command', {
        command: intent.commandName,
        skill_name: intent.skillName,
      });
      host.sendSkillActivation(session, intent.skillName, intent.args);
      return;
    }
    case 'plugin-command': {
      const session = host.session;
      if (host.state.appState.model.trim().length === 0 || session === undefined) {
        host.showError(LLM_NOT_SET_MESSAGE);
        return;
      }
      host.track('input_command', { command: `${intent.pluginId}:${intent.commandName}` });
      host.activatePluginCommand(session, intent.pluginId, intent.commandName, intent.args);
      return;
    }
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
      host.showStatus(`${PRODUCT_NAME} v${host.state.appState.version}`);
      return;
    case 'new':
      await host.createNewSession();
      requestTUILayoutRender(host.state);
      return;
    case 'sessions':
      void host.showSessionPicker();
      return;
    case 'extensions':
      void host.showExtensionsModal(args);
      return;
    case 'tasks':
      void host.tasksBrowserController.show();
      return;
    case 'agents':
      await handleAgentsCommand(host, args);
      return;
    case 'jobs':
      handleJobsCommand(host, args);
      return;
    case 'job':
      handleJobCommand(host, args);
      return;
    case 'cron':
      handleCronCommand(host, args);
      return;
    case 'mcp':
      void import('../config/mcp/mcp-manage').then(({ showMcpManagePanel }) => showMcpManagePanel(host));
      return;
    case 'tools':
      void showToolsInventory(host);
      return;
    case 'eyes':
      void showHarnessEyesReadiness(host);
      return;
    case 'harness':
      showHarnessPanel(host);
      return;
    case 'plugins':
      void handlePluginsCommand(host, args);
      return;
    case 'memory':
      await handleMemoryCommand(host, args);
      return;
    case 'add-dir':
      await handleAddDirCommand(host, args);
      return;
    case 'experiments':
      await showExperimentsPanel(host);
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
    case 'media':
      handleMediaCommand(host, args);
      return;
    case 'appearance':
      await handleAppearanceCommand(host, args);
      return;
    case 'persona':
      await handlePersonaCommand(host, args);
      return;
    case 'profile':
      await import('../config/harness/agent-profile').then(({ handleProfileCommand }) =>
        handleProfileCommand(host, args),
      );
      return;
    case 'model':
      await handleModelCommand(host, args);
      return;
    case 'thinking':
      await handleThinkingCommand(host, args);
      return;
    case 'permission':
      void handlePermissionCommand(host, args);
      return;
    case 'settings':
      showSettingsSelector(host);
      return;
    case 'context':
      await handleContextCommand(host, args);
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
    case 'diff':
      showDiff(host, args);
      return;
    case 'log':
      showLog(host, args);
      return;
    case 'errors':
      host.showErrors();
      return;
    case 'aquarium':
      handleAquariumCommand(host);
      return;
    case 'feed':
      handleFeedCommand(host);
      return;
    case 'upgrade':
      // Canonical name is `upgrade`; `/update` resolves here via aliases.
      await handleUpgradeCommand(host);
      return;
    case 'context-os':
      void showContextOsReport(host, args);
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
    case 'premium':
      await handlePremiumQualityCommand(host, args);
      return;
    case 'plan':
      await handlePlanCommand(host, args);
      return;
    case 'ask':
      await handleAskCommand(host, args);
      return;
    case 'compact':
      await handleCompactCommand(host, args);
      return;
    case 'refine':
      await handleRefineCommand(host, args);
      return;
    case 'goal':
      await handleGoalCommand(host, args);
      return;
    case 'init':
      await handleInitCommand(host);
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
      await handleRewindCommand(host, args);
      return;
    case 'loop':
      await handleLoopCommand(host, args);
      return;
    case 'retry':
      await host.retryLastTurn();
      return;
    default:
      host.showError(`Unknown slash command: /${String(name)}`);
      return;
  }
}
