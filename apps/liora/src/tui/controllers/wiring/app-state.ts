import { collectFooterStaleAppStatePatches } from '../../components/chrome/footer/footer-badges';
import type { CommandHubComponent } from '../../components/dialogs/command-hub/index';
import type { AppState, LivePaneState } from '../../types';
import { INITIAL_LIVE_PANE } from '../../types';
import type { TUIState } from '../../tui-state';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { invalidateTranscriptHitTestCache } from '../../features/transcript/transcript-hit-test';
import { pickGoalDriverLive } from '../../utils/job/goal-driver-live';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';
import type { MotionBeatController } from '../../utils/render/motion-beats';
import { hasPatchChanges } from '../../utils/object-patch';
import type { AppearanceController } from '../appearance/index';
import type { DialogsController } from '../dialogs/index';
import type { PromptIntelligenceController } from '../prompt/prompt-intelligence';
import type { SessionEventHandler } from '../session-event/handler';

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Footer mode badge toggles → plan_enter/exit + mode_enter/exit (yolo, ask). */
function collectFooterModeBeats(
  prev: AppState,
  patch: Partial<AppState>,
): Array<{
  readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
  readonly title: string;
}> {
  const beats: Array<{
    readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
    readonly title: string;
  }> = [];
  if ('planMode' in patch && patch.planMode !== undefined && patch.planMode !== prev.planMode) {
    beats.push({ name: patch.planMode ? 'plan_enter' : 'plan_exit', title: 'plan' });
  }
  if ('askMode' in patch && patch.askMode !== undefined && patch.askMode !== prev.askMode) {
    beats.push({ name: patch.askMode ? 'mode_enter' : 'mode_exit', title: 'ask' });
  }
  if (
    'permissionMode' in patch &&
    patch.permissionMode !== undefined &&
    patch.permissionMode !== prev.permissionMode
  ) {
    const wasYolo = prev.permissionMode === 'yolo';
    const nowYolo = patch.permissionMode === 'yolo';
    if (wasYolo !== nowYolo) {
      beats.push({ name: nowYolo ? 'mode_enter' : 'mode_exit', title: 'yolo' });
    }
  }
  return beats;
}

/** Host surface required by app-state mutation and live-pane accessors. */
export interface AppStateHost {
  state: TUIState;
  openCommandHub: CommandHubComponent | undefined;
  readonly motionBeats: MotionBeatController;
  readonly appearanceController: AppearanceController;
  readonly dialogs: DialogsController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly promptIntelligence: PromptIntelligenceController;
  readonly missionControl: { pushView(): void; syncPreferences(): void };

  updateEditorBorderHighlight(text?: string): void;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  setupAutocomplete(): void;
}

/**
 * App-state patching, live-pane updates, and footer mode-beat side effects.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class AppStateController {
  constructor(private readonly host: AppStateHost) {}

  supportsCurrentModelCapability(capability: string): boolean {
    const capabilities =
      this.host.state.appState.availableModels[this.host.state.appState.model]?.capabilities;
    if (capabilities === undefined) return true;
    return capabilities.includes(capability);
  }

  setAppState(patch: Partial<AppState>): void {
    const { host } = this;
    const footerStale = collectFooterStaleAppStatePatches(host.state.appState);
    const mergedPatch =
      Object.keys(footerStale).length > 0 ? { ...footerStale, ...patch } : patch;
    if (!hasPatchChanges(host.state.appState, mergedPatch)) return;
    const additionalDirsChanged =
      'additionalDirs' in patch &&
      !sameStringArrays(host.state.appState.additionalDirs, patch.additionalDirs ?? []);
    const busyChanged = 'streamingPhase' in patch || 'isCompacting' in patch;
    const becameIdle =
      'streamingPhase' in patch &&
      host.state.appState.streamingPhase !== 'idle' &&
      patch.streamingPhase === 'idle';
    const goalChanged = 'goal' in patch;
    const conductorJobsChanged = 'conductorJobs' in patch;
    const modeBeats = collectFooterModeBeats(host.state.appState, patch);
    Object.assign(host.state.appState, mergedPatch);
    if ('planMode' in patch) host.updateEditorBorderHighlight();
    if ('appearance' in patch) {
      host.appearanceController.apply();
      // `mission_control` rides the appearance prefs; keep the panel's
      // pinned placeholder in sync no matter which command set it.
      host.missionControl.syncPreferences();
    }
    // Resync ambient schedule when busy state flips so live clocks keep ticking
    // (and stop) without waiting for an appearance change.
    if (busyChanged) host.appearanceController.apply();
    if (
      host.openCommandHub !== undefined &&
      ('planMode' in patch ||
        'premiumQualityMode' in patch ||
        'permissionMode' in patch ||
        'model' in patch ||
        'thinkingLevel' in patch ||
        'streamingPhase' in patch ||
        'isCompacting' in patch)
    ) {
      host.dialogs.refreshOpenCommandHub();
    }
    for (const beat of modeBeats) {
      const planBeat = beat.name === 'plan_enter' || beat.name === 'plan_exit';
      host.motionBeats.play({
        name: beat.name,
        seed: planBeat ? 'plan' : `mode:${beat.title}`,
        title: beat.title,
        nowMs: appearanceAnimationNow(),
      });
    }
    host.state.footer.setState(host.state.appState);
    host.state.header.setState(host.state.appState);
    if (goalChanged) {
      this.syncGoalMonitorPanel();
      // Active Goal Desk / Ralph goals need the ambient clock for live elapsed.
      host.appearanceController.refreshAmbientSchedule();
    }
    if (conductorJobsChanged) {
      // Job lanes live in Mission Control now — push the new ledger snapshot.
      host.missionControl.pushView();
      host.appearanceController.refreshAmbientSchedule();
      // Goal Desk monitor reads driver liveActivity from conductorJobs.
      if (host.state.appState.goal?.execution === 'goal-desk') {
        this.syncGoalMonitorPanel();
      }
    }
    host.updateActivityPane();
    if (busyChanged) {
      host.updateQueueDisplay();
      host.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (additionalDirsChanged) host.setupAutocomplete();
    if (becameIdle) host.promptIntelligence.notifyIdle();
    requestTUIContentRender(host.state);
  }

  syncGoalMonitorPanel(): void {
    const { host } = this;
    const goal = host.state.appState.goal;
    const driverLive =
      goal?.execution === 'goal-desk'
        ? pickGoalDriverLive(goal, host.state.appState.conductorJobs?.jobs)
        : undefined;
    host.state.todoPanel.setGoal(goal, driverLive);
    host.state.todoPanelContainer.clear();
    if (!host.state.todoPanel.isEmpty()) {
      host.state.todoPanelContainer.addChild(host.state.todoPanel);
    }
    invalidateTranscriptHitTestCache(host.state);
    requestTUILayoutRender(host.state);
  }

  patchLivePane(patch: Partial<LivePaneState>): void {
    const { host } = this;
    if (!hasPatchChanges(host.state.livePane, patch)) return;
    Object.assign(host.state.livePane, patch);
    host.updateActivityPane();
    requestTUIContentRender(host.state);
  }

  resetLivePane(): void {
    const { host } = this;
    host.state.livePane = { ...INITIAL_LIVE_PANE };
    host.updateActivityPane();
    requestTUIContentRender(host.state);
  }
}
