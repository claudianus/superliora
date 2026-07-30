import type { LioraHarness } from '@superliora/sdk';

import * as slashCommands from '../../commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '../../config';
import { registerReverseRPCHandlers } from '../../reverse-rpc/index';
import type { ApprovalPanelData, QuestionPanelData } from '../../reverse-rpc/types';
import { createTUIState } from '../../tui-state';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { createInitialAppState } from '../../utils/initial-app-state';
import type { LioraTUIStartupInput } from '../../types';
import type { LioraTUI } from '../../liora-tui';
import { AppStateController } from './app-state';
import { AuthFlowController } from '../auth/auth-flow';
import { AutocompleteController } from '../shell/autocomplete';
import { AppearanceController, shouldRenderAmbientAnimationFrame } from '../appearance/index';
import { BtwPanelController } from '../panes/btw-panel';
import { ClipboardImageHintController } from '../clipboard/clipboard-image-hint';
import { DialogsController } from '../dialogs/index';
import { EditorKeyboardController } from '../shell/editor-keyboard';
import { MessageDispatchController } from '../transcript/message-dispatch';
import {
  NativeRendererDiagnosticsController,
  nativeRendererDiagnosticsOverlayEnabled,
} from '../diagnostics/native-renderer-diagnostics';
import { PanesController } from '../panes/panes';
import { PromptIntelligenceController } from '../prompt/prompt-intelligence';
import { ReverseRpcPanelsController } from '../panes/reverse-rpc-panels';
import { SessionBrowserController } from '../session/session-browser';
import { SessionEventHandler } from '../session-event/handler';
import { SessionLifecycleController } from '../session/session-lifecycle';
import { SessionReplayRenderer, type SessionReplayHost } from '../session-replay/index';
import { SessionRequestsController } from '../session/session-requests';
import { ShellInputController } from '../shell/shell-input';
import { StartupLifecycleController } from '../startup-lifecycle/index';
import { StreamingUIController } from '../streaming-ui/index';
import { TasksBrowserController } from '../panes/tasks-browser';
import { TranscriptRenderController } from '../transcript/transcript-render';
import { UsageMonitorController } from '../usage/usage-monitor';
import { WorkspaceBrowserController } from '../panes/workspace-browser';

function shouldRenderAmbientAnimationFrameFor(tui: LioraTUI): boolean {
  const selection = tui.state.transcriptSelection;
  return shouldRenderAmbientAnimationFrame(
    tui.state.terminal.rows,
    selection.isDragging || selection.hasSelection,
  );
}

/** Instantiate controllers and reverse-RPC wiring for {@link LioraTUI}. */
export function wireLioraTUIControllers(
  tui: LioraTUI,
  harness: LioraHarness,
  startupInput: LioraTUIStartupInput,
): void {
  const tuiOptions = {
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
  Object.assign(tui, { options: tuiOptions });
  tui.startupNotice = startupInput.startupNotice;
  tui.state = createTUIState(tuiOptions);
  tui.state.footer.setMotionBeatSource(() =>
    tui.motionBeats.active(appearanceAnimationNow()),
  );

  tui.reverseRpcDisposers.push(
    ...registerReverseRPCHandlers(tui.approvalController, tui.questionController, {
      showApprovalPanel: (payload: ApprovalPanelData) => {
        tui.showApprovalPanel(payload);
      },
      hideApprovalPanel: () => {
        tui.reverseRpcPanels.hideApprovalPanel();
      },
      showQuestionDialog: (payload: QuestionPanelData) => {
        tui.showQuestionDialog(payload);
      },
      hideQuestionDialog: () => {
        tui.reverseRpcPanels.hideQuestionDialog();
      },
    }),
  );

  tui.streamingUI = new StreamingUIController(tui);
  tui.authFlow = new AuthFlowController(tui);
  tui.appearanceController = new AppearanceController({
    terminal: tui.state.terminal,
    getAppearance: () => tui.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
    requestRender: () => {
      tui.state.renderer.requestRender('animation');
    },
    setAmbientSchedule: (options) => {
      tui.state.renderer.nativeRuntime?.setAmbientSchedule(options);
    },
    onAppearanceApplied: () => {
      tui.state.renderer.invalidateFrame('palette');
    },
    shouldRenderAnimation: () => shouldRenderAmbientAnimationFrameFor(tui),
    forceAmbientSchedule: () => tui.splashForcesAmbient,
  });
  tui.state.transcriptDetail =
    tui.state.appState.appearance?.transcriptDetail ?? 'standard';
  tui.btwPanelController = new BtwPanelController(tui);
  tui.sessionEventHandler = new SessionEventHandler(tui);
  tui.transcriptRender = new TranscriptRenderController(tui);
  tui.panes = new PanesController(tui);
  tui.dialogs = new DialogsController(tui);
  tui.workspaceBrowser = new WorkspaceBrowserController(tui);
  tui.sessionBrowser = new SessionBrowserController(tui);
  tui.reverseRpcPanels = new ReverseRpcPanelsController(tui);
  tui.sessionReplay = new SessionReplayRenderer(tui as unknown as SessionReplayHost);
  tui.sessionLifecycle = new SessionLifecycleController(tui);
  tui.messageDispatch = new MessageDispatchController(tui);
  tui.autocomplete = new AutocompleteController(tui);
  tui.shellInput = new ShellInputController(tui);
  tui.appStateController = new AppStateController(tui);
  tui.sessionRequests = new SessionRequestsController(tui);
  tui.startupLifecycle = new StartupLifecycleController(tui);
  tui.nativeRendererDiagnostics = new NativeRendererDiagnosticsController(tui);
  tui.tasksBrowserController = new TasksBrowserController(tui);
  tui.usageMonitor = new UsageMonitorController({
    harness: tui.harness,
    setAppState: (patch) => tui.setAppState(patch),
    requestRender: () => requestTUILayoutRender(tui.state),
  });
  tui.editorKeyboard = new EditorKeyboardController(tui, tui.imageStore);
  tui.editorKeyboard.install();
  tui.promptIntelligence = new PromptIntelligenceController(tui);
  tui.promptIntelligence.install();
  tui.nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();
  tui.startupLifecycle.buildLayout();
}

/** Slash-command plan / ultrawork toggles routed from the coordinator surface. */
export function handlePlanToggleFromHost(tui: LioraTUI, next: boolean, ultra = false): void {
  void slashCommands.handlePlanCommand(tui, next ? (ultra ? 'ultra' : 'on') : 'off');
}

export function handleUltraworkModeToggleFromHost(tui: LioraTUI, next: boolean): void {
  void slashCommands.handleUltraworkModeToggle(tui, next);
}

export function openUndoSelectorFromHost(tui: LioraTUI): void {
  void slashCommands.handleUndoCommand(tui, '');
}
