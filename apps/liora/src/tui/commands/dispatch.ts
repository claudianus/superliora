import type { Component, Focusable } from '#/tui/renderer';
import type { DeviceAuthorization } from '@superliora/oauth';
import type { LioraHarness, Session } from '@superliora/sdk';

import { PRODUCT_NAME } from '#/constant/app';
import type { ColorToken, ThemeName } from '#/tui/theme';

import { LLM_NOT_SET_MESSAGE } from '../constant/liora-tui';
import type { AuthFlowController } from '../controllers/auth-flow';
import type { BtwPanelController } from '../controllers/btw-panel';
import type { StreamingUIController } from '../controllers/streaming-ui';
import type { TasksBrowserController } from '../controllers/tasks-browser';
import type { ResolvedTheme } from '../theme/colors';
import type { TUIState } from '../tui-state';
import type {
  AppState,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptEntry,
} from '../types';
import { formatErrorMessage } from '../utils/event-payload';
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
import { showMcpServers, showStatusReport, showUsage } from './info';
import { handleAddDirCommand } from './add-dir';
import { handleBenchCommand } from './bench';
import { handleMemoryCommand } from './memory';
import { parseSlashInput } from './parse';
import { handlePluginsCommand } from './plugins';
import { handlePreflightCommand } from './preflight';
import { handleProviderCommand } from './provider';
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
import { handleSwarmCommand } from './swarm';
import {
  handleUltraworkCommand,
  handleUltraworkModeToggle,
  shouldAutoActivateUltrawork,
} from './ultrawork';
import { handleUndoCommand } from './undo';

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
export { showMcpServers, showStatusReport, showUsage } from './info';
export { handleMemoryCommand } from './memory';
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
  showHelpPanel(args?: string): void;
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
}

// ---------------------------------------------------------------------------
// Dispatch — entry point from handleUserInput
// ---------------------------------------------------------------------------

export function dispatchInput(host: SlashCommandHost, text: string): void {
  if (parseSlashInput(text) !== null) {
    void executeSlashCommand(host, text);
    return;
  }
  if (
    host.state.appState.streamingPhase === 'idle' &&
    !host.state.appState.isCompacting &&
    (host.state.appState.ultraworkMode || shouldAutoActivateUltrawork(text))
  ) {
    void handleUltraworkCommand(host, text, 'auto');
    return;
  }
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
    case 'version':
      host.showStatus(`${PRODUCT_NAME} v${host.state.appState.version}`);
      return;
    case 'new':
      await host.createNewSession();
      host.state.ui.requestRender();
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
    case 'model':
      await handleModelCommand(host, args);
      return;
    case 'thinking':
      await handleThinkingCommand(host, args);
      return;
    case 'provider':
      await handleProviderCommand(host);
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
    case 'status':
      void showStatusReport(host);
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
    case 'plan':
      await handlePlanCommand(host, args);
      return;
    case 'swarm':
      await handleSwarmCommand(host, args);
      return;
    case 'ultrawork':
      await handleUltraworkCommand(host, args);
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
    case 'undo':
      await handleUndoCommand(host, args);
      return;
    default:
      host.showError(`Unknown slash command: /${String(name)}`);
      return;
  }
}
