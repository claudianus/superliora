import type { LioraHarness } from '@superliora/sdk';

import * as slashCommands from '../../commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '../../config';
import { registerReverseRPCHandlers } from '../../reverse-rpc/index';
import type { ApprovalPanelData, QuestionPanelData } from '../../reverse-rpc/types';
import { createTUIState } from '../../tui-state';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { persistTuiSessionState } from '../../utils/tui-session-state';
import { createInitialAppState } from '../../utils/initial-app-state';
import type { LioraTUIStartupInput } from '../../types';
import type { LioraTUI } from '../../liora-tui';
import { AppStateController } from './app-state';
import { AuthFlowController } from '../auth/auth-flow';
import { AutocompleteController } from '../shell/autocomplete';
import { AppearanceController, shouldRenderAmbientAnimationFrame } from '../appearance/index';
import { BtwPanelController } from '../panes/btw-panel';
import { ClipboardImageHintController } from '../clipboard/clipboard-image-hint';
import { JobBoardStore } from '../../features/control-tower/job-board-store';
import { ControlTowerJobDesk } from '../../features/control-tower/job-desk-events';
import { MissionControlController } from '../mission-control/controller';
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
import { JobBoardController } from '../panes/job-board';
import { TranscriptRenderController } from '../transcript/transcript-render';
import { UsageMonitorController } from '../usage/usage-monitor';
import { WorkspaceBrowserController } from '../panes/workspace-browser';
import {
  setActiveNeatMode,
  setActiveTranscriptDetail,
} from '../../features/transcript/transcript-density';

function shouldRenderAmbientAnimationFrameFor(tui: LioraTUI): boolean {
  const selection = tui.state.transcriptSelection;
  return shouldRenderAmbientAnimationFrame(
    tui.state.terminal.rows,
    selection.isDragging || selection.hasSelection,
  );
}

function isStreamingPhaseActive(
  phase: LioraTUI['state']['appState']['streamingPhase'],
): boolean {
  return phase === 'waiting' || phase === 'thinking' || phase === 'composing' || phase === 'shell';
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
  // Before AppearanceController: its constructor evaluates forceAmbientSchedule,
  // which reads tui.missionControl.hasLiveWorkers().
  tui.missionControl = new MissionControlController(tui);
  // Reflect the persisted `mission_control` mode on the panel placeholder.
  tui.missionControl.syncPreferences();
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
    forceAmbientSchedule: () =>
      tui.splashForcesAmbient ||
      // Live agent work needs ambient ticks so thinking/waiting elapsed clocks
      // and stall labels keep updating even when decorative motion is off.
      isStreamingPhaseActive(tui.state.appState.streamingPhase) ||
      tui.state.appState.isCompacting === true ||
      // Active goal wall-clock in the footer needs chrome rebuilds even when
      // the agent is idle and decorative motion is off.
      tui.state.appState.goal?.status === 'active' ||
      // Conductor workers run independently of the main turn, so their live
      // desk and open Job Deck need the same shared ambient clock.
      tui.state.appState.conductorJobs?.jobs.some(
        (card) => card.status === 'running' && card.workerAgentId !== undefined,
      ) === true ||
      // Mission Control roster: live elapsed clocks + the completed-worker
      // linger expiry need 1s chrome ticks even while the main turn idles.
      tui.missionControl.hasLiveWorkers(),
  });
  tui.state.transcriptDetail =
    tui.state.appState.appearance?.transcriptDetail ?? 'standard';
  // Keep render-time density readers (thinking / answer phase) in sync.
  setActiveTranscriptDetail(tui.state.transcriptDetail);
  setActiveNeatMode(tui.state.appState.appearance?.neat ?? true);
  // Legacy expand flag used when mounting thinking/tool cards — seed from density
  // so transcript_detail=full at boot expands without requiring Ctrl+O once.
  tui.state.toolOutputExpanded = tui.state.transcriptDetail === 'full';
  tui.btwPanelController = new BtwPanelController(tui);
  // Conductor job desk single source (V5-3): all `job.*` events converge on
  // this store before the session event handler is wired.
  tui.jobBoardStore = new JobBoardStore();
  tui.controlTowerDesk = new ControlTowerJobDesk(tui, tui.jobBoardStore);
  tui.sessionEventHandler = new SessionEventHandler(tui);
  tui.transcriptRender = new TranscriptRenderController(tui);
  tui.panes = new PanesController(tui);
  tui.dialogs = new DialogsController(tui);
  tui.workspaceBrowser = new WorkspaceBrowserController(tui);
  tui.sessionBrowser = new SessionBrowserController(tui);
  tui.reverseRpcPanels = new ReverseRpcPanelsController(tui);
  tui.sessionReplay = new SessionReplayRenderer(tui as unknown as SessionReplayHost);
  tui.sessionLifecycle = new SessionLifecycleController(tui);
  tui.state.persistSessionUiState = () => persistTuiSessionState(tui);
  tui.messageDispatch = new MessageDispatchController(tui);
  tui.autocomplete = new AutocompleteController(tui);
  tui.shellInput = new ShellInputController(tui);
  tui.appStateController = new AppStateController(tui);
  tui.state.footer.setStaleAppStateHandler((patch) => {
    tui.appStateController.setAppState(patch);
  });
  tui.sessionRequests = new SessionRequestsController(tui);
  tui.startupLifecycle = new StartupLifecycleController(tui);
  tui.nativeRendererDiagnostics = new NativeRendererDiagnosticsController(tui);
  tui.tasksBrowserController = new TasksBrowserController(tui);
  tui.jobBoardController = new JobBoardController(tui);
  tui.usageMonitor = new UsageMonitorController({
    harness: tui.harness,
    setAppState: (patch) =>{  tui.setAppState(patch); },
    requestRender: () =>{  requestTUILayoutRender(tui.state); },
  });
  tui.editorKeyboard = new EditorKeyboardController(tui, tui.imageStore);
  tui.editorKeyboard.install();
  tui.promptIntelligence = new PromptIntelligenceController(tui);
  tui.promptIntelligence.install();
  tui.nativeRendererDiagnosticsHudEnabled = nativeRendererDiagnosticsOverlayEnabled();
  tui.startupLifecycle.buildLayout();
}

/** Slash-command plan toggles routed from the coordinator surface. */
export function handlePlanToggleFromHost(tui: LioraTUI, next: boolean, ultra = false): void {
  void slashCommands.handlePlanCommand(tui, next ? (ultra ? 'ultra' : 'on') : 'off');
}

/** Shift-Tab Build/Ask cycle routed from the coordinator surface. */
export function setAskModeFromHost(tui: LioraTUI, enabled: boolean): void {
  void slashCommands.setAskMode(tui, enabled);
}

export function openUndoSelectorFromHost(tui: LioraTUI): void {
  void slashCommands.handleUndoCommand(tui, '');
}
