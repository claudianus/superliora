import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { LioraHarness, Session } from '@superliora/sdk';

import { PRODUCT_NAME } from '#/constant/app';
import type { ColorToken, ThemeName } from '#/tui/theme';
import type { SearchResults } from '#/utils/fs/project-search';
import type { GitDiffReport } from '#/utils/git/git-diff';
import type { GitLogReport } from '#/utils/git/git-log';

import { LLM_NOT_SET_MESSAGE } from '../constant/liora-tui';
import type { AuthFlowController } from '../controllers/auth-flow';
import type { BtwPanelController } from '../controllers/btw-panel';
import type { StreamingUIController } from '../controllers/streaming-ui';
import type { TasksBrowserController } from '../controllers/tasks-browser';
import type { ResolvedTheme } from '../theme/colors';
import type { TUIState } from '../tui-state';
import { requestTUILayoutRender } from '../utils/frame-render';
import type { MotionBeatController } from '../utils/motion-beats';
import type {
  AppState,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptEntry,
} from '../types';
import { formatErrorMessage } from '../utils/event-payload';
import { handleAccountsCommand } from './accounts';
import { handleLoginCommand, handleLogoutCommand } from './auth';
import { handleBtwCommand } from './btw';
import {
  handleAutoCommand,
  handleAppearanceCommand,
  handleCompactCommand,
  handleEditorCommand,
  handleModelCommand,
  handlePlanCommand,
  handleThemeCommand,
  handleThinkingCommand,
  handleYoloCommand,
  showExperimentsPanel,
  showModelPicker,
  showPermissionPicker,
  showSettingsSelector,
} from './config';
import { handleGoalCommand } from './goal';
import { showDiff } from './diff';
import { showLog } from './log';
import { showContextOsReport, showMcpServers, showQuota, showStatusReport, showUsage } from './info';
import { handleAddDirCommand } from './add-dir';
import { handleAquariumCommand } from './aquarium';
import { handleBenchCommand } from './bench';
import { handleMemoryCommand } from './memory';
import { handlePersonaCommand } from './persona';
import { parseSlashInput } from './parse';
import { handlePluginsCommand } from './plugins';
import { handlePreflightCommand } from './preflight';
import { handlePremiumQualityCommand } from './premium';
import {
  handleRendererCommand,
  type RendererDiagnosticsOverlayCommand,
  type RendererTraceCommand,
} from './renderer';
import type { BuiltinSlashCommandName } from './registry';
import { handleReloadCommand, handleReloadTuiCommand } from './reload';
import { resolveSlashCommandInput, slashBusyMessage } from './resolve';
import {
  handleExportDebugZipCommand,
  handleExportMdCommand,
  handleForkCommand,
  handleInitCommand,
  handleTitleCommand,
} from './session';
import { showSearch } from './search';
import { handleSwarmCommand } from './swarm';
import { showTerm } from './term';
import {
  handleUltraGoalCommand,
  handleUltraPlanCommand,
  handleUltraSwarmCommand,
} from './ultra-standalone';
import { handleUltraworkCommand, handleUltraworkModeToggle } from './ultrawork';
import { handleUndoCommand } from './undo';
import { handleUpgradeCommand } from './upgrade';

// ---------------------------------------------------------------------------
// Re-exports — keep existing consumers working
// ---------------------------------------------------------------------------

export { handleLoginCommand, handleLogoutCommand } from './auth';
export { handleBenchCommand } from './bench';
export { handleBtwCommand } from './btw';
export { handleAddDirCommand } from './add-dir';
export {
  handleAutoCommand,
  handleAppearanceCommand,
  handleCompactCommand,
  handleEditorCommand,
  handleModelCommand,
  handlePlanCommand,
  handleThemeCommand,
  handleThinkingCommand,
  handleYoloCommand,
  showModelPicker,
  showExperimentsPanel,
  showPermissionPicker,
  showSettingsSelector,
} from './config';
export { handleSwarmCommand } from './swarm';
export { handleUltraworkCommand, handleUltraworkModeToggle } from './ultrawork';
export { showMcpServers, showQuota, showStatusReport, showUsage } from './info';
export { handleMemoryCommand } from './memory';
export { handlePersonaCommand } from './persona';
export { handlePluginsCommand } from './plugins';
export { handlePreflightCommand } from './preflight';
export { handleReloadCommand, handleReloadTuiCommand } from './reload';
export { handleGoalCommand } from './goal';
export {
  handleExportDebugZipCommand,
  handleExportMdCommand,
  handleForkCommand,
  handleInitCommand,
  handleTitleCommand,
} from './session';
export { handleUndoCommand } from './undo';

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
  appendTranscriptEntry(entry: TranscriptEntry): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  refreshSlashCommandAutocomplete(): void;

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

  // Controller refs
  readonly streamingUI: StreamingUIController;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
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
  if (host.state.appState.ultraworkMode) {
    void handleUltraworkCommand(host, text, 'auto');
    return;
  }
  // No pre-agent routing: natural language goes straight to the main agent,
  // which decides for itself whether to use Ultrawork/UltraSwarm tools.
  // Ultrawork runs stay available through explicit /ultrawork activation.
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
    case 'tasks':
      void host.tasksBrowserController.show();
      return;
    case 'mcp':
      void showMcpServers(host);
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
    case 'appearance':
      await handleAppearanceCommand(host, args);
      return;
    case 'persona':
      await handlePersonaCommand(host, args);
      return;
    case 'model':
      await handleModelCommand(host, args);
      return;
    case 'thinking':
      await handleThinkingCommand(host, args);
      return;
    case 'permission':
      showPermissionPicker(host);
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
    case 'diff':
      showDiff(host, args);
      return;
    case 'log':
      showLog(host, args);
      return;
    case 'errors':
      host.showErrors();
      return;
    case 'term':
      showTerm(host);
      return;
    case 'aquarium':
      handleAquariumCommand(host);
      return;
    case 'upgrade':
      await handleUpgradeCommand(host);
      return;
    case 'context':
      void showContextOsReport(host, args);
      return;
    case 'btw':
      await handleBtwCommand(host, args);
      return;
    case 'bench':
      await handleBenchCommand(host, args);
      return;
    case 'preflight':
      await handlePreflightCommand(host, args);
      return;
    case 'renderer':
      handleRendererCommand(host, args);
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
    case 'swarm':
      await handleSwarmCommand(host, args);
      return;
    case 'ultrawork':
      await handleUltraworkCommand(host, args);
      return;
    case 'ultragoal':
      await handleUltraGoalCommand(host, args);
      return;
    case 'ultraswarm':
      await handleUltraSwarmCommand(host, args);
      return;
    case 'ultraplan':
      await handleUltraPlanCommand(host, args);
      return;
    case 'compact':
      await handleCompactCommand(host, args);
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
    case 'export-debug-zip':
      await handleExportDebugZipCommand(host);
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
    case 'retry':
      await host.retryLastTurn();
      return;
    default:
      host.showError(`Unknown slash command: /${String(name)}`);
      return;
  }
}
